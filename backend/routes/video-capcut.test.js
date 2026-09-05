// HTTP ownership/provenance proof. Native generation/install has separate real-app proof.
const { DatabaseSync } = require('node:sqlite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('other')");
require('../video/schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { exports: db };
const scratchRoot = path.resolve(__dirname, '../../logs');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'capcut-api-'));
const file = path.join(scratch, 'output.mp4');
fs.writeFileSync(file, 'verified bytes');
const outputHash = crypto.createHash('sha256').update('verified bytes').digest('hex');
db.prepare('INSERT INTO video_projects (id,owner_id,name,payload) VALUES (?,?,?,?)').run('project', 'owner', 'Test', '{}');
const manifest = JSON.stringify({ outputHash, pinnedSeq: 3, verifiedAt: '2026-09-05T00:00:00Z' });
for (const [id, proof, status] of [['verified', manifest, 'done'], ['legacy', null, 'done'], ['queued', manifest, 'queued'], ['bad-pin', JSON.stringify({ outputHash, pinnedSeq: 2, verifiedAt: 'now' }), 'done']]) {
  db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status, output_path, manifest_json, pinned_seq) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'project', 'owner', status, file, proof, 3);
}
const calls = [];
require.cache[require.resolve('../agent/videoJobs')] = { exports: { runVideoJob: async (kind, payload) => {
  calls.push({ kind, payload });
  if (payload.operation === 'prepare') return { path: scratch, report: { sourceVersion: payload.delivery.versionId } };
  return {};
} } };
const app = express(); app.use(express.json());
app.use((req, res, next) => { req.user = { id: req.headers['x-test-owner'] || 'owner' }; next(); });
app.use(require('./video-capcut'));
const server = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, data, owner = 'owner') => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-owner': owner }, body: JSON.stringify(data) });
  const body = { renderJobId: 'verified', build: '9.4.0.4015', name: 'QA', acceptFlattening: true };
  try {
    assert.equal((await post('/prepare', body, 'other')).status, 404);
    assert.equal((await post('/prepare', { ...body, acceptFlattening: false })).status, 400);
    assert.equal((await post('/prepare', { ...body, build: {} })).status, 400);
    for (const renderJobId of ['legacy', 'queued', 'bad-pin']) assert.equal((await post('/prepare', { ...body, renderJobId })).status, 409);
    assert.equal(calls.length, 0);
    const response = await post('/prepare', body); assert.equal(response.status, 201);
    const prepared = await response.json();
    assert.equal(calls[0].payload.delivery.versionId, 'project:3');
    assert.equal(calls[0].payload.delivery.sha256, outputHash);
    assert.equal((await post(`/${prepared.id}/install`, {}, 'other')).status, 404);
    assert.equal((await post(`/${prepared.id}/install`, {})).status, 200);
    assert.equal((await post(`/${prepared.id}/install`, {})).status, 200);
    assert.equal(calls.length, 2, 'installed retry must not mutate native files again');
    fs.appendFileSync(file, 'changed');
    assert.equal((await post('/prepare', body)).status, 409);
    db.exec("UPDATE video_projects SET archived_at = datetime('now')");
    assert.equal((await post('/prepare', body)).status, 404);
    console.log('PASS: CapCut ownership, loss consent, verified hash/pin, archive, idempotent installation (13 checks)');
  } catch (err) { console.error(err); process.exitCode = 1; }
  finally {
    server.closeAllConnections(); server.close(() => db.close());
    assert.equal(path.dirname(path.resolve(scratch)), scratchRoot);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
