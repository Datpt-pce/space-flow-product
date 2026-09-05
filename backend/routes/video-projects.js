// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): CRUD for a video
// project + the ONLY way its state ever changes (POST /:id/commands, running
// shared/video-commands against the CURRENT recovered state). No team-sharing/visibility concept
// yet (unlike backend/routes/workflows.js) — Phase 1's task checklist never asked for one; a
// project is private to its owner until a later phase says otherwise.

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const { runCommand, prepareTrackCleanup } = require('../../shared/video-commands');
const { migrateCompositionDocument } = require('../../shared/video-document-schema');
const { buildLegacyProjection } = require('../video/timelineAdapter');

const SNAPSHOT_INTERVAL = 20;
const router = express.Router();

// recoverProjectState(projectId, uptoSeq?) -> state at uptoSeq (default: latest), ALWAYS
// reconstructed from the latest snapshot at-or-before uptoSeq + replaying commands up to and
// including uptoSeq (never from video_projects.payload, which is only a best-effort display cache
// — see backend/video/schema.js's header comment for why). Every project has a seq=0 snapshot from
// creation time, so there is always a well-defined anchor to replay from, even for a project with
// zero real commands yet. uptoSeq is what 08-D D2's idempotent-retry path (POST /:id/commands
// below) uses to reconstruct the exact CommandResult an earlier, already-applied command produced,
// without needing to store the resulting payload a second time.
function recoverProjectState(projectId, uptoSeq = Number.MAX_SAFE_INTEGER) {
  const snapshot = db.prepare(
    'SELECT seq, payload FROM video_project_snapshots WHERE project_id = ? AND seq <= ? ORDER BY seq DESC LIMIT 1'
  ).get(projectId, uptoSeq);
  if (!snapshot) throw new Error(`Project has no snapshot at all (data inconsistency): ${projectId}`);

  let state = JSON.parse(snapshot.payload);
  const commands = db.prepare(
    'SELECT seq, type, args_json FROM video_project_commands WHERE project_id = ? AND seq > ? AND seq <= ? ORDER BY seq ASC'
  ).all(projectId, snapshot.seq, uptoSeq);
  for (const cmd of commands) {
    state = runCommand(state, cmd.type, JSON.parse(cmd.args_json));
  }
  return state;
}

// getLatestCommandSeq(projectId) -> highest committed command seq, or 0 if none yet (mirrors the
// seq=0-is-the-creation-anchor convention documented in backend/video/schema.js). Shared by the
// commands write path and the 08-B timeline-collection projection below, so both agree on what
// "latest" means.
function getLatestCommandSeq(projectId) {
  const row = db.prepare('SELECT MAX(seq) AS maxSeq FROM video_project_commands WHERE project_id = ?').get(projectId);
  return row.maxSeq ?? 0;
}

function requireOwner(req, res, row) {
  if (!row) {
    res.status(404).json({ error: 'Không tìm thấy project' });
    return false;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: 'Chỉ chủ sở hữu mới truy cập được project này' });
    return false;
  }
  return true;
}

// 08-E E7: like requireOwner, but also 404s on a project in the trash (archived_at set) — every
// route that reads/edits a project's CONTENT (not the archive/restore/permanent-delete/list-trash
// routes themselves) uses this, so a trashed project degrades exactly like the old hard-delete did
// (E4's existing "project not found" recovery screen) instead of staying silently editable via a
// stale deep link. The caller's SELECT must include archived_at for this check to see it.
function requireActiveOwner(req, res, row) {
  if (row?.archived_at) row = undefined; // treat like not-found, same message/status as a missing row
  return requireOwner(req, res, row);
}

// 08-B B2 / ADR 0033: `collection_id` (aliased `collectionId`, camelCase like every other field
// this route returns) lets a caller group timelines created together (F7's Gallery batch-create) —
// null for every standalone project, unaffected.
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, created_at, updated_at, collection_id AS collectionId FROM video_projects WHERE owner_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

