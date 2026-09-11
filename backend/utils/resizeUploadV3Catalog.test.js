const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-v3-catalog-'));
process.env.SF_DATA_DIR = temporary;
process.env.SF_IMPORT_LEGACY = '0';
process.env.CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const db = require('../db');
const { getCatalogs, saveCatalog, deletePrivateCatalog, validateCatalog } = require('./resizeUploadV3Catalog');
const { resolveConfig, resolveResizeUploadV3 } = require('../middleware/resolveResizeUploadV3');

try {
  for (const id of ['alice', 'bob']) db.prepare('INSERT INTO users(id,google_sub,email,role) VALUES (?,?,?,?)').run(id, id, `${id}@test.local`, 'member');
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.android.code, 'HomeA1');
  saveCatalog('public', 'admin', { 'ai-home': { name: 'AI Home', platforms: { android: { folder: 'D:/Shared' } } } });
  saveCatalog('private', 'alice', {
    'ai-home': { name: 'AI Home', platforms: { android: { folder: 'D:/Alice' } } },
    'alice-app': { name: 'Alice App', platforms: { ios: { code: 'OnlyA', folder: 'D:/Private' } } },
  });
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.android.folder, 'D:/Alice');
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.android.code, 'HomeA1');
  assert.equal(getCatalogs('bob').effective['ai-home'].platforms.android.folder, 'D:/Shared');
  assert.equal(getCatalogs('bob').effective['alice-app'], undefined);
  saveCatalog('private', 'bob', { 'ai-home': { name: 'AI Home', platforms: {
    webfunnel: null, 'new-network': { name: 'Future Platform', code: 'Future1', folder: 'D:/Future' },
  } } });
  assert.equal(getCatalogs('bob').effective['ai-home'].platforms.webfunnel, undefined);
  assert.equal(getCatalogs('bob').effective['ai-home'].platforms['new-network'].name, 'Future Platform');
  assert.ok(getCatalogs('alice').effective['ai-home'].platforms.webfunnel);
  saveCatalog('public', 'admin', { 'new-shared': { name: 'New', platforms: { webfunnel: { code: 'NEW' } } } });
  assert.equal(getCatalogs('alice').effective['new-shared'].platforms.webfunnel.code, 'NEW');
  const privateBefore = getCatalogs('alice').mine;
  saveCatalog('public', 'admin', { ...getCatalogs('alice').public_overrides, 'ai-home': null, 'new-shared': null });
  assert.equal(getCatalogs('alice').public['ai-home'], undefined);
  assert.equal(getCatalogs('bob').public['new-shared'], undefined);
  assert.equal(getCatalogs('alice').public_overrides['ai-home'], null);
  assert.ok(getCatalogs('alice').public['ai-chat']);
  assert.deepEqual(getCatalogs('alice').mine, privateBefore);
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.android.folder, 'D:/Alice');
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.android.code, undefined);
  assert.equal(getCatalogs('alice').effective['ai-home'].platforms.ios, undefined);
  assert.throws(() => saveCatalog('private', 'alice', { 'ai-chat': null }));
  assert.throws(() => validateCatalog(JSON.parse('{"constructor":null}'), true));
  const config = resolveConfig({ __resolved_v3_catalog: { forged: true }, __resolved_asana_pat: 'forged' }, 'bob');
  assert.equal(config.__resolved_v3_catalog.forged, undefined);
  assert.equal(config.__resolved_asana_pat, '');
  for (const data of [[], { bad: { name: 'X', platforms: { ios: { code: '../escape' } } } }, { bad: { name: 'X', platforms: { ios: { folder: 'https://drive.google.com/x' } } } }, JSON.parse('{"constructor":{"name":"X","platforms":{}}}')]) {
    assert.throws(() => validateCatalog(data));
  }
  let status;
  const res = { status(code) { status = code; return this; }, json() {} };
  const req = { method: 'POST', path: '/run', body: { config: { rows: [] } }, user: { id: 'alice', role: 'member' } };
  resolveResizeUploadV3(req, res, () => assert.fail('Missing permission accepted'));
  assert.equal(status, 403);
  db.prepare('INSERT INTO user_node_permissions(user_id,node_type) VALUES (?,?)').run('alice', 'resize-upload-v3');
  let called = false;
  resolveResizeUploadV3(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.ok(req.body.config.__resolved_v3_catalog['alice-app']);
  const relayed = { method: 'POST', path: '/run', body: req.body, user: { id: 'internal-relay', role: 'admin' } };
  resolveResizeUploadV3(relayed, res, () => {});
  assert.ok(relayed.body.config.__resolved_v3_catalog['alice-app']);
  deletePrivateCatalog('alice');
  assert.equal(getCatalogs('alice').mine, null);
  assert.equal(getCatalogs('alice').effective['alice-app'], undefined);
  assert.equal(getCatalogs('alice').effective['ai-home'], undefined);
  console.log('PASS V3 seed, public/private isolation, merge, input validation and trusted relay resolution');
} finally {
  db.close();
  if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('sf-v3-catalog-')) throw new Error('Unsafe cleanup');
  fs.rmSync(temporary, { recursive: true, force: true });
}
