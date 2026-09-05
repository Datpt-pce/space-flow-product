const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('relay-owner')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { exports: db };
process.env.SPACE_FLOW_MODE = 'server';
const agent = require('../ws/agentServer');
const { runVideoJob } = require('../agent/videoJobs');
const { streamFileBack } = require('../agent/connection');
const { runRenderJobAsync } = require('../routes/video-render');
const { hashFile } = require('./assetService');
const root = fs.mkdtempSync(path.resolve(__dirname, '../../logs/render-relay-'));
const receiver = require('./sourceTransfer').createSourceReceiver(path.join(root, 'agent source cache'));
const source = path.resolve(__dirname, '../../ref-item/1.mp4');
const jobId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const outputRoot = path.resolve(__dirname, '../uploads/video-renders', jobId);
const state = { schemaVersion: 1, resolution: { width: 160, height: 284 }, fps: 24, audioRate: 48000,
  tracks: [{ id: 'v', type: 'video', order: 0, visible: true, muted: false, clips: [{ id: 'c', assetId: 'source', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1 }] }], transitions: [] };
db.prepare('INSERT INTO video_projects(id,owner_id,name,payload) VALUES (?,?,?,?)').run(projectId, 'relay-owner', 'Relay', JSON.stringify(state));
db.prepare('INSERT INTO video_project_snapshots(id,project_id,seq,payload) VALUES (?,?,0,?)').run(crypto.randomUUID(), projectId, JSON.stringify(state));
db.prepare('INSERT INTO video_assets(id,owner_id,source_path,kind,status,source_locality) VALUES (?,?,?,?,?,?)').run('source', 'relay-owner', source, 'video', 'ok', 'server');
db.prepare('INSERT INTO video_render_jobs(id,project_id,owner_id,pinned_seq) VALUES (?,?,?,0)').run(jobId, projectId, 'relay-owner');
const steps = [];
agent.isAgentOnline = () => true;
agent.sendJob = async (owner, job, emit, renderId) => {
  assert.equal(owner, 'relay-owner'); steps.push(job.kind);
  if (job.kind.startsWith('source-')) return emit('done', { result: await receiver(job.kind, job.payload) });
  assert.equal(job.kind, 'render');
  assert.ok(job.payload.rawAssetPaths.source.startsWith(root), 'render must use the transferred agent source');
  assert.equal(await hashFile(job.payload.rawAssetPaths.source), await hashFile(source));
  assert.equal(job.payload.outputPath, undefined);
  const result = await runVideoJob('render', job.payload, () => {}, renderId);
  try { await streamFileBack(result.outputPath, emit); emit('done', { result }); }
  finally { fs.rmSync(result.outputPath, { force: true }); }
};
(async () => {
  db.prepare('UPDATE video_assets SET content_hash = ? WHERE id = ?').run(await hashFile(source), 'source');
  await runRenderJobAsync(jobId, projectId, 'relay-owner');
  const result = db.prepare('SELECT * FROM video_render_jobs WHERE id=?').get(jobId);
  assert.equal(result.status, 'done', result.error_message);
  assert.ok(steps.indexOf('source-finish') < steps.indexOf('render'));
  assert.equal(JSON.parse(result.manifest_json).outputHash, await hashFile(result.output_path));
  assert.equal(JSON.parse(result.manifest_json).pinnedSeq, 0);
  assert.equal(JSON.parse(result.manifest_json).assetHashes.source, await hashFile(source));
  assert.equal(fs.readdirSync(path.dirname(result.output_path)).includes('output.partial.mp4'), false);
  console.log('PASS server-owned compound source transferred before render, owner routing, real remote FFmpeg bytes and verified hash/pin');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  assert.equal(path.dirname(root), path.resolve(__dirname, '../../logs'));
  assert.equal(path.dirname(outputRoot), path.resolve(__dirname, '../uploads/video-renders'));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outputRoot, { recursive: true, force: true }); db.close();
});
