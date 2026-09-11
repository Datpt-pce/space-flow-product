// 08-B B6 (specs/ai-creative-operations-platform/08-v2/08-b-composition-document-and-versioning.md):
// collection lifecycle — archive/restore/permanent-delete/detach. Proves the no-cascade contract
// directly against the DB: archiving/deleting a collection never touches its member video_projects
// rows (they stay independently accessible), same style as video-projects.test.js's E7 tests for
// archiveProject/restoreProject/permanentlyDeleteProject.
//
// Run with: node backend/routes/video-timeline-collections.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const {
  archiveCollection, restoreCollection, permanentlyDeleteCollection, detachTimeline,
} = require('./video-timeline-collections');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function makeCollection(ownerId, name = 'Test Collection') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)').run(id, ownerId, name);
  return id;
}

function makeProject(ownerId, collectionId = null, name = 'Test Project') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload, collection_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, name, '{}', collectionId);
  return id;
}

function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `video-timeline-collections-test-sub-${ownerId}`, `video-timeline-collections-test-${ownerId}@space-flow.local`, 'Collection Test User', 'member');

  const collectionIds = [];
  const projectIds = [];
  try {
    check('archiveCollection(): sets archived_at; row still exists', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      archiveCollection(collectionId);
      const row = db.prepare('SELECT archived_at FROM video_timeline_collections WHERE id = ?').get(collectionId);
      assert.ok(row.archived_at, 'archived_at should be set after archiveCollection()');
    });

    check('restoreCollection(): clears archived_at', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      archiveCollection(collectionId);
      restoreCollection(collectionId);
      const row = db.prepare('SELECT archived_at FROM video_timeline_collections WHERE id = ?').get(collectionId);
      assert.strictEqual(row.archived_at, null, 'archived_at should be cleared after restoreCollection()');
    });

    check('archiveCollection(): does NOT cascade — member project stays untouched, no archived_at set on it', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      const projectId = makeProject(ownerId, collectionId);
      projectIds.push(projectId);
      archiveCollection(collectionId);
      const row = db.prepare('SELECT archived_at, collection_id FROM video_projects WHERE id = ?').get(projectId);
      assert.strictEqual(row.archived_at, null, 'member project must NOT be archived when its collection is archived');
      assert.strictEqual(row.collection_id, collectionId, 'member project must stay grouped under the (archived) collection');
    });

    check('permanentlyDeleteCollection(): rejects a collection that is not archived first', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      assert.throws(() => permanentlyDeleteCollection(collectionId), /thùng rác/);
    });

    check('permanentlyDeleteCollection(): deletes an archived collection for real, and detaches (not deletes) member projects', () => {
      const collectionId = makeCollection(ownerId);
      const projectId = makeProject(ownerId, collectionId);
      projectIds.push(projectId);
      archiveCollection(collectionId);
      permanentlyDeleteCollection(collectionId);

      const collectionRow = db.prepare('SELECT * FROM video_timeline_collections WHERE id = ?').get(collectionId);
      assert.strictEqual(collectionRow, undefined, 'collection row should be gone after permanentlyDeleteCollection()');

      const projectRow = db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(projectId);
      assert.ok(projectRow, 'member project row must survive collection permanent-delete — no cascade');
      assert.strictEqual(projectRow.collection_id, null, 'member project must be detached (collection_id cleared), not left dangling');
    });

    check('detachTimeline(): clears collection_id on the given project, leaves its archived_at untouched', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      const projectId = makeProject(ownerId, collectionId);
      projectIds.push(projectId);
      detachTimeline(collectionId, projectId);
      const row = db.prepare('SELECT collection_id, archived_at FROM video_projects WHERE id = ?').get(projectId);
      assert.strictEqual(row.collection_id, null);
      assert.strictEqual(row.archived_at, null, 'detach must never touch the project\'s own archived_at');
    });

    check('detachTimeline(): rejects a timeline that does not actually belong to the given collection', () => {
      const collectionId = makeCollection(ownerId);
      const otherCollectionId = makeCollection(ownerId);
      collectionIds.push(collectionId, otherCollectionId);
      const projectId = makeProject(ownerId, otherCollectionId);
      projectIds.push(projectId);
      assert.throws(() => detachTimeline(collectionId, projectId), /không thuộc/);
      const row = db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(projectId);
      assert.strictEqual(row.collection_id, otherCollectionId, 'a rejected detach must not mutate the project row');
    });

    check('detachTimeline(): rejects a nonexistent timeline id', () => {
      const collectionId = makeCollection(ownerId);
      collectionIds.push(collectionId);
      assert.throws(() => detachTimeline(collectionId, crypto.randomUUID()), /Không tìm thấy/);
    });
  } finally {
    for (const id of projectIds) db.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
    for (const id of collectionIds) db.prepare('DELETE FROM video_timeline_collections WHERE id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
