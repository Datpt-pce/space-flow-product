const fs = require('fs');
const db = require('../db');
const { createSampler, validSample } = require('./resources');
const { dayOf, DAY } = require('./math');
const paths = require('../utils/dataPaths');
const version = require('../../VERSION.json').version || 'unknown';
const enabled = () => process.env.SF_ANALYTICS_ENABLED !== '0';
const listeners = new Set();
let timer, sampling = false, lastMaintenance = 0;
const sample = createSampler();
function saveResource(scope, owner, s, now=Date.now()) {
  if (!enabled() || !validSample(s)) return false;
  const identity = scope === 'agent' ? `${owner}:${s.instanceId}` : s.instanceId;
  db.exec('SAVEPOINT analytics_resource');
  try {
    const inserted = db.prepare('INSERT OR IGNORE INTO analytics_resources VALUES (?,?,?,?,?,?)').run(`${identity}:${s.id}`,owner,scope,identity,now,JSON.stringify(s));
    if (inserted.changes) db.prepare(`INSERT INTO analytics_resource_daily VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?)
      ON CONFLICT(day,scope,instance_id) DO UPDATE SET samples=samples+1,elapsed_ms=elapsed_ms+excluded.elapsed_ms,
      cpu_seconds=cpu_seconds+excluded.cpu_seconds,rss_peak=MAX(rss_peak,excluded.rss_peak),
      tree_cpu_seconds=tree_cpu_seconds+excluded.tree_cpu_seconds,tree_samples=tree_samples+excluded.tree_samples,last_at=excluded.last_at,
      disk_free=excluded.disk_free,database_bytes=excluded.database_bytes`)
      .run(dayOf(now),scope,identity,owner,s.elapsedMs,s.cpuSeconds,s.rssBytes,s.treeCpuSeconds||0,s.treeSupported?1:0,now,s.diskFreeBytes??null,s.databaseBytes??null);
    db.exec('RELEASE analytics_resource');return !!inserted.changes;
  } catch(error) { db.exec('ROLLBACK TO analytics_resource; RELEASE analytics_resource');throw error; }
}
function maintenance(now=Date.now()) {
  db.exec('SAVEPOINT analytics_retention');
  try {
    db.prepare('DELETE FROM analytics_events WHERE at<?').run(now-30*DAY);
    db.prepare('DELETE FROM analytics_resources WHERE at<?').run(now-7*DAY);
    db.prepare('DELETE FROM analytics_daily WHERE day<?').run(dayOf(now-395*DAY));
    db.prepare('DELETE FROM analytics_resource_daily WHERE day<?').run(dayOf(now-395*DAY));
    db.prepare('DELETE FROM analytics_jobs WHERE ended_at IS NOT NULL AND ended_at<?').run(now-395*DAY);
    db.prepare('DELETE FROM analytics_attempts WHERE started_at<?').run(now-395*DAY);
    db.prepare('DELETE FROM analytics_output_usage WHERE first_at<?').run(now-395*DAY);
    db.prepare('DELETE FROM analytics_coverage WHERE minute<?').run(Math.floor((now-395*DAY)/60000));
    db.exec('RELEASE analytics_retention');
  } catch(error) { db.exec('ROLLBACK TO analytics_retention; RELEASE analytics_retention');throw error; }
}
async function tick() {
  if (!enabled() || sampling) return;
  sampling=true;
  try {
    const now=Date.now();
    db.prepare('INSERT OR IGNORE INTO analytics_coverage VALUES (?,?)').run(Math.floor(now/60000),String(version));
    const s=await sample();
    try { const stat=fs.statfsSync(paths.uploads); s.diskFreeBytes=stat.bavail*stat.bsize; } catch { s.diskFreeBytes=null; }
    s.databaseBytes=[paths.database,paths.database+'-wal'].reduce((n,p)=>{try{return n+fs.statSync(p).size;}catch{return n;}},0);
    saveResource('server',null,s);
    for (const fn of listeners) { try { fn(s); } catch { /* independent WS */ } }
    if (now-lastMaintenance>3600000) {maintenance(now);lastMaintenance=now;}
  } catch { console.warn('[analytics] resource sample unavailable'); }
  finally {sampling=false;}
}
function start() {
  db.prepare("UPDATE analytics_settings SET value=? WHERE key='enabled'").run(enabled()?'1':'0');
  if (!timer && enabled()) { void tick();timer=setInterval(tick,15000);timer.unref(); }
}
function stop() {clearInterval(timer);timer=null;}
function subscribe(fn) {listeners.add(fn);return ()=>listeners.delete(fn);}
module.exports={enabled,saveResource,start,stop,subscribe,maintenance};
