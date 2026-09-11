const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('../node_modules/express');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const router = require('../routes/video-projects');
const { refreshAssetAvailability } = require('../routes/video-assets');
const scratchRoot = path.resolve(__dirname, '../../logs');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'video-source-test-'));
const app = express(); app.use(express.json());
app.use((req, res, next) => { req.user = { id: req.get('test-owner') || 'owner' }; next(); });
app.use(router);

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, method = 'GET', body, owner = 'owner') => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'test-owner': owner }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const payload = { schemaVersion: 1, resolution: { width: 1920, height: 1080 }, fps: 30, colorSpace: 'sRGB', audioRate: 48000, sequence: { markers: [] }, tracks: [], transitions: [] };
    const first = (await request('/', 'POST', { name: 'Original', payload })).body;
    const second = (await request(`/${first.id}/sibling`, 'POST', { name: 'Second', payload })).body;
    const third = (await request('/', 'POST', { name: 'Unrelated', payload })).body;
    for (const method of ['PUT', 'DELETE']) assert.equal((await request(`/${first.id}/workspace-group`, method, { name: 'Hijacked' }, 'other')).status, 403);
    for (const name of ['', '  ', 42, 'a'.repeat(201)]) assert.equal((await request(`/${first.id}/workspace-group`, 'PUT', { name })).status, 400);
    assert.equal((await request(`/${first.id}/workspace-group`, 'PUT', { name: 'Renamed group' })).status, 200);
    assert.equal((await request(`/${first.id}`)).body.name, 'Original', 'group rename must preserve timeline name');
    assert.equal((await request('/workspace-groups')).body.find(g => g.id === second.collectionId).name, 'Renamed group');
    db.exec(`CREATE TRIGGER fail_group_archive BEFORE UPDATE OF archived_at ON video_projects WHEN OLD.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'injected archive failure'); END`);
    assert.equal((await request(`/${first.id}/workspace-group`, 'DELETE')).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_projects WHERE archived_at IS NOT NULL').get().n, 0, 'partial archive rolls back');
    db.exec('DROP TRIGGER fail_group_archive');
    const removed = await request(`/${first.id}/workspace-group`, 'DELETE');
    assert.equal(removed.status, 200); assert.deepEqual(removed.body.deletedTimelineIds.sort(), [first.id, second.id].sort());
    assert.equal((await request(`/${third.id}`)).status, 200);
    assert.equal((await request(`/${first.id}`)).status, 404);
    assert.equal((await request(`/${first.id}/restore`, 'POST', {})).status, 200);
    assert.equal((await request(`/${first.id}`)).status, 200);
    assert.equal((await request('/workspace-groups')).body.find(g => g.id === second.collectionId).name, 'Renamed group');
    console.log('PASS group rename/archive: ownership, validation, atomic rollback, unrelated project, restore');

    const source = path.join(scratch, 'source.png'), content = Buffer.from('original bytes');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(source, content);
    db.prepare('INSERT INTO video_assets (id, owner_id, source_path, content_hash, kind, status) VALUES (?, ?, ?, ?, ?, ?)').run('asset', 'owner', source, hash, 'image', 'ok');
    const row = () => db.prepare('SELECT * FROM video_assets WHERE id = ?').get('asset');
    const refresh = () => refreshAssetAvailability([row()], 'owner');
    await refresh(); assert.equal(row().status, 'ok');
    fs.unlinkSync(source); await refresh(); assert.equal(row().status, 'offline');
    fs.writeFileSync(source, Buffer.from('changed bytes')); await refresh(); assert.equal(row().status, 'offline');
    fs.writeFileSync(source, content); await refresh(); assert.equal(row().status, 'ok');
    assert.equal(row().id, 'asset'); assert.equal(row().source_path, source);
    console.log('PASS local source availability: disappearance, changed bytes rejected, original hash recovery');

    const previousMode = process.env.SPACE_FLOW_MODE;
    process.env.SPACE_FLOW_MODE = 'server';
    const modulePath = require.resolve('../ws/agentServer'), previousModule = require.cache[modulePath];
    let online = false, jobs = 0;
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
      isAgentOnline: () => online,
      sendJob: async (owner, job, callback) => {
        assert.equal(owner, 'owner'); assert.equal(job.kind, 'hash'); assert.equal(job.payload.path, 'remote/source.png');
        jobs++; callback('done', { result: { contentHash: hash } });
      },
    } };
    try {
      db.prepare("UPDATE video_assets SET source_path = 'remote/source.png', status = 'ok'").run();
      await refresh(); assert.equal(row().status, 'ok', 'never check a remote source on the server filesystem');
      db.prepare("UPDATE video_assets SET status = 'offline'").run();
      await refresh(); assert.equal(row().status, 'offline'); assert.equal(jobs, 0);
      online = true; await refresh(); assert.equal(row().status, 'ok'); assert.equal(jobs, 1);
      db.prepare("UPDATE video_assets SET source_path = ?, source_locality = 'server', status = 'offline'").run(source);
      await refresh(); assert.equal(row().status, 'ok'); assert.equal(jobs, 1, 'server-owned source must recover locally');
      console.log('PASS server locality and paired-agent recovery boundary');
    } finally {
      if (previousMode === undefined) delete process.env.SPACE_FLOW_MODE; else process.env.SPACE_FLOW_MODE = previousMode;
      if (previousModule) require.cache[modulePath] = previousModule; else delete require.cache[modulePath];
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  db.close();
  if (path.dirname(scratch) === scratchRoot && path.basename(scratch).startsWith('video-source-test-')) fs.rmSync(scratch, { recursive: true, force: true });
});
