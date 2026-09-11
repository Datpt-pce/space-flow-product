const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'),('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { exports: db };
const bulk = require('../routes/video-bulk-import');
const { recoverProjectState } = require('../routes/video-projects');
const document = { schemaVersion: 1, resolution: { width: 320, height: 568 }, fps: 24, tracks: [{ id: 'v', type: 'video', order: 0, visible: true, clips: [] }], transitions: [] };
function project(id, owner = 'owner') {
  db.prepare('INSERT INTO video_projects(id,owner_id,name,payload) VALUES (?,?,?,?)').run(id, owner, id, JSON.stringify(document));
  db.prepare('INSERT INTO video_project_snapshots(id,project_id,seq,payload) VALUES (?,?,0,?)').run(id, id, JSON.stringify(document));
}
project('p'); project('q'); project('foreign', 'other'); project('fail-write');
db.exec("INSERT INTO video_assets(id,owner_id,source_path,kind,status,duration_ms) VALUES ('a','owner','fixture.mp4','video','ok',1000)");
const input = { timelineIds: ['p', 'q'], orderedAssetIds: ['a'], options: {}, idempotencyKey: 'request-1' };
const count = () => db.prepare('SELECT count(*) AS n FROM video_project_commands').get().n;
try {
  assert.throws(() => bulk.previewBulkImport('owner', { ...input, timelineIds: ['foreign'] }), e => e.status === 404);
  assert.throws(() => bulk.createBulkImportOperation('owner', { ...input, timelineIds: ['p', 'foreign'] }), e => e.status === 404);
  assert.equal(count(), 0);
  const first = bulk.createBulkImportOperation('owner', input);
  assert.equal(bulk.createBulkImportOperation('owner', input).id, first.id);
  assert.equal(count(), 2);
  assert.throws(() => bulk.createBulkImportOperation('owner', { ...input, options: { placement: 'new_tracks' } }), e => e.status === 409);
  assert.equal(count(), 2);
  db.exec("CREATE TRIGGER fail_journal BEFORE INSERT ON video_bulk_import_operations WHEN NEW.idempotency_key = 'fail-journal' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END");
  assert.throws(() => bulk.createBulkImportOperation('owner', { ...input, idempotencyKey: 'fail-journal' }), /receipt failure/);
  assert.equal(count(), 2, 'receipt failure must roll back every target command');
  db.exec("CREATE TRIGGER fail_payload BEFORE UPDATE OF payload ON video_projects WHEN NEW.id = 'fail-write' BEGIN SELECT RAISE(ABORT, 'injected payload failure'); END");
  const partial = bulk.createBulkImportOperation('owner', { ...input, timelineIds: ['q', 'fail-write'], idempotencyKey: 'partial' });
  assert.equal(partial.status, 'completed_with_errors');
  assert.equal(db.prepare('SELECT count(*) AS n FROM video_project_commands WHERE project_id=?').get('fail-write').n, 0, 'failed target command must roll back with payload');
  assert.equal(recoverProjectState('fail-write').tracks[0].clips.length, 0);
  db.exec("DROP TRIGGER fail_payload; UPDATE video_projects SET owner_id='other' WHERE id='fail-write'");
  const retried = bulk.retryBulkImportOperation('owner', partial.id);
  assert.equal(retried.results[1].status, 'error');
  assert.equal(recoverProjectState('fail-write').tracks[0].clips.length, 0);
  db.exec("UPDATE video_projects SET owner_id='other' WHERE id='p'");
  const beforeUndo = count();
  assert.throws(() => bulk.undoBulkImportOperation('owner', first.id), e => e.status === 404);
  assert.equal(count(), beforeUndo, 'permission failure must block the entire undo');
  console.log('PASS bulk target ownership, request replay/mismatch, receipt rollback, per-target savepoint and retry/undo reauthorization');
} finally { db.close(); }
