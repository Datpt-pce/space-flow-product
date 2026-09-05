// 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md): BulkTimelineImportOperation — appends a
// user-picked set of assets onto several timelines at once (TimelineDashboard.jsx's multi-select,
// 08-F F6). Scope decision (not a formal ADR — doesn't change canonical model/public API): this is
// a deliberately reduced slice of the old 08-2-5 spec's much bigger Bulk Import flow —
//
// - Placement is always APPEND (each asset lands right after whatever a target's own visual/audio
//   zone track already has). The old spec's "conflict" preview column is structurally impossible
//   under always-append, so it's dropped rather than faked; there is no drag-to-arbitrary-position
//   for this operation.
// - "Permission"/locked-target handling: if a timeline's natural visual or audio track is locked, a
//   brand-new track is created instead (same auto-fallback UnpackCompoundClip.js already uses for
//   compound-clip unpack, see 08-F F5) rather than surfacing a blocking "permission" column that
//   has no real backing concept yet (review/QC "approved/published" status is 08-I, not built).
// - This whole operation runs SYNCHRONOUSLY inside one request — every step is a plain DB command
//   (shared/video-commands/BulkInsertClips.js), never an ffmpeg run, so there is no need for
//   video_render_jobs' async queued/running/done lifecycle. `results_json` is written back already
//   in its final state.
// - Undo is NOT implemented here — every add is a normal durable command each target timeline's own
//   Undo (Ctrl+Z, 08-D) already reverts one at a time; a single cross-timeline "undo this whole
//   operation" compensating action is deferred until a real signal asks for it, same "chưa có tín
//   hiệu cần" bar 08-B B6 (collection archive/delete) was held to.
//
// Per-target retry safety reuses 08-D's EXISTING command idempotency key
// (video_project_commands.idempotency_key, backend/video/schema.js) instead of inventing a second
// dedup mechanism: every target's BulkInsertClips call is keyed `${operationId}:${timelineId}`, so
// calling applyCommand() again for a target that already committed under that key just returns the
// original result — POST /:id/retry only bothers to loop over targets whose last result was an
// error, but even if it didn't, re-running a succeeded target would still be a safe no-op.

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { applyCommand, recoverProjectState } = require('./video-projects');
const { canonicalJson } = require('../../shared/video-document-diff');

const router = express.Router();

const DEFAULT_IMAGE_DURATION_MS = 3000;

function loadOwnedAssets(ownerId, orderedAssetIds) {
  return orderedAssetIds.map((assetId) => {
    const row = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(assetId);
    if (!row) throw new Error(`Asset không tồn tại: ${assetId}`);
    if (row.owner_id !== ownerId) throw new Error(`Không có quyền dùng asset: ${assetId}`);
    if (row.kind !== 'video' && row.kind !== 'image' && row.kind !== 'audio') {
      throw new Error(`Asset "${assetId}" có kind không hỗ trợ bulk import: ${row.kind}`);
    }
    if (row.status !== 'ok') throw new Error(`Asset "${assetId}" chưa sẵn sàng (status=${row.status})`);
    if (row.kind !== 'image' && !row.duration_ms) throw new Error(`Asset "${assetId}" chưa có thời lượng`);
    return row;
  });
}

function requireOwnedTimeline(ownerId, timelineId) {
  const row = db.prepare('SELECT id, name, archived_at FROM video_projects WHERE id = ? AND owner_id = ?').get(timelineId, ownerId);
  if (!row) throw Object.assign(new Error('Không tìm thấy timeline thuộc quyền của bạn.'), { status: 404 });
  if (row.archived_at) throw new Error(`Timeline đã bị xoá: ${timelineId}`);
  return row;
}

