const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const media = require('./assetService');
const realProbe = media.probeMetadata;
const source = path.resolve(__dirname, '../../ref-item/1.mp4');
let stopped = 0, mode = 'hang', releaseProbe, probeStarted;
media.probeMetadata = async file => {
  const result = await realProbe(file);
  if (mode === 'cancel-verify') { probeStarted(); await new Promise(resolve => { releaseProbe = resolve; }); }
  return result;
};
const jobsPath = require.resolve('../agent/videoJobs');
require.cache[jobsPath] = { id: jobsPath, filename: jobsPath, loaded: true, exports: {
  cancelRenderJob: () => { stopped++; },
  runVideoJob: async (kind, payload) => {
    if (mode === 'hang') return new Promise(() => {});
    fs.copyFileSync(source, payload.outputPath);
    return { totalDurationMs: 5000 };
  },
} };
const render = require('../routes/video-render');
const life = require('./renderLifecycle').createRenderLifecycle(db);
const projectId = crypto.randomUUID();
const doc = { resolution: { width: 160, height: 160 }, fps: 24, tracks: [], transitions: [] };
db.prepare('INSERT INTO video_projects(id, owner_id, name, payload) VALUES (?, ?, ?, ?)').run(projectId, 'owner', 'Finalization QA', JSON.stringify(doc));
db.prepare('INSERT INTO video_project_snapshots(id, project_id, seq, payload) VALUES (?, ?, 0, ?)').run(crypto.randomUUID(), projectId, JSON.stringify(doc));
const ids = [];
function add() { const id = crypto.randomUUID(); ids.push(id); db.prepare('INSERT INTO video_render_jobs(id, project_id, owner_id, pinned_seq) VALUES (?, ?, ?, 0)').run(id, projectId, 'owner'); return id; }
const row = id => db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(id);
(async () => {
  process.env.VIDEO_RENDER_TIMEOUT_MS = '60';
  const hung = add();
  // Keep this standalone test alive while the production timer is intentionally unref'd.
  const keepAlive = setInterval(() => {}, 1000);
  try { await render.runRenderJobAsync(hung, projectId, 'owner'); } finally { clearInterval(keepAlive); }
  assert.equal(row(hung).status, 'error'); assert.match(row(hung).error_message, /quá thời gian/); assert.equal(stopped, 1);
  delete process.env.VIDEO_RENDER_TIMEOUT_MS;
  mode = 'cancel-verify';
  const verifying = new Promise(resolve => { probeStarted = resolve; });
  const cancelled = add(), run = render.runRenderJobAsync(cancelled, projectId, 'owner');
  await verifying;
  life.cancel(cancelled); releaseProbe();
  await run;
  assert.equal(row(cancelled).status, 'cancelled');
  assert.equal(row(cancelled).manifest_json, null); assert.equal(row(cancelled).output_path, null);
  mode = 'normal';
  const corrupt = path.resolve(__dirname, '../../logs/render-corrupt-packets.mp4');
  const data = fs.readFileSync(source); data.fill(0, 50000, 150000); fs.writeFileSync(corrupt, data);
  try {
    assert.ok((await realProbe(corrupt)).codecVideo, 'container still probes as a video');
    const verification = await render.verifyRenderOutput(corrupt, 5000);
    assert.equal(verification.ok, false, 'full decode rejects corrupted packets after metadata probe succeeds');
  } finally { fs.unlinkSync(corrupt); }
  console.log('PASS render finalization: hung worker deadline/cancel, cancellation during verification never promotes, corrupted packets fail full decode');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  delete process.env.VIDEO_RENDER_TIMEOUT_MS;
  const root = path.resolve(__dirname, '../uploads/video-renders');
  for (const id of ids) { const target = path.resolve(root, id); if (path.dirname(target) === root) fs.rmSync(target, { recursive: true, force: true }); }
  db.close();
});
