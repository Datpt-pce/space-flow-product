const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const service = require('../routes/video-batch').service;
const versions = require('../routes/video-versions').service;
const { planBatch } = require('../../shared/video-batch-planner');
const save = p => service.save('owner', p.id, { expectedRevision: p.revision, name: p.name, draft: p.draft });
try {
  let p = service.create('owner', { id: 'media-tracks', name: 'Separate sources' });
  const items = [['png', 'image', 0], ['jpg', 'image', 0], ['short', 'video', 6000], ['long', 'video', 7000], ['sound', 'audio', 1000]].map(([id, kind, duration], index) => {
    db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES (?,'owner',?,?,?,?, 'ok')").run(id, id, id, duration, kind);
    return { id, rating: 0, manualOrder: index, sourceRef: { kind: 'media', assetId: id, contentHash: id } };
  });
  p.draft.lists = [{ id: 'mixed', name: 'Mixed files', items }];
  p.draft.tracks = ['image', 'video'].map(mediaKind => ({ id: mediaKind, name: mediaKind, type: 'video', mediaKind,
    slots: [{ id: `${mediaKind}-slot`, listId: 'mixed', vary: true, durationMode: 'source', durationFrames: 150 }] }));
  p = save(p);
  assert.deepEqual(service.get('owner', p.id).draft.tracks.map(t => t.mediaKind), ['image', 'video']);
  const pre = service.preflight('owner', p.id, { expectedRevision: p.revision });
  assert.deepEqual(pre.issues, []);
  assert.equal(pre.totalCount, 4);
  assert.deepEqual(planBatch(pre.snapshot).axes.map(a => a.itemIds), [['png', 'jpg'], ['short', 'long']]);
  const run = service.createRun('owner', p.id, { expectedRevision: p.revision, inputHash: pre.inputHash, idempotencyKey: 'separate' });
  for (const item of run.items) {
    const doc = versions.get('owner', item.timelineId, item.versionId).document;
    assert.equal(doc.tracks.length, 2);
    assert.deepEqual(doc.tracks.map(t => t.type), ['video', 'video'], 'native editor retains visual lane schema');
    assert.ok(['png', 'jpg'].includes(doc.tracks[0].clips[0].assetId));
    assert.ok(['short', 'long'].includes(doc.tracks[1].clips[0].assetId));
    assert.ok(doc.tracks[0].order > doc.tracks[1].order);
    assert.equal(doc.tracks[0].clips[0].timelineOutMs, 5000);
    assert.equal(doc.tracks[1].clips[0].timelineOutMs, doc.tracks[1].clips[0].assetId === 'short' ? 6000 : 7000);
  }
  const imageSlot = p.draft.tracks[0].slots[0];
  imageSlot.fixedItemId = 'long'; p = save(p);
  assert.throws(() => service.preflight('owner', p.id, { expectedRevision: p.revision }), /không có item/);
  delete p.draft.tracks[0].slots[0].fixedItemId;
  p.draft.tracks[0].slots[0].selectedItemIds = ['long']; p = save(p);
  assert.throws(() => service.preflight('owner', p.id, { expectedRevision: p.revision }), /không có item/);
  p.draft.tracks[0].slots[0].selectedItemIds = ['jpg', 'long']; p = save(p);
  assert.equal(service.preflight('owner', p.id, { expectedRevision: p.revision }).totalCount, 2);
  for (const mediaKind of ['audio', 'visual', null]) {
    const invalid = structuredClone(p); invalid.draft.tracks[0].mediaKind = mediaKind;
    assert.throws(() => save(invalid), /Track không hợp lệ/);
  }
  const invalid = structuredClone(p); invalid.draft.tracks[1].type = 'audio';
  assert.throws(() => save(invalid), /Track không hợp lệ/);
  // Unmodified legacy mixed tracks retain all visual candidates and old pins.
  p.draft.tracks = [p.draft.tracks[0]];
  delete p.draft.tracks[0].mediaKind; delete p.draft.tracks[0].slots[0].selectedItemIds; p = save(p);
  const legacy = service.preflight('owner', p.id, { expectedRevision: p.revision });
  assert.equal(legacy.totalCount, 4);
  assert.deepEqual(planBatch(legacy.snapshot).axes[0].itemIds, ['png', 'jpg', 'short', 'long']);
  assert.equal(versions.get('owner', run.items[0].timelineId, run.items[0].versionId).document.tracks.length, 2);
  console.log('PASS BCL separate media tracks: mixed lists, pins, durations, invalid kinds, fixed/subset filters and legacy drafts');
} finally { db.close(); }