// planBulkInsertForTimeline(projectState, assets, options) -> { newTracks, insertions, placements }
// — pure planning, no DB access, used by BOTH the read-only preview endpoint and Apply (so the
// preview a user sees is exactly what Apply will do, never a second, drifted computation). Visual
// zone (video/image) and audio zone are resolved and appended to independently, each picking its
// timeline's own lowest-`order` UNLOCKED track of the right type, or creating a fresh one.
function planBulkInsertForTimeline(projectState, assets, options) {
  options = options || {};
  const placement = options.placement || 'append';
  if (!['append', 'new_tracks', 'at_time'].includes(placement)) throw new Error('Cách đặt media không hợp lệ');
  if (placement === 'at_time' && (!Number.isFinite(options.startMs) || options.startMs < 0)) throw new Error('Thời điểm chèn không hợp lệ');
  const imageDurationMs = options?.imageDurationMs ?? DEFAULT_IMAGE_DURATION_MS;
  const maxOrder = projectState.tracks.reduce((m, t) => Math.max(m, t.order), -1);
  let nextOrder = maxOrder + 1;

  const existingVisualTrack = (placement === 'new_tracks' ? [] : projectState.tracks)
    .filter((t) => (t.type === 'video' || t.type === 'image') && !t.locked)
    .sort((a, b) => a.order - b.order)[0] || null;
  const existingAudioTrack = (placement === 'new_tracks' ? [] : projectState.tracks)
    .filter((t) => t.type === 'audio' && !t.locked)
    .sort((a, b) => a.order - b.order)[0] || null;

  let visualTrackId = existingVisualTrack?.id || null;
  let visualCursorMs = existingVisualTrack ? existingVisualTrack.clips.reduce((m, c) => Math.max(m, c.timelineOutMs), 0) : 0;
  let audioTrackId = existingAudioTrack?.id || null;
  let audioCursorMs = existingAudioTrack ? existingAudioTrack.clips.reduce((m, c) => Math.max(m, c.timelineOutMs), 0) : 0;
  if (placement === 'at_time') visualCursorMs = audioCursorMs = options.startMs;

  const newTracks = [];
  const insertions = [];
  const placements = [];

  function blankClip(assetId, durationMs, startMs) {
    return {
      id: crypto.randomUUID(), assetId, sourceInMs: 0, sourceOutMs: durationMs,
      timelineInMs: startMs, timelineOutMs: startMs + durationMs, speed: 1,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      effects: [], keyframes: [],
    };
  }

  for (const asset of assets) {
    if (asset.kind === 'video' || asset.kind === 'image') {
      const isNewTrack = !visualTrackId;
      if (isNewTrack) {
        visualTrackId = crypto.randomUUID();
        newTracks.push({ id: visualTrackId, type: 'video', order: nextOrder++, locked: false, muted: false, visible: true, clips: [] });
      }
      const durationMs = asset.kind === 'image' ? imageDurationMs : asset.duration_ms;
      const clip = blankClip(asset.id, durationMs, visualCursorMs);
      insertions.push({ trackId: visualTrackId, clip });
      placements.push({ assetId: asset.id, kind: asset.kind, trackId: visualTrackId, isNewTrack, startMs: visualCursorMs, durationMs });
      visualCursorMs += durationMs;
    } else {
      const isNewTrack = !audioTrackId;
      if (isNewTrack) {
        audioTrackId = crypto.randomUUID();
        newTracks.push({ id: audioTrackId, type: 'audio', order: nextOrder++, locked: false, muted: false, visible: true, clips: [] });
      }
      const durationMs = asset.duration_ms;
      const clip = blankClip(asset.id, durationMs, audioCursorMs);
      insertions.push({ trackId: audioTrackId, clip });
      placements.push({ assetId: asset.id, kind: 'audio', trackId: audioTrackId, isNewTrack, startMs: audioCursorMs, durationMs });
      audioCursorMs += durationMs;
    }
  }

  for (const insertion of insertions) {
    const existing = projectState.tracks.find(t => t.id === insertion.trackId);
    if (existing?.clips.some(c => c.timelineInMs < insertion.clip.timelineOutMs && c.timelineOutMs > insertion.clip.timelineInMs)) {
      throw new Error('Vị trí chèn trùng clip hiện có. Chọn thời điểm trống hoặc tạo track mới.');
    }
  }
  return { newTracks, insertions, placements };
}

