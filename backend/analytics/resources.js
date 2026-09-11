const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const instanceId = crypto.randomUUID();
function parseProcStat(text, ticks, pageSize) {
  const end = text.lastIndexOf(')'), first = text.indexOf('(');
  if (end < 0 || first < 0) throw new Error('Invalid proc stat');
  const s = text.slice(end + 2).trim().split(/\s+/);
  return { pid: Number(text.slice(0, first).trim()), ppid: Number(s[1]), start: s[19],
    cpu: (Number(s[11]) + Number(s[12])) / ticks, rss: Number(s[21]) * pageSize };
}
let linuxUnits;
async function processRows() {
  if (process.platform === 'win32') {
    const result = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', path.join(__dirname,'processTree.ps1')],
      { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    return [].concat(JSON.parse(result.stdout || '[]'));
  }
  if (process.platform !== 'linux') throw new Error('Unsupported process tree');
  if (!linuxUnits) {
    const [hz, page] = await Promise.all([exec('getconf',['CLK_TCK']), exec('getconf',['PAGESIZE'])]);
    linuxUnits = [Number(hz.stdout), Number(page.stdout)];
    if (linuxUnits.some(n => !Number.isFinite(n) || n <= 0)) { linuxUnits = null; throw new Error('Unknown kernel units'); }
  }
  const entries = await fs.promises.readdir('/proc');
  const rows = [];
  // Sequential reads bound in-flight I/O; exited/inaccessible processes are missing samples.
  for (const pid of entries.filter(v => /^\d+$/.test(v))) {
    try { rows.push(parseProcStat(await fs.promises.readFile(`/proc/${pid}/stat`,'utf8'), ...linuxUnits)); } catch { /* vanished */ }
  }
  return rows;
}
function descendants(rows, root) {
  const byId = new Map(rows.map(r => [r.pid, r])), found = new Set([root]);
  for (const parent of found) for (const r of rows) {
    if (r.pid !== parent && r.ppid === parent && /^\d+$/.test(byId.get(parent)?.start) && /^\d+$/.test(r.start) && BigInt(r.start) >= BigInt(byId.get(parent).start)) found.add(r.pid);
  }
  return rows.filter(r => found.has(r.pid) && r.pid !== root && r.start);
}
function treeDelta(current, previous) {
  const old = new Map(previous.map(r => [`${r.pid}:${r.start}`,r]));
  let cpu = 0, matched = 0;
  for (const r of current) { const prior = old.get(`${r.pid}:${r.start}`); if (prior) { cpu += Math.max(0,r.cpu-prior.cpu); matched++; } }
  return { treeCpuSeconds: cpu, treeRssBytes: current.reduce((s,r) => s+r.rss,0), childCount: current.length,
    treeMatched: matched, treeMissing: previous.filter(r => !current.some(c => c.pid===r.pid && c.start===r.start)).length };
}
function effectiveCores() {
  let cores = os.availableParallelism?.() || os.cpus().length;
  if (process.platform === 'linux') {
    try { const [quota,period] = fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(' '); if (quota !== 'max') cores = Math.min(cores, Number(quota)/Number(period)); }
    catch { try { const quota=Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us','utf8')), period=Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us','utf8')); if(quota>0) cores=Math.min(cores,quota/period); } catch { /* native */ } }
  }
  return Number.isFinite(cores) && cores>0 ? cores : 1;
}
function createSampler() {
  let cpu = process.cpuUsage(), at = performance.now(), previous = null;
  return async function sample() {
    const started = performance.now(); let tree = null;
    try { const rows = descendants(await processRows(),process.pid); if (previous) tree = treeDelta(rows,previous); previous=rows; }
    catch { previous=null; }
    const current = process.cpuUsage(), end = performance.now(), elapsedMs=end-at;
    const cpuSeconds = (current.user-cpu.user+current.system-cpu.system)/1e6;
    cpu=current;at=end;
    const memory = process.memoryUsage();
    return { id:crypto.randomUUID(), instanceId, elapsedMs, cpuSeconds, rssBytes:memory.rss, heapBytes:memory.heapUsed,
      cores:effectiveCores(), treeSupported:tree!==null, ...tree, samplerMs:end-started };
  };
}
const numeric = ['elapsedMs','cpuSeconds','rssBytes','heapBytes','cores','treeCpuSeconds','treeRssBytes','childCount','treeMatched','treeMissing','samplerMs','diskFreeBytes','databaseBytes'];
function validSample(s) {
  return s && typeof s==='object' && Object.keys(s).every(k=>['id','instanceId','treeSupported',...numeric].includes(k)) &&
    [s.id,s.instanceId].every(v=>typeof v==='string' && /^[a-f0-9-]{36}$/.test(v)) && typeof s.treeSupported==='boolean' &&
    numeric.every(k=>s[k]===undefined || s[k]===null || (Number.isFinite(s[k]) && s[k]>=0 && s[k]<=2**53)) &&
    s.elapsedMs>0 && s.elapsedMs<=120000 && s.cpuSeconds>=0 && s.rssBytes>0 && s.cores>0 && s.cores<=4096 &&
    s.cpuSeconds<=s.elapsedMs/1000*s.cores*2;
}
module.exports = { createSampler, validSample, parseProcStat, descendants, treeDelta, instanceId };