// 08-E E7: "Thùng rác" list for ProjectSwitcher's trash panel — registered before GET '/:id' so
// Express's `:id` matcher doesn't swallow this literal path first.
router.get('/archived', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, created_at, updated_at, archived_at FROM video_projects WHERE owner_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

router.get('/workspace-groups', (req, res) => {
  const timelines = db.prepare('SELECT id, name, collection_id AS collectionId FROM video_projects WHERE owner_id = ? AND archived_at IS NULL ORDER BY created_at, id').all(req.user.id);
  const groups = db.prepare('SELECT id, name FROM video_timeline_collections WHERE owner_id = ? AND archived_at IS NULL').all(req.user.id)
    .map(group => ({ ...group, timelines: timelines.filter(t => t.collectionId === group.id) }));
  for (const timeline of timelines.filter(t => !groups.some(g => g.id === t.collectionId))) groups.push({ id: `standalone:${timeline.id}`, name: timeline.name, timelines: [timeline] });
  res.json(groups);
});

router.post('/:id/sibling', (req, res) => {
  const row = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  const { name, payload } = req.body;
  if (typeof name !== 'string' || !name.trim() || !payload) return res.status(400).json({ error: 'Thiếu tên hoặc nội dung timeline' });
  let transaction = false;
  try {
    require('../../shared/video-commands/invariants').assertAllInvariants(payload);
    db.exec('BEGIN'); transaction = true;
    let collectionId = row.collection_id;
    if (collectionId && !db.prepare('SELECT id FROM video_timeline_collections WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(collectionId, req.user.id)) collectionId = null;
    if (!collectionId) {
      collectionId = crypto.randomUUID();
      db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)').run(collectionId, req.user.id, row.name);
      db.prepare('UPDATE video_projects SET collection_id = ? WHERE id = ?').run(collectionId, row.id);
    }
    const id = insertProjectRow(req.user.id, name.trim().slice(0, 200), payload, collectionId);
    db.exec('COMMIT'); transaction = false; res.json({ id, collectionId });
  } catch (err) { if (transaction) db.exec('ROLLBACK'); res.status(400).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  try {
    res.json({
      id: row.id, name: row.name, collectionId: row.collection_id, schemaVersion: row.schema_version, payload: recoverProjectState(row.id),
      // 08-E E5 (specs/.../08-v2/08-e-editor-node-and-workbench.md): the seq this payload was built
      // from — frontend/src/video/store.js tracks it as `currentRevision` so a later cheap
      // GET /:id/revision poll can detect "another tab/session moved this project forward since I
      // opened it" without re-fetching/rebuilding the whole document.
      seq: getLatestCommandSeq(row.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 08-E E5: a DELIBERATELY cheap sibling of GET /:id — only the latest command seq (a single
// MAX(seq) query, no recoverProjectState() replay/reconstruction) so a tab can poll "has the
// project moved since I last saw it" (e.g. on visibilitychange, VideoWorkspace.jsx) without paying
// full-document-rebuild cost on every check.
router.get('/:id/revision', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  res.json({ seq: getLatestCommandSeq(req.params.id) });
});

// GET /:id/state-at-seq/:seq — 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-
// slice.md): Unpack needs the EXACT nested-timeline content that was actually rendered into a
// compound clip's asset (pinned at embed time via compoundRef.pinnedSeq), not whatever the nested
// project has since drifted to — GET /:id above only ever returns the LATEST state. Read-only,
// reuses recoverProjectState() unchanged (no new reconstruction logic).
router.get('/:id/state-at-seq/:seq', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  const seq = Number(req.params.seq);
  if (!Number.isInteger(seq) || seq < 0) return res.status(400).json({ error: 'seq không hợp lệ' });
  try {
    res.json({ payload: recoverProjectState(req.params.id, seq) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  const { name, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: 'Thiếu name hoặc payload (project JSON ban đầu)' });

  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, name, payloadJson);
  // seq=0 snapshot — the recovery anchor every later command replays from, see
  // recoverProjectState()'s own comment.
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
    .run(crypto.randomUUID(), id, payloadJson);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu name' });
  db.prepare("UPDATE video_projects SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
  res.json({ success: true });
});

// archiveProject/restoreProject/permanentlyDeleteProject(projectId) -> void, or throws (caller
// maps to 400) — 08-E E7: extracted like applyCommand()/batchCreateFromVideos() below so
// video-projects.test.js can exercise the permanent-delete guard directly without an HTTP layer.
function archiveProject(projectId) {
  db.prepare("UPDATE video_projects SET archived_at = datetime('now') WHERE id = ?").run(projectId);
}

function restoreProject(projectId) {
  db.prepare('UPDATE video_projects SET archived_at = NULL WHERE id = ?').run(projectId);
}

// Only allowed from the trash (archived_at already set) — so a client can't skip the trash step
// and lose a project with no recovery path.
function permanentlyDeleteProject(projectId) {
  const row = db.prepare('SELECT archived_at FROM video_projects WHERE id = ?').get(projectId);
  if (!row?.archived_at) throw new Error('Project phải ở trong thùng rác trước khi xoá vĩnh viễn');
  db.prepare('DELETE FROM video_projects WHERE id = ?').run(projectId);
}

// 08-E E7: soft-delete ("move to trash") — was a hard DELETE before this work package; changed to
// reversible per owner decision (no signal existed for needing recovery, but building a recycle bin
// is cheap once asked for). Hidden from GET '/'; re-archiving an already-archived project is a
// no-op (idempotent retry-safe).
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  archiveProject(req.params.id);
  res.json({ success: true });
});

// 08-E E7: undo an archive — clears archived_at so the project reappears in GET '/' and
// ProjectSwitcher's main list.
router.post('/:id/restore', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  restoreProject(req.params.id);
  res.json({ success: true });
});

// 08-E E7: the actual irreversible delete (cascades to commands/snapshots/render jobs, same as the
// old hard-delete behavior).
router.delete('/:id/permanent', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireOwner(req, res, row)) return;
  try {
    permanentlyDeleteProject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// getResultForSeq(projectId, seq) -> the CommandResult shape a client would have received had it
// gotten the response for the command committed at `seq` — used to answer an idempotent retry with
// the SAME result instead of re-applying (08-D D2).
function getResultForSeq(projectId, seq) {
  return { success: true, seq, payload: recoverProjectState(projectId, seq), idempotent: true };
}

// CommandConflictError/CommandRejectedError: applyCommand() throws these (never a bare Error) for
// the two "the client did something wrong or stale, not a server fault" cases, each carrying the
// exact { status, body } the route below sends back — so the HTTP mapping lives in exactly one
// place (the route's catch) instead of being duplicated by every future caller of applyCommand().
class CommandConflictError extends Error {
  constructor(body) { super('conflict'); this.status = 409; this.body = body; }
}
class CommandRejectedError extends Error {
  constructor(message) { super(message); this.status = 400; this.body = { error: message }; }
}

// applyCommand(projectId, { type, args, idempotencyKey, baseRevision }) -> CommandResult, or throws
// CommandConflictError/CommandRejectedError. The ONLY write path for project state. validate()
// (inside runCommand, see shared/video-commands/index.js) throws BEFORE anything is persisted if
// the command would violate an invariant — Phase 1 acceptance criteria: "command vi phạm invariant
// bị validate() reject trước apply(), message rõ". Exported (like recoverProjectState/
// batchCreateFromVideos above) for backend/routes/video-projects.test.js to call directly instead
// of needing an HTTP layer.
//
// 08-D (specs/ai-creative-operations-platform/08-v2/08-d-durable-editing-transactions.md, work
// package D2) + ADR 0030 Follow-Up: `idempotencyKey` and `baseRevision` are OPTIONAL, additive to
// the existing contract — a caller that omits them gets exactly the pre-08-D behavior
// (unconditional apply), so this does not break the current frontend
// (frontend/src/video/store.js) until it's updated to send them. `idempotencyKey` prevents a
// retried request (e.g. after a client timeout that actually succeeded server-side) from applying
// the command twice — enforced primarily by the DB unique index in backend/video/schema.js, with
// an app-level pre-check here so a normal retry gets a clean result instead of a raw constraint
// error. `baseRevision` implements 08-D §3 "Base revision mismatch trả conflict contract, không
// last-write-wins" — if the client's last-known revision no longer matches the latest committed
// seq, this rejects with a conflict instead of silently applying on top of a change the client
// hasn't seen yet.
function applyCommand(projectId, { type, args, idempotencyKey, baseRevision }) {
  if (!type || !args) throw new CommandRejectedError('Thiếu type hoặc args');

  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT seq FROM video_project_commands WHERE project_id = ? AND idempotency_key = ?'
    ).get(projectId, idempotencyKey);
    if (existing) return getResultForSeq(projectId, existing.seq);
  }

  if (baseRevision !== undefined && baseRevision !== null) {
    const currentSeq = getLatestCommandSeq(projectId);
    if (baseRevision !== currentSeq) {
      throw new CommandConflictError({ error: 'conflict', reason: 'base_revision_mismatch', baseRevision, currentRevision: currentSeq });
    }
  }

  let currentState;
  let newState;
  try {
    currentState = recoverProjectState(projectId);
    args = prepareTrackCleanup(currentState, type, args);
    newState = runCommand(currentState, type, args);
  } catch (err) {
    throw new CommandRejectedError(err.message);
  }

  const seq = getLatestCommandSeq(projectId) + 1;
  const newStateJson = JSON.stringify(newState);

  try {
    db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), projectId, seq, type, JSON.stringify(args), idempotencyKey || null);
  } catch (err) {
    // Belt-and-suspenders for a concurrent-request race on the same idempotency key hitting the DB
    // unique index after both passed the pre-check above — in practice node:sqlite's DatabaseSync
    // runs every statement in this function synchronously with no await in between, so two requests
    // for the same project never actually interleave (ADR 0018), but this keeps the function
    // correct even if that execution model ever changes.
    if (idempotencyKey && /UNIQUE/i.test(err.message)) {
      const existing = db.prepare(
        'SELECT seq FROM video_project_commands WHERE project_id = ? AND idempotency_key = ?'
      ).get(projectId, idempotencyKey);
      if (existing) return getResultForSeq(projectId, existing.seq);
    }
    throw err;
  }

  db.prepare("UPDATE video_projects SET payload = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStateJson, projectId);
  if (seq % SNAPSHOT_INTERVAL === 0) {
    db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), projectId, seq, newStateJson);
  }

  return { success: true, seq, payload: newState };
}

router.post('/:id/commands', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  try {
    res.json(applyCommand(req.params.id, req.body || {}));
  } catch (err) {
    if (err.status) return res.status(err.status).json(err.body);
    res.status(500).json({ error: err.message });
  }
});

// 08-B (specs/ai-creative-operations-platform/08-v2/08-b-composition-document-and-versioning.md,
// work packages B2/B3) + ADR 0030: projects a legacy project as a TimelineCollection/Timeline/
// TimelineVersion triple (backend/video/timelineAdapter.js) instead of the raw video_projects shape
// GET /:id returns. documentRef goes through migrateCompositionDocument() — the same lazy-migration
// path 08-B's future schema bumps will run through — so this endpoint proves the migrate-on-read
// wiring actually executes, not just that the module exists. Built on recoverProjectState(), so it
// inherits that function's crash-recovery guarantee (see video-projects.test.js) rather than
// re-deriving correctness from a different code path.
// 08-E E6 minimal (specs/.../08-v2/08-e-editor-node-and-workbench.md): "node card phản ánh...
// render state" — the node card already shows the save-version count (latestSeq, via `v{seq}` in
// VideoEditorWorkbenchNode.jsx); the genuinely missing piece was render state. No new table: reuses
// video_render_jobs (08-B B4's existing pinned_seq column) instead of inventing a named-version/
// review concept that doesn't exist anywhere else in the codebase yet (08-I review/QC hasn't been
// built — see 08-B/08-E Project Status for why a real pin/version chain stays out of scope here).
// isStale=true (conservative default) whenever there's no render job yet, or the most recent job's
// pinned_seq is missing/older than the current latest command seq — i.e. "this render may not
// reflect the latest edits." A null pinned_seq (pre-migration rows, or /retry's intentional
// "use current state" jobs) can't prove it's up to date, so it's never treated as fresh.
function getLatestRenderJob(projectId) {
  return db.prepare(
    'SELECT id, status, pinned_seq FROM video_render_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(projectId);
}

function getTimelineCollectionProjection(projectId) {
  const row = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(projectId);
  if (!row) throw new Error(`Project không tồn tại: ${projectId}`);
  const document = migrateCompositionDocument(recoverProjectState(projectId));
  const latestSeq = getLatestCommandSeq(projectId);
  const previousSeq = latestSeq > 0 ? latestSeq - 1 : null;
  const lastRenderJob = getLatestRenderJob(projectId);
  const renderState = {
    lastJobId: lastRenderJob ? lastRenderJob.id : null,
    lastJobStatus: lastRenderJob ? lastRenderJob.status : null,
    isStale: !lastRenderJob || lastRenderJob.pinned_seq == null || lastRenderJob.pinned_seq < latestSeq,
  };
  return { ...buildLegacyProjection(row, { latestSeq, previousSeq, document }), renderState };
}

router.get('/:id/timeline-collection', (req, res) => {
  const row = db.prepare('SELECT owner_id, archived_at FROM video_projects WHERE id = ?').get(req.params.id);
  if (!requireActiveOwner(req, res, row)) return;
  try {
    res.json(getTimelineCollectionProjection(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 08.2.4 (specs/ai-creative-operations-platform/08-2-4-asset-gallery-and-timeline-creation.md §3):
// "Với selection toàn video" — batch-create N timelines (= video_projects; backend/video/schema.js's
// own header: no separate `timelines` table exists yet, a project already IS one, see the
// 08.2.6+08.2.4 slice plan's "collection" scope decision) from a Gallery multi-selection.
// Synchronous, one DB transaction, no idempotency-key/progress infra — batch-create is cheap
// DB-only work (no ffmpeg), unlike a render job; see that same plan for why.
const DEFAULT_TIMELINE_PAYLOAD_BASE = {
  schemaVersion: 1,
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  colorSpace: 'sRGB',
  audioRate: 48000,
  sequence: { markers: [] },
  transitions: [],
};
// Mirrors frontend/src/video/defaultProject.js's shape exactly — that file is ESM (frontend-only),
// duplicated here rather than wired cross-module for ~10 literal fields (see plan).

function buildSequentialClip(assetId, durationMs, timelineInMs) {
  return {
    id: crypto.randomUUID(), assetId, sourceInMs: 0, sourceOutMs: durationMs,
    timelineInMs, timelineOutMs: timelineInMs + durationMs, speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [], keyframes: [],
  };
}

// uniqueName(candidate, takenNames) -> candidate, or candidate with a deterministic " (2)", " (3)"...
// suffix if already taken. `takenNames` is mutated by the caller (adding each result) so a batch
// creating several projects with the same base name (e.g. 2 videos named the same) still gets
// distinct names within itself, not just against pre-existing projects.
function uniqueName(candidate, takenNames) {
  if (!takenNames.has(candidate)) return candidate;
  let n = 2;
  while (takenNames.has(`${candidate} (${n})`)) n++;
  return `${candidate} (${n})`;
}

function insertProjectRow(ownerId, name, payload, collectionId) {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload, collection_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, name, payloadJson, collectionId || null);
  // seq=0 snapshot — same recovery-anchor convention as POST '/' above.
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
    .run(crypto.randomUUID(), id, payloadJson);
  return id;
}

// batchCreateFromVideos(ownerId, { mode, orderedAssetIds, baseName, collectionId? }) ->
// { createdTimelineIds, assetToTimelineIds, collectionId? } | throws BEFORE touching the DB
// (preflight fully resolved first) — a rejected batch creates nothing at all, per 08-2-4 §5 ("batch
// không partial mutate âm thầm"). Exported for backend/routes/video-projects.test.js only, same
// pattern importAsset()/relinkAsset() in video-assets.js already use.
//
// 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md): an explicit
// `collectionId` adds the new timeline(s) into that EXISTING collection (validated below). Without
// one, `one-video-one-timeline` (the mode that creates MULTIPLE timelines together) auto-creates a
// fresh collection to group them — the "these got made together" relationship this ADR's Follow-Up
// names as F7's real first consumer. `all-selected-one-timeline` only ever creates ONE timeline —
// no grouping value, stays standalone (collectionId: null) unless the caller passed one explicitly.
function batchCreateFromVideos(ownerId, { mode, orderedAssetIds, baseName, collectionId }) {
  if (mode !== 'all-selected-one-timeline' && mode !== 'one-video-one-timeline') {
    throw new Error(`Mode không hợp lệ: "${mode}"`);
  }
  if (!Array.isArray(orderedAssetIds) || orderedAssetIds.length === 0) {
    throw new Error('Thiếu orderedAssetIds (danh sách asset video đã chọn)');
  }
  if (collectionId) {
    const collection = db.prepare('SELECT owner_id FROM video_timeline_collections WHERE id = ?').get(collectionId);
    if (!collection) throw new Error(`Collection không tồn tại: ${collectionId}`);
    if (collection.owner_id !== ownerId) throw new Error(`Không có quyền dùng collection: ${collectionId}`);
  }

  const assets = orderedAssetIds.map((assetId) => {
    const row = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(assetId);
    if (!row) throw new Error(`Asset không tồn tại: ${assetId}`);
    if (row.owner_id !== ownerId) throw new Error(`Không có quyền dùng asset: ${assetId}`);
    if (row.kind !== 'video') throw new Error(`Asset "${assetId}" không phải video (kind=${row.kind})`);
    if (row.status !== 'ok' || !row.duration_ms) throw new Error(`Asset "${assetId}" chưa sẵn sàng (status=${row.status})`);
    return row;
  });

  const takenNames = new Set(
    db.prepare('SELECT name FROM video_projects WHERE owner_id = ?').all(ownerId).map((r) => r.name)
  );

  const createdTimelineIds = [];
  const assetToTimelineIds = {};
  let resolvedCollectionId = collectionId || null;

  db.exec('BEGIN');
  try {
    if (mode === 'all-selected-one-timeline') {
      let cursorMs = 0;
      const clips = assets.map((asset) => {
        const clip = buildSequentialClip(asset.id, asset.duration_ms, cursorMs);
        cursorMs += asset.duration_ms;
        return clip;
      });
      const payload = {
        ...DEFAULT_TIMELINE_PAYLOAD_BASE,
        tracks: [{ id: crypto.randomUUID(), type: 'video', order: 0, locked: false, muted: false, visible: true, clips }],
      };
      const name = uniqueName(baseName || 'Untitled Project', takenNames);
      takenNames.add(name);
      const projectId = insertProjectRow(ownerId, name, payload, resolvedCollectionId);
      createdTimelineIds.push(projectId);
      for (const asset of assets) assetToTimelineIds[asset.id] = projectId;
    } else {
      if (!resolvedCollectionId) {
        resolvedCollectionId = crypto.randomUUID();
        db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)')
          .run(resolvedCollectionId, ownerId, baseName || 'Untitled Collection');
      }
      for (const asset of assets) {
        const clip = buildSequentialClip(asset.id, asset.duration_ms, 0);
        const payload = {
          ...DEFAULT_TIMELINE_PAYLOAD_BASE,
          tracks: [{ id: crypto.randomUUID(), type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [clip] }],
        };
        const baseAssetName = path.basename(asset.source_path).replace(/\.[^.]+$/, '');
        const name = uniqueName(baseAssetName, takenNames);
        takenNames.add(name);
        const projectId = insertProjectRow(ownerId, name, payload, resolvedCollectionId);
        createdTimelineIds.push(projectId);
        assetToTimelineIds[asset.id] = projectId;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { createdTimelineIds, assetToTimelineIds, collectionId: resolvedCollectionId };
}

router.post('/batch-create-from-videos', (req, res) => {
  try {
    const result = batchCreateFromVideos(req.user.id, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports.recoverProjectState = recoverProjectState; // exported for backend/routes/video-projects.test.js AND backend/routes/video-assets.js's findProjectsReferencingAsset() (08-C C5)
module.exports.batchCreateFromVideos = batchCreateFromVideos; // exported for backend/routes/video-projects.test.js only
module.exports.getTimelineCollectionProjection = getTimelineCollectionProjection; // exported for backend/routes/video-projects.test.js only
module.exports.applyCommand = applyCommand; // exported for backend/routes/video-projects.test.js only
module.exports.getLatestCommandSeq = getLatestCommandSeq; // exported for backend/routes/video-render.js's render-request pinning (08-B B4) and backend/routes/video-projects.test.js
module.exports.archiveProject = archiveProject; // exported for backend/routes/video-projects.test.js only
module.exports.restoreProject = restoreProject; // exported for backend/routes/video-projects.test.js only
module.exports.permanentlyDeleteProject = permanentlyDeleteProject; // exported for backend/routes/video-projects.test.js only