function serializeOperation(row) {
  return {
    id: row.id, collectionId: row.collection_id, status: row.undone_at ? 'undone' : row.status,
    orderedAssetIds: JSON.parse(row.ordered_asset_ids_json),
    options: JSON.parse(row.options_json),
    results: JSON.parse(row.results_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// previewBulkImport/createBulkImportOperation/retryBulkImportOperation/getBulkImportOperation are
// plain functions of (ownerId, ...) — same "pure function + thin HTTP wrapper" split as
// applyCommand()/batchCreateFromVideos() in video-projects.js, so backend/routes/
// video-bulk-import.test.js can exercise the real logic against a real DB without an HTTP layer.

function previewBulkImport(ownerId, { timelineIds, orderedAssetIds, options }) {
  if (!Array.isArray(timelineIds) || timelineIds.length === 0) throw new Error('Thiếu timelineIds');
  if (!Array.isArray(orderedAssetIds) || orderedAssetIds.length === 0) throw new Error('Thiếu orderedAssetIds');
  const assets = loadOwnedAssets(ownerId, orderedAssetIds);
  const targets = timelineIds.map((timelineId) => {
    const row = requireOwnedTimeline(ownerId, timelineId);
    const projectState = recoverProjectState(timelineId);
    const { placements } = planBulkInsertForTimeline(projectState, assets, options);
    return { timelineId, timelineName: row.name, placements };
  });
  return { targets };
}

function applyBulkInsertToTimeline(ownerId, operationId, timelineId, assets, options) {
  db.exec('SAVEPOINT video_bulk_target');
  try {
    requireOwnedTimeline(ownerId, timelineId);
    const projectState = recoverProjectState(timelineId);
    const { newTracks, insertions, placements } = planBulkInsertForTimeline(projectState, assets, options);
    const commandResult = applyCommand(timelineId, {
      type: 'BulkInsertClips',
      args: { newTracks, insertions },
      idempotencyKey: `${operationId}:${timelineId}`,
    });
    db.exec('RELEASE video_bulk_target');
    return { timelineId, status: 'success', afterSeq: commandResult.seq, addedClipIds: insertions.map((i) => i.clip.id), placements };
  } catch (err) {
    db.exec('ROLLBACK TO video_bulk_target');
    db.exec('RELEASE video_bulk_target');
    return { timelineId, status: 'error', error: err.message };
  }
}

function statusFromResults(results) {
  if (results.every((r) => r.status === 'success')) return 'completed';
  if (results.every((r) => r.status === 'error')) return 'failed';
  return 'completed_with_errors';
}

function createBulkImportOperation(ownerId, { timelineIds, orderedAssetIds, options, idempotencyKey, collectionId }) {
  if (!Array.isArray(timelineIds) || timelineIds.length === 0) throw new Error('Thiếu timelineIds');
  if (!Array.isArray(orderedAssetIds) || orderedAssetIds.length === 0) throw new Error('Thiếu orderedAssetIds');

  if (new Set(timelineIds).size !== timelineIds.length || timelineIds.some(id => typeof id !== 'string')) throw new Error('Danh sách timeline không hợp lệ hoặc bị trùng.');
  if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 200)) throw new Error('Idempotency key không hợp lệ.');
  db.exec('BEGIN IMMEDIATE');
  try {
  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT * FROM video_bulk_import_operations WHERE owner_id = ? AND idempotency_key = ?'
    ).get(ownerId, idempotencyKey);
    if (existing) {
      const same = canonicalJson(JSON.parse(existing.ordered_asset_ids_json)) === canonicalJson(orderedAssetIds)
        && canonicalJson(JSON.parse(existing.options_json)) === canonicalJson(options || {})
        && canonicalJson(JSON.parse(existing.results_json).map(r => r.timelineId)) === canonicalJson(timelineIds)
        && existing.collection_id === (collectionId || null);
      if (!same) throw Object.assign(new Error('Yêu cầu đã dùng key này với nội dung khác.'), { status: 409 });
      db.exec('COMMIT'); return serializeOperation(existing);
    }
  }

  const assets = loadOwnedAssets(ownerId, orderedAssetIds);
  for (const timelineId of timelineIds) requireOwnedTimeline(ownerId, timelineId); // fail before touching anything
  if (collectionId && !db.prepare('SELECT 1 FROM video_timeline_collections WHERE id = ? AND owner_id = ?').get(collectionId, ownerId)) throw Object.assign(new Error('Không tìm thấy bộ timeline thuộc quyền của bạn.'), { status: 404 });

  const operationId = crypto.randomUUID();
  const results = timelineIds.map((timelineId) => applyBulkInsertToTimeline(ownerId, operationId, timelineId, assets, options));
  const status = statusFromResults(results);

  const row = {
    id: operationId, owner_id: ownerId, collection_id: collectionId || null,
    idempotency_key: idempotencyKey || null,
    ordered_asset_ids_json: JSON.stringify(orderedAssetIds), options_json: JSON.stringify(options || {}),
    status, results_json: JSON.stringify(results),
  };
  db.prepare(`
    INSERT INTO video_bulk_import_operations
      (id, owner_id, collection_id, idempotency_key, ordered_asset_ids_json, options_json, status, results_json)
    VALUES (@id, @owner_id, @collection_id, @idempotency_key, @ordered_asset_ids_json, @options_json, @status, @results_json)
  `).run(row);
  db.exec('COMMIT');
  return serializeOperation(db.prepare('SELECT * FROM video_bulk_import_operations WHERE id = ?').get(operationId));
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

function getOwnedOperationRow(ownerId, operationId) {
  const row = db.prepare('SELECT * FROM video_bulk_import_operations WHERE id = ?').get(operationId);
  if (!row) { const err = new Error('Không tìm thấy operation'); err.status = 404; throw err; }
  if (row.owner_id !== ownerId) { const err = new Error('Không có quyền truy cập operation này'); err.status = 403; throw err; }
  return row;
}

function getBulkImportOperation(ownerId, operationId) {
  return serializeOperation(getOwnedOperationRow(ownerId, operationId));
}

// retryBulkImportOperation: only re-attempts targets whose last recorded result was an error. A
// target that already succeeded is left completely untouched (not even re-applied) — its
// idempotency key was already consumed, so re-running it would be a safe no-op anyway, but
// skipping it outright keeps a retry's own results diff limited to what actually changed.
function retryBulkImportOperation(ownerId, operationId) {
  db.exec('BEGIN IMMEDIATE');
  try {
  const opRow = getOwnedOperationRow(ownerId, operationId);
  if (opRow.undone_at) throw new Error('Thao tác này đã được hoàn tác.');
  const assets = loadOwnedAssets(ownerId, JSON.parse(opRow.ordered_asset_ids_json));
  const options = JSON.parse(opRow.options_json);
  const priorResults = JSON.parse(opRow.results_json);

  const nextResults = priorResults.map((prior) => (
    prior.status === 'success' ? prior : applyBulkInsertToTimeline(ownerId, opRow.id, prior.timelineId, assets, options)
  ));
  const status = statusFromResults(nextResults);

  db.prepare("UPDATE video_bulk_import_operations SET results_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(nextResults), status, opRow.id);
  db.exec('COMMIT');
  return serializeOperation(db.prepare('SELECT * FROM video_bulk_import_operations WHERE id = ?').get(opRow.id));
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

router.post('/preview', (req, res) => {
  try {
    res.json(previewBulkImport(req.user.id, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    res.json(createBulkImportOperation(req.user.id, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    res.json(getBulkImportOperation(req.user.id, req.params.id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/:id/retry', (req, res) => {
  try {
    res.json(retryBulkImportOperation(req.user.id, req.params.id));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

function undoBulkImportOperation(ownerId, operationId) {
  const row = getOwnedOperationRow(ownerId, operationId);
  if (row.undone_at) return serializeOperation(row);
  const targets = JSON.parse(row.results_json).filter(r => r.status === 'success');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const target of targets) {
      requireOwnedTimeline(ownerId, target.timelineId);
      const latest = db.prepare('SELECT MAX(seq) AS seq FROM video_project_commands WHERE project_id = ?').get(target.timelineId).seq;
      if (latest !== target.afterSeq) throw Object.assign(new Error('Một timeline đã thay đổi sau lần nhập. Không hoàn tác để tránh mất chỉnh sửa; mở timeline đó để xử lý.'), { status: 409 });
    }
    for (const target of targets) {
      const command = db.prepare('SELECT type, args_json FROM video_project_commands WHERE project_id = ? AND seq = ?').get(target.timelineId, target.afterSeq);
      applyCommand(target.timelineId, { type: 'Undo', args: { originalType: command.type, originalArgs: JSON.parse(command.args_json) }, baseRevision: target.afterSeq, idempotencyKey: `undo:${operationId}:${target.timelineId}` });
    }
    db.prepare("UPDATE video_bulk_import_operations SET undone_at = datetime('now') WHERE id = ?").run(operationId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return getBulkImportOperation(ownerId, operationId);
}

router.post('/:id/undo', (req, res) => {
  try { res.json(undoBulkImportOperation(req.user.id, req.params.id)); }
  catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

module.exports = router;
module.exports.planBulkInsertForTimeline = planBulkInsertForTimeline; // exported for backend/routes/video-bulk-import.test.js only
module.exports.previewBulkImport = previewBulkImport;
module.exports.createBulkImportOperation = createBulkImportOperation;
module.exports.getBulkImportOperation = getBulkImportOperation;
module.exports.retryBulkImportOperation = retryBulkImportOperation;
module.exports.undoBulkImportOperation = undoBulkImportOperation;
