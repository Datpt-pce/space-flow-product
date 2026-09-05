const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('relay-owner')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { loaded: true, exports: db };
const agent = require('../ws/agentServer');
const { runVideoJob } = require('../agent/videoJobs');
const { streamFileBack } = require('../agent/connection');
const { makeRunJob, importAsset, toPublicAsset } = require('../routes/video-assets');
const root = fs.mkdtempSync(path.resolve(__dirname, '../../logs/rendition-relay-'));
const source = path.resolve(__dirname, '../../ref-item/1.mp4');
const originalSend = agent.sendJob;
const renditionFiles = new Set();
let calls = 0;
agent.sendJob = async (owner, job, event) => {
  assert.equal(owner, 'relay-owner');
  calls++;
  assert.equal(job.payload.outPath, undefined, 'server filesystem path never reaches agent');
  const result = await runVideoJob(job.kind, job.payload, () => {});
  if (['thumbnail', 'proxy'].includes(job.kind)) {
    assert.ok(!result.outPath.startsWith(root), 'agent generates on its own filesystem');
    try { await streamFileBack(result.outPath, event); }
    finally { fs.unlinkSync(result.outPath); }
  }
  event('done', { result });
};
(async () => {
  const run = makeRunJob('relay-owner', true);
  for (const kind of ['thumbnail', 'proxy']) {
    const outPath = path.join(root, kind === 'proxy' ? 'clip.mp4' : 'thumb.jpg');
    const result = await run(kind, { path: source, outPath });
    assert.equal(result.outPath, outPath);
    assert.ok(fs.statSync(outPath).size > 1000);
  }
  const first = await importAsset('relay-owner', source, run);
  assert.equal(first.status, 'ok');
  for (const file of [first.thumbnail_path, first.proxy_path]) renditionFiles.add(file);
  const before = calls;
  const again = await importAsset('relay-owner', source, run);
  assert.equal(again.id, first.id);
  assert.equal(calls - before, 2, 'ready asset reuses renditions after preflight/hash');
  fs.unlinkSync(first.proxy_path);
  assert.equal(toPublicAsset(first).proxyUrl, null, 'missing cache never produces broken public URL');
  const repaired = await importAsset('relay-owner', source, run);
  assert.equal(repaired.id, first.id, 'cache repair preserves all timeline references');
  assert.ok(fs.existsSync(repaired.proxy_path));
  agent.sendJob = async (_owner, _job, event) => {
    event('output-chunk', { chunkBase64: Buffer.from('partial').toString('base64') });
    throw new Error('Agent disconnected');
  };
  const failed = path.join(root, 'failed.mp4');
  await assert.rejects(() => run('proxy', { path: source, outPath: failed }), /disconnected/);
  assert.equal(fs.existsSync(failed), false);
  assert.equal(fs.readdirSync(root).some(p => p.endsWith('.partial')), false);
  console.log('PASS remote thumbnail/proxy bytes, stable identity, missing-cache repair and disconnect cleanup');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  agent.sendJob = originalSend;
  for (const file of renditionFiles) if (file) fs.rmSync(file, { force: true });
  for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
  fs.rmdirSync(root); db.close();
});
