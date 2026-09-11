const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-admin-console-'));
process.env.SF_DATA_DIR = temporary; process.env.SF_IMPORT_LEGACY = '0';
process.env.CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const db = require('../db');
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { createSession } = require('../services/sessions');
const app = express(); app.use(express.json()); app.use(require('cookie-parser')());
app.use('/users', requireAuth, requireAdmin, requireCsrf, require('./users'));
app.use('/console', requireAuth, requireAdmin, requireCsrf, require('./admin-console'));
app.use('/workflows', requireAuth, requireCsrf, require('./workflows'));
app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
let server; let origin;
function user(role, status = 'active') {
  const id = crypto.randomUUID(); db.prepare('INSERT INTO users(id,google_sub,email,name,role,status) VALUES(?,?,?,?,?,?)').run(id, id, `${id}@example.invalid`, 'Fixture', role, status);
  return { id, cookie: `sf_session=${createSession(id).token}; sf_csrf=test-token` };
}
async function request(actor, route, method = 'GET', body, csrf = true, headers = {}) {
  const response = await fetch(origin + route, { method, headers: { ...(actor ? { Cookie: actor.cookie } : {}), ...(csrf ? { 'X-CSRF-Token': 'test-token' } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); if (path.dirname(temporary) === fs.realpathSync(os.tmpdir()) && path.basename(temporary).startsWith('sf-admin-console-')) fs.rmSync(temporary, { recursive: true, force: true }); });
test('admin endpoints reject anonymous, member, pending and missing-CSRF requests; lock revokes existing sessions', async () => {
  const owner = user('admin'); const member = user('member'); const pending = user('admin', 'pending');
  assert.equal((await request(null, '/console/environment')).status, 401);
  assert.equal((await request(member, '/console/environment')).status, 403);
  assert.equal((await request(pending, '/console/environment')).status, 403);
  assert.equal((await request(owner, `/users/${member.id}`, 'PATCH', { status: 'rejected' }, false)).status, 403);
  assert.equal((await request(owner, `/users/${member.id}`, 'PATCH', { status: 'rejected' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(member.id).n, 0);
  assert.equal((await request(member, '/workflows')).status, 401);
  assert.equal((await request(owner, `/users/${owner.id}`, 'PATCH', { role: 'member' })).status, 409);
  assert.equal((await request(owner, `/users/${owner.id}`, 'PATCH', { status: 'rejected' })).status, 409);
});
test('permission replacement validates the whole request and preserves previous permissions on failure', async () => {
  const owner = user('admin'); const member = user('member');
  assert.equal((await request(owner, `/users/${member.id}/permissions`, 'PUT', { nodeTypes: ['text'], credentialNames: [] })).status, 200);
  for (const value of [{ nodeTypes: 'text' }, { nodeTypes: ['text', 'text'] }, { nodeTypes: ['text', null] }, { credentialNames: ['does-not-exist'] }]) {
    assert.equal((await request(owner, `/users/${member.id}/permissions`, 'PUT', value)).status, 400);
    assert.deepEqual((await request(owner, `/users/${member.id}/permissions`)).body.nodeTypes, ['text']);
  }
  assert.equal((await request(owner, '/users/unknown/permissions', 'PUT', { nodeTypes: [] })).status, 404);
  assert.equal((await request(owner, `/users/${member.id}`, 'PATCH', { role: 'root' })).status, 400);
});
test('operations lists metadata only and cancels the selected queued run once through the durable service', async () => {
  const owner = user('admin'); const member = user('member'); const id = crypto.randomUUID();
  db.prepare('INSERT INTO flow_runs(id,owner_id,input_hash,intent,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, member.id, 'private-hash', 'secret-payload', 'queued', Date.now(), Date.now());
  const list = await request(owner, '/console/runs?state=queued'); assert.equal(list.status, 200); assert.ok(list.body.some(row => row.id === id));
  assert.ok(!JSON.stringify(list.body).includes('secret-payload')); assert.ok(!JSON.stringify(list.body).includes('private-hash'));
  assert.equal((await request(member, `/console/runs/${id}/cancel`, 'POST', {})).status, 403);
  assert.equal((await request(owner, `/console/runs/${id}/cancel`, 'POST', {}, false)).status, 403);
  assert.equal((await request(owner, `/console/runs/${id}/cancel`, 'POST', {})).body.state, 'cancelled');
  assert.equal((await request(owner, `/console/runs/${id}/cancel`, 'POST', {})).status, 409);
  assert.equal((await request(owner, '/console/runs?state=invalid')).status, 400);
});
test('flow management preserves private ownership and revision checks', async () => {
  const owner = user('admin'); const member = user('member');
  const created = await request(owner, '/workflows', 'POST', { name: 'One', payload: { nodes: [], edges: [] } }); const id = created.body.id;
  assert.equal((await request(member, `/workflows/${id}`)).status, 403);
  assert.equal((await request(owner, `/workflows/${id}`, 'PUT', { name: 'Two', visibility: 'team' }, true, { 'If-Match': '"0"' })).status, 200);
  assert.equal((await request(owner, `/workflows/${id}`, 'PUT', { name: 'Stale' }, true, { 'If-Match': '"0"' })).status, 412);
  assert.equal((await request(member, `/workflows/${id}`, 'PUT', { name: 'Takeover' })).status, 403);
  const saved = (await request(owner, `/workflows/${id}`)).body; assert.equal(saved.name, 'Two'); assert.deepEqual(saved.payload, { nodes: [], edges: [] });
});
