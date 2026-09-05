// 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md): CRUD for
// video_timeline_collections — a collection groups video_projects rows (each already a legacy
// Timeline on its own), it never touches how any one timeline's own content is edited (that stays
// POST /api/video-projects/:id/commands, unchanged).
// 08-B B6 (specs/.../08-v2/08-b-composition-document-and-versioning.md): archive/restore/permanent-
// delete/detach below — same soft-delete shape as video-projects.js's E7 precedent. Archiving or
// deleting a collection NEVER cascades to its member video_projects rows: a member timeline stays
// independently accessible via its own id even while its collection is archived — only
// collection-level listing/grouping is affected. Detach clears a project's collection_id without
// touching that project's own archived_at.

const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function requireOwner(req, res, row) {
  if (!row) {
    res.status(404).json({ error: 'Không tìm thấy collection' });
    return false;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: 'Chỉ chủ sở hữu mới truy cập được collection này' });
    return false;
  }
  return true;
}

// 08-B B6: like requireOwner, but also 404s on a collection in the trash (archived_at set) — mirrors
// video-projects.js's requireActiveOwner. Caller's SELECT must include archived_at for this to see it.
function requireActiveOwner(req, res, row) {
  if (row?.archived_at) row = undefined;
  return requireOwner(req, res, row);
}

router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, created_at, updated_at FROM video_timeline_collections WHERE owner_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

// 08-B B6: "Thùng rác" list, mirrors video-projects.js's GET /archived — registered before GET
// '/:id' so Express's `:id` matcher doesn't swallow this literal path first.
router.get('/archived', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, created_at, updated_at, archived_at FROM video_timeline_collections WHERE owner_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu name' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)').run(id, req.user.id, name);
  res.json({ id });
});

// GET /:id -> collection metadata + its member timelines (video_projects rows), same shape
// GET /api/video-projects returns so ProjectSwitcher-style UI can reuse it directly (08-F F6's
// Dashboard baseline).
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  const timelines = db.prepare(
    'SELECT id, name, created_at, updated_at FROM video_projects WHERE collection_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
  ).all(req.params.id);
  res.json({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, timelines });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu name' });
  db.prepare("UPDATE video_timeline_collections SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
  res.json({ success: true });
});

// archiveCollection/restoreCollection/permanentlyDeleteCollection(collectionId) -> void, or throws
// (caller maps to 400) — extracted like video-projects.js's equivalents so
// video-timeline-collections.test.js can exercise the permanent-delete guard directly.
function archiveCollection(collectionId) {
  db.prepare("UPDATE video_timeline_collections SET archived_at = datetime('now') WHERE id = ?").run(collectionId);
}

function restoreCollection(collectionId) {
  db.prepare('UPDATE video_timeline_collections SET archived_at = NULL WHERE id = ?').run(collectionId);
}

// Only allowed from the trash (archived_at already set) — same guard as permanentlyDeleteProject,
// so a client can't skip the trash step and lose a collection with no recovery path. Member
// video_projects rows are NOT touched — no cascade, they just lose their collection_id below via
// the explicit /detach route, or simply keep pointing at a now-nonexistent id (harmless: every read
// of collection_id is only ever used to join for listing, never dereferenced as a hard requirement).
function permanentlyDeleteCollection(collectionId) {
  const row = db.prepare('SELECT archived_at FROM video_timeline_collections WHERE id = ?').get(collectionId);
  if (!row?.archived_at) throw new Error('Collection phải ở trong thùng rác trước khi xoá vĩnh viễn');
  db.prepare('UPDATE video_projects SET collection_id = NULL WHERE collection_id = ?').run(collectionId);
  db.prepare('DELETE FROM video_timeline_collections WHERE id = ?').run(collectionId);
}

// 08-B B6: soft-delete ("move to trash") — no cascade to member video_projects rows, they stay
// independently accessible via their own id, just no longer grouped under this collection while
// it's archived.
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  archiveCollection(req.params.id);
  res.json({ success: true });
});

// 08-B B6: undo an archive — clears archived_at so the collection reappears in GET '/'.
router.post('/:id/restore', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  restoreCollection(req.params.id);
  res.json({ success: true });
});

// 08-B B6: the actual irreversible delete — only from the trash. Member projects are detached
// (collection_id cleared), never deleted.
router.delete('/:id/permanent', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  try {
    permanentlyDeleteCollection(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// detachTimeline(collectionId, timelineId) -> void, throws on a timeline that isn't actually a
// member of collectionId (caller maps to 400) — sets that video_projects row's collection_id to
// NULL, leaves its own archived_at untouched. Ownership of both rows is checked by the route
// handler before calling this (same split as permanentlyDeleteCollection above: route checks
// req.user vs owner_id, this function only checks structural membership).
function detachTimeline(collectionId, timelineId) {
  const timeline = db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(timelineId);
  if (!timeline) throw new Error('Không tìm thấy timeline');
  if (timeline.collection_id !== collectionId) throw new Error('Timeline này không thuộc collection đã cho');
  db.prepare("UPDATE video_projects SET collection_id = NULL, updated_at = datetime('now') WHERE id = ?").run(timelineId);
}

// 08-B B6: detach ONE member timeline from this collection without archiving/deleting either side.
router.post('/:id/detach/:timelineId', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_timeline_collections WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  const timeline = db.prepare('SELECT owner_id FROM video_projects WHERE id = ?').get(req.params.timelineId);
  if (!timeline || timeline.owner_id !== req.user.id) {
    return res.status(404).json({ error: 'Không tìm thấy timeline' });
  }
  try {
    detachTimeline(req.params.id, req.params.timelineId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports.archiveCollection = archiveCollection; // exported for video-timeline-collections.test.js only
module.exports.restoreCollection = restoreCollection; // exported for video-timeline-collections.test.js only
module.exports.permanentlyDeleteCollection = permanentlyDeleteCollection; // exported for video-timeline-collections.test.js only
module.exports.detachTimeline = detachTimeline; // exported for video-timeline-collections.test.js only
