const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAssetPreviewQueue } = require('./assetPreviewQueue');
const { ensureVideoSchema } = require('./schema');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'),('other')");
ensureVideoSchema(db);
ensureVideoSchema(db); // Existing DB migration must be idempotent.
require.cache[require.resolve('../db')] = { loaded: true, exports: db };
const routes = require('../routes/video-assets');
const root = fs.mkdtempSync(path.resolve(__dirname, '../../logs/asset-preview-'));
const files = new Set();
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const read = id => db.prepare('SELECT * FROM video_assets WHERE id=?').get(id);
const write = output => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, 'preview'); files.add(output); };
const metadata = { sizeBytes: 123456, durationMs: 60123, width: 1920, height: 1080, fps: 30, codecVideo: 'h264', codecAudio: 'aac' };
async function until(condition) {
  for (let i = 0; i < 300; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for preview state');
}
function insert(id, owner = 'owner', state = 'queued') {
  db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,kind,status,duration_ms,preview_status) VALUES(?,?,?,?, 'video','ok',60123,?)")
    .run(id, owner, path.join(root, `${id}.mp4`), 'a'.repeat(64), state);
  return read(id);
}

(async () => {
  const blocked = gate(); let previews = 0;
  const runner = async (kind, payload, progress) => {
    if (kind === 'preflight') return { ok: true };
    if (kind === 'hash') return { contentHash: 'b'.repeat(64), sizeBytes: metadata.sizeBytes };
    if (kind === 'probe') return { metadata };
    if (kind === 'thumbnail') { await blocked.promise; write(payload.outPath); }
    if (kind === 'proxy') { previews++; progress(42); write(payload.outPath); }
    return {};
  };
  let row, deadline;
  try {
    row = await Promise.race([
      routes.importAsset('owner', path.join(root, 'long-source.mp4'), runner, { deferPreview: true }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Import waited for thumbnail/proxy')), 1000); }),
    ]);
    assert.equal(row.status, 'ok'); assert.equal(row.preview_status, 'queued');
    assert.equal(row.duration_ms, 60123); assert.equal(row.width, 1920); assert.equal(row.height, 1080);
    assert.equal(row.proxy_path, null); assert.equal(row.thumbnail_path, null);
    const again = await routes.importAsset('owner', row.source_path, runner, { deferPreview: true });
    assert.equal(again.id, row.id); assert.equal(previews, 0);
  } finally { clearTimeout(deadline); blocked.release(); }
  await until(() => read(row.id)?.preview_status === 'done');
  assert.equal(previews, 1); assert.equal(read(row.id).duration_ms, 60123);
  console.log('PASS import returns original metadata before blocked preview; repeat import deduplicates');

  const sharedGate = gate(); let syncFinished = false;
  const sharedRunner = async (kind, payload, progress) => {
    if (kind === 'thumbnail') await sharedGate.promise;
    return runner(kind, payload, progress);
  };
  const publicImport = routes.importAsset('owner', path.join(root, 'concurrent.mp4'), sharedRunner, { deferPreview: true });
  const internalImport = routes.importAsset('owner', path.join(root, 'concurrent.mp4'), sharedRunner).then(result => { syncFinished = true; return result; });
  const publicRow = await publicImport;
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(syncFinished, false, 'internal caller must wait even when joining a public import');
  } finally { sharedGate.release(); }
  const internalRow = await internalImport;
  assert.equal(internalRow.id, publicRow.id); assert.ok(internalRow.proxy_path);
  assert.equal(internalRow.preview_status, 'done');
  console.log('PASS synchronous internal caller joining a public import still waits for the preview');

  const queue = createAssetPreviewQueue(db, root);
  const release = gate(), started = [];
  const jobs = async (kind, payload, progress) => {
    if (kind === 'thumbnail') { started.push(path.basename(payload.path)); write(payload.outPath); }
    else {
      assert.equal(payload.maxDimension, 1280);
      progress(NaN); progress(150); await release.promise; write(payload.outPath);
    }
  };
  const a = insert('a'), b = insert('b'), c = insert('c', 'other');
  const first = queue.enqueue(a, jobs);
  assert.equal(queue.enqueue(a, jobs), first);
  const second = queue.enqueue(b, jobs), third = queue.enqueue(c, jobs);
  await until(() => started.length === 2);
  assert.deepEqual(started.sort(), ['a.mp4', 'c.mp4']);
  assert.equal(read('a').preview_progress, 99); assert.equal(read('b').preview_status, 'queued');
  release.release(); await Promise.all([first, second, third]);
  assert.equal(read('b').preview_progress, 100);
  const completedStarts = started.length;
  await queue.enqueue({ ...a, preview_status: 'running' }, jobs);
  assert.equal(started.length, completedStarts, 'stale running snapshot cannot restart completed preview');
  console.log('PASS global/per-owner limits, queue sharing, finite progress and completed publication');

  const failed = insert('failed');
  await queue.enqueue(failed, async (kind, payload) => { write(payload.outPath); if (kind === 'proxy') throw new Error('Agent disconnected'); });
  assert.equal(read('failed').status, 'ok'); assert.equal(read('failed').preview_status, 'error');
  assert.equal(read('failed').proxy_path, null); assert.match(read('failed').preview_error, /disconnected/);
  await queue.enqueue(failed, jobs);
  assert.equal(read('failed').preview_status, 'error', 'stale listing cannot silently retry a failed job');
  await queue.enqueue(read('failed'), jobs);
  assert.equal(read('failed').preview_status, 'done'); assert.equal(read('failed').preview_error, null);
  const interrupted = insert('interrupted', 'owner', 'running');
  await createAssetPreviewQueue(db, root).enqueue(interrupted, jobs);
  assert.equal(read('interrupted').preview_status, 'done');
  console.log('PASS failure preserves source, retry succeeds, new process queue recovers running row');

  for (const action of ['delete', 'relink', 'replace']) {
    const stale = insert(`stale-${action}`), hold = gate(); let proxyPath;
    const promise = queue.enqueue(stale, async (kind, payload) => {
      if (kind === 'proxy') { proxyPath = payload.outPath; await hold.promise; }
      write(payload.outPath);
    });
    await until(() => !!proxyPath);
    if (action === 'delete') db.prepare('DELETE FROM video_assets WHERE id=?').run(stale.id);
    else if (action === 'relink') db.prepare('UPDATE video_assets SET source_path=? WHERE id=?').run('new.mp4', stale.id);
    else db.prepare("UPDATE video_assets SET status='offline' WHERE id=?").run(stale.id);
    hold.release(); await promise;
    assert.equal(fs.existsSync(proxyPath), false); assert.equal(read(stale.id)?.proxy_path ?? null, null);
  }
  console.log('PASS deleted, relinked or replaced sources reject late preview publication');

  const express = require('express'), app = express();
  app.use((req, _res, next) => { req.user = { id: req.headers['x-owner'] || 'owner' }; next(); });
  app.use(routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const retry = insert('retry-api', 'owner', 'error');
    const url = `http://127.0.0.1:${server.address().port}/${retry.id}/preview/retry`;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-owner': 'other' } })).status, 404);
    assert.equal(read(retry.id).preview_status, 'error');
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 200); assert.equal((await response.json()).previewStatus, 'queued');
    await until(() => read(retry.id).preview_status === 'error'); // Missing fixture source is reported separately.
    assert.equal(read(retry.id).status, 'ok');
    db.prepare("UPDATE video_assets SET status='offline' WHERE id=?").run(retry.id);
    assert.equal((await fetch(url, { method: 'POST' })).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('PASS retry route enforces ownership and source availability');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const file of files) fs.rmSync(file, { force: true });
  db.close();
});
