const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'),('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const router = require('../routes/video-batch'), batch = router.service;
const projects = require('../routes/video-projects');
const management = require('./batchManagement').createBatchManagement(db, batch);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-batch-controls-'));
const sourceFile = path.join(root, 'nguồn giữ lại.mp4');
fs.writeFileSync(sourceFile, 'unchanged-source');
const save = p => batch.save('owner', p.id, { expectedRevision: p.revision, name: p.name, draft: p.draft });
const archive = id => { const p = batch.get('owner', id); return batch.archive('owner', id, { expectedRevision: p.revision }); };
async function main() {
  let p = batch.create('owner', { id: 'controls', name: 'Controls' });
  db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES ('source','owner',?,'hash',2000,'video','ok')").run(sourceFile);
  p.draft.lists = [{ id: 'source-list', name: 'Nguồn gốc', minRating: 0, items: Array.from({ length: 100 }, (_, n) => ({ id: `item-${n}`, manualOrder: n, sourceRef: { kind: 'media', assetId: 'source', contentHash: 'hash' } })) }];
  p.draft.tracks = [{ id: 'v', name: 'Hình 1', type: 'video', slots: [{ id: 'slot', listId: 'source-list', vary: true, durationFrames: 30 }] }];
  p = save(p);
  const preview = batch.preflight('owner', p.id, { expectedRevision: p.revision });
  const run = batch.createRun('owner', p.id, { expectedRevision: p.revision, inputHash: preview.inputHash, idempotencyKey: 'controls-run' });
  assert.equal(run.pendingCount, 100); assert.equal(run.runningCount, 0);
  assert.equal(batch.getRun('owner', p.id, run.id, { limit: 100 }).items.length, 100);
  assert.equal(run.sources[0].name, path.basename(sourceFile));
  p.draft.lists[0].name = 'Renamed later'; p = save(p);
  assert.equal(batch.getRun('owner', p.id, run.id).sources[0].listName, 'Nguồn gốc', 'filters describe frozen inputs');
  const render = (owner, timelineId, options) => {
    const jobId = `job-${options.idempotencyKey}`;
    db.prepare("INSERT INTO video_render_jobs(id,owner_id,project_id,status,pinned_seq) VALUES (?,?,?,'queued',?)").run(jobId, owner, timelineId, options.baseRevision);
    return { jobId };
  };
  const selected = batch.renderSelected('owner', p.id, run.id, { rowIndexes: [0, 21, 99], selectionKey: 'render-selection', expectedSeqs: { 0: 0, 21: 0, 99: 0 } }, render);
  assert.equal(selected.results.length, 3); assert.equal(batch.runs('owner', p.id)[0].runningCount, 3);
  assert.throws(() => management.archiveOutputs('owner', p.id, run.id, { rowIndexes: [1, 99] }), /render hoàn tất/);
  assert.equal(batch.getRun('owner', p.id, run.id).items[1].archived, false, 'blocked group archive leaves all rows unchanged');
  assert.throws(() => management.archiveOutputs('other', p.id, run.id, { rowIndexes: [0] }), e => e.status === 404);
  assert.throws(() => management.archiveOutputs('owner', p.id, run.id, { rowIndexes: [1, 101] }), e => e.status === 404);
  for (const [index, entry] of selected.results.entries()) {
    const file = path.join(root, `export-${index}.mp4`); fs.writeFileSync(file, `verified-mp4-${index}`);
    db.prepare("UPDATE video_render_jobs SET status='done',output_path=?,manifest_json='{}' WHERE id=?").run(file, entry.jobId);
  }
  assert.equal(batch.runs('owner', p.id)[0].pendingCount, 97);
  assert.equal(batch.runs('owner', p.id)[0].runningCount, 0);
  projects.applyCommand(run.items[0].timelineId, { type: 'SetProperty', args: { path: ['tracks', 0, 'clips', 0, 'transform', 'opacity'], from: 1, to: .5 } });
  assert.equal(batch.runs('owner', p.id)[0].pendingCount, 98, 'new saved edits need a new render');
  assert.deepEqual(management.downloadFiles('owner', p.id, run.id, [0, 21, 99]).map(f => f.name),
    ['nguồn giữ lại.mp4', 'nguồn giữ lại_2.mp4', 'nguồn giữ lại_3.mp4']);
  assert.throws(() => management.downloadFiles('owner', p.id, run.id, [1]), /chưa có bản render/);
  assert.throws(() => management.downloadFiles('other', p.id, run.id, [0]), e => e.status === 404);
  const removed = management.archiveOutputs('owner', p.id, run.id, { rowIndexes: [0, 21] });
  assert.equal(removed.activeCount, 98); assert.equal(removed.pendingCount, 97);
  assert.equal(management.trash('owner').outputs.length, 2);
  assert.equal(management.trash('other').outputs.length, 0);
  assert.throws(() => management.downloadFiles('owner', p.id, run.id, [0]), e => e.status === 409);
  assert.throws(() => batch.renderSelected('owner', p.id, run.id, { rowIndexes: [0], selectionKey: 'archived-render' }, render), /Khôi phục timeline/);
  management.archiveOutputs('owner', p.id, run.id, { rowIndexes: [0, 21], restore: true });
  assert.equal(management.trash('owner').outputs.length, 0);
  assert.equal(batch.runs('owner', p.id)[0].activeCount, 100);

  // HTTP route validates the complete selection before starting a ZIP response.
  const app = require('express')(); app.use(require('express').json()); app.use((req, res, next) => { req.user = { id: req.headers['x-owner'] || 'owner' }; next(); }); app.use('/batch', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/batch`;
  try {
    const response = await fetch(`${base}/${p.id}/runs/${run.id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndexes: [0, 21, 99] }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /zip/);
    const zip = Buffer.from(await response.arrayBuffer()); assert.equal(zip.readUInt32LE(0), 0x04034b50);
    for (const file of management.downloadFiles('owner', p.id, run.id, [0, 21, 99])) assert.ok(zip.includes(Buffer.from(file.name)), file.name);
    const invalid = await fetch(`${base}/${p.id}/runs/${run.id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndexes: [0, 1] }) });
    assert.equal(invalid.status, 409); assert.match(invalid.headers.get('content-type'), /json/);
    const denied = await fetch(`${base}/${p.id}/runs/${run.id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner': 'other' }, body: JSON.stringify({ rowIndexes: [0] }) });
    assert.equal(denied.status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }

  let b = batch.create('owner', { id: 'dependent', name: 'Depends on Controls' });
  b = batch.pinTemplate('owner', b.id, { expectedRevision: b.revision, projectId: run.items[0].timelineId, versionId: run.items[0].versionId });
  assert.throws(() => management.purgeProjects('owner', [{ id: p.id, revision: p.revision }]), /thùng rác/);
  p = archive(p.id);
  assert.throws(() => management.purgeProjects('owner', [{ id: p.id, revision: p.revision - 1 }]), /đúng bản/);
  assert.throws(() => management.purgeProjects('other', [{ id: p.id, revision: p.revision }]), e => e.status === 404);
  assert.throws(() => management.purgeProjects('owner', [{ id: p.id, revision: p.revision }]), /tham chiếu/);
  assert.equal(batch.runs('owner', p.id).length, 1, 'external pin rejection rolls back metadata removal');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_batch_run_items').get().n, 100);
  management.restoreProjects('owner', [{ id: p.id, revision: p.revision }]);
  assert.equal(batch.get('owner', p.id).archived, false);
  b = batch.pinTemplate('owner', b.id, { expectedRevision: b.revision, versionId: null });
  p = archive(p.id); b = archive(b.id);
  // A second restore failure must undo the first member's collection/timelines.
  db.exec(`CREATE TRIGGER reject_second_restore BEFORE UPDATE OF archived_at ON video_timeline_collections
    WHEN OLD.id='${b.collectionId}' AND NEW.archived_at IS NULL BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END`);
  assert.throws(() => management.restoreProjects('owner', [{ id: p.id, revision: p.revision }, { id: b.id, revision: b.revision }]), /injected restore failure/);
  assert.equal(batch.get('owner', p.id).archived, true);
  assert.equal(batch.get('owner', p.id).revision, p.revision);
  assert.ok(db.prepare('SELECT archived_at FROM video_projects WHERE id=?').get(run.items[0].timelineId).archived_at);
  db.exec('DROP TRIGGER reject_second_restore');
  db.prepare("INSERT INTO video_batch_deliveries(id,owner_id,run_id,row_index,request_key,intent_json) VALUES ('pending-delivery','owner',?,0,'pending-delivery','{}')").run(run.id);
  assert.throws(() => management.purgeProjects('owner', [{ id: p.id, revision: p.revision }, { id: b.id, revision: b.revision }]), /giao file/);
  assert.equal(batch.get('owner', b.id).archived, true);
  db.prepare("DELETE FROM video_batch_deliveries WHERE id='pending-delivery'").run();
  // A durable external compound history also blocks the cascade, even after Lab refs clear.
  const outside = projects.batchCreateFromVideos('owner', { mode: 'all-selected-one-timeline', orderedAssetIds: ['source'], baseName: 'Outside' });
  const externalId = outside.createdTimelineIds[0];
  if (!externalId) throw new Error(`Unexpected project fixture: ${JSON.stringify(outside)}`);
  db.prepare('INSERT INTO video_project_commands(id,project_id,seq,type,args_json) VALUES (?,?,99,?,?)').run('external-ref', externalId, 'InsertClip', JSON.stringify({ clip: { compoundRef: { timelineProjectId: run.items[0].timelineId } } }));
  assert.throws(() => management.purgeProjects('owner', [{ id: p.id, revision: p.revision }]), /tham chiếu/);
  db.prepare("DELETE FROM video_project_commands WHERE id='external-ref'").run();
  const purged = management.purgeProjects('owner', [{ id: p.id, revision: p.revision }, { id: b.id, revision: b.revision }]);
  assert.deepEqual(purged.deletedProjectIds, [p.id, b.id]); assert.equal(purged.deletedTimelineIds.length, 100);
  assert.throws(() => batch.get('owner', p.id), e => e.status === 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_batch_run_items').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_assets WHERE id='source'").get().n, 1);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'unchanged-source');
  assert.equal(fs.existsSync(path.join(root, 'export-0.mp4')), true);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS Batch controls: 100-row pending counts/frozen sources, archive/restore, owner/jobs/dependency/revision guards, atomic purge and owner-checked ZIP');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  db.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('sf-batch-controls-'));
  fs.rmSync(root, { recursive: true, force: true });
});
