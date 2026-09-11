const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'),('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const batch = require('../routes/video-batch').service;
const save = p => batch.save('owner', p.id, { expectedRevision: p.revision, name: p.name, draft: p.draft });
try {
  for (const kind of ['video', 'audio']) for (let i = 1; i <= 3; i++) {
    const id = `${kind}-${i}`;
    db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES (?,'owner',?,?,2000,?,'ok')").run(id, `${id}.${kind === 'video' ? 'mp4' : 'wav'}`, id, kind);
  }
  let p = batch.create('owner', { id: 'selected-lab', name: 'Selected lab' });
  p.draft.lists = ['video', 'audio'].map(kind => ({ id: kind, name: kind, items: [1, 2, 3].map((n, order) => {
    const id = `${kind}-${n}`; return { id, manualOrder: order, sourceRef: { kind: 'media', assetId: id, contentHash: id } };
  }) }));
  p.draft.tracks = [
    { id: 'visual', name: 'Hình', type: 'video', slots: [
      { id: 'left', listId: 'video', selectedItemIds: ['video-3', 'video-1'], vary: true, durationFrames: 30 },
      { id: 'right', listId: 'video', selectedItemIds: ['video-2'], vary: true, durationFrames: 30 },
    ] },
    { id: 'bgm', name: 'Nhạc nền', type: 'bgm', policy: 'loop', slots: [{ id: 'music', listId: 'audio', selectedItemIds: ['audio-3'], vary: false, durationFrames: 30 }] },
  ];
  p = save(p);
  assert.deepEqual(batch.get('owner', p.id).draft.tracks[0].slots[0].selectedItemIds, ['video-3', 'video-1']);
  let pre = batch.preflight('owner', p.id, { expectedRevision: p.revision });
  assert.equal(pre.totalCount, 2); assert.deepEqual(pre.issues, []);
  assert.deepEqual(pre.rows.map(r => r.assignments.map(a => a.itemId)), [['video-1', 'video-2', 'audio-3'], ['video-3', 'video-2', 'audio-3']]);
  const sample = batch.sample('owner', p.id, { expectedRevision: p.revision, rowIndex: 1 });
  assert.deepEqual(sample.document.tracks.find(t => t.type === 'video').clips.map(c => c.assetId), ['video-3', 'video-2']);
  assert.deepEqual([...new Set(sample.document.tracks.find(t => t.type === 'audio').clips.map(c => c.assetId))], ['audio-3'], 'compiler playlist matches frozen selected IDs');
  const run = batch.createRun('owner', p.id, { expectedRevision: p.revision, inputHash: pre.inputHash, idempotencyKey: 'selected-run' });
  assert.equal(run.count, 2);
  for (const ids of [null, 'video-1', ['video-1', 'video-1'], ['audio-1'], [42]]) {
    const invalid = structuredClone(p); invalid.draft.tracks[0].slots[0].selectedItemIds = ids;
    assert.throws(() => save(invalid), /Block/);
    assert.equal(batch.get('owner', p.id).revision, p.revision);
  }
  const mixed = structuredClone(p); mixed.draft.tracks[0].slots[0].fixedItemId = 'video-1';
  assert.throws(() => save(mixed), /Block/);
  p.draft.tracks[0].slots[0].selectedItemIds = []; p = save(p);
  assert.throws(() => batch.preflight('owner', p.id, { expectedRevision: p.revision }), /không có item/);
  assert.equal(batch.getRun('owner', p.id, run.id).count, 2, 'old run survives changed selection');
  delete p.draft.tracks[0].slots[0].selectedItemIds; p.draft.tracks[0].slots[0].fixedItemId = 'video-2'; p = save(p);
  pre = batch.preflight('owner', p.id, { expectedRevision: p.revision }); assert.equal(pre.totalCount, 1);
  p.name = 'Folder đổi tên'; p.draft.lists[0].name = 'List đổi tên'; p = save(p);
  assert.equal(batch.get('owner', p.id).name, 'Folder đổi tên');
  assert.equal(batch.get('owner', p.id).draft.tracks[0].slots[1].listId, 'video');
  assert.equal(batch.getRun('owner', p.id, run.id).sources.find(s => s.listId === 'video').listName, 'video');
  assert.throws(() => batch.save('other', p.id, { expectedRevision: p.revision, name: 'wrong owner', draft: p.draft }), e => e.status === 404);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS selected Lab sources: independent subsets, exact rows, compiled BGM, invalid selections, persistence, legacy fixed, rename and immutable runs');
} finally { db.close(); }
