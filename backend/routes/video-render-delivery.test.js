// HTTP contract proof with an isolated in-memory database and scratch outputs.
const { DatabaseSync } = require('node:sqlite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
db.exec("INSERT INTO users (id) VALUES ('owner'), ('other')");
require('../video/schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const router = require('./video-render');
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: req.headers['x-test-owner'] || 'owner' }; next(); });
app.use('/render', router);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'video-delivery-test-'));
const bytes = Buffer.from('verified fixture bytes (media decoding is covered by the render suite)');
const file = path.join(scratch, 'output.mp4');
fs.writeFileSync(file, bytes);
db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)').run('project', 'owner', 'Demo / video', '{}');
for (const [id, status, output, manifest] of [['done', 'done', file, '{}'], ['queued', 'queued', null, null], ['missing', 'done', path.join(scratch, 'missing.mp4'), '{}'], ['legacy', 'done', file, null]]) {
  db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status, output_path, manifest_json, pinned_seq, preset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'project', 'owner', status, output, manifest, 3, '720p');
}

const server = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}/render`;
  try {
    const download = await fetch(`${base}/project/render/done/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment.*Demo - video-r3-720p\.mp4/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await fetch(`${base}/project/render/done/download`, { headers: { 'x-test-owner': 'other' } })).status, 404);
    assert.equal((await fetch(`${base}/other/render/done/download`)).status, 404);
    assert.equal((await fetch(`${base}/project/render/queued/download`)).status, 409);
    assert.equal((await fetch(`${base}/project/render/legacy/download`)).status, 409);
    assert.equal((await fetch(`${base}/project/render/missing/download`)).status, 404);
    const before = db.prepare('SELECT count(*) AS n FROM video_render_jobs').get().n;
    for (const data of [{ baseRevision: 99 }, { baseRevision: -1 }, { idempotencyKey: {} }, { idempotencyKey: '' }]) {
      const response = await fetch(`${base}/project/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal(response.status, data.baseRevision === 99 ? 409 : 400);
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM video_render_jobs').get().n, before);
    assert.equal((await fetch(`${base}/done/retry`, { method: 'POST' })).status, 400);
    const status = await fetch(`${base}/project/render/done`);
    assert.match(await status.text(), /"status":"done"/);
    console.log('PASS: download bytes/name, owner/project isolation, missing/incomplete/legacy outputs, revision/input guards, retry guard, terminal SSE (12 checks)');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    server.close(() => db.close());
    // mkdtemp supplied this exact isolated directory; never use a DB/client path.
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('video-delivery-test-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
