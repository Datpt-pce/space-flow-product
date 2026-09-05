// Video Editor Phase 2 (specs/space-flow-master-plan/04-video-editor.md §5): real Media Bin
// backend — persists an imported asset's content hash + probed metadata + thumbnail/proxy paths,
// stable across a source-file move (Relink). Dispatches through the exact video-job mechanism
// the Phase 0 spike route (deleted in Phase 3 once Player.jsx took over its seek-latency-proving
// role) proved out first (runVideoJob() in-process on SPACE_FLOW_MODE=agent, sendJob() over the
// caller's paired agent WS on SPACE_FLOW_MODE=server) — not a new relay path.
//
// Clips only ever reference an asset by id (see shared/video-commands/state.js clip shape:
// `assetId`, no path) — so Relink only needs to update THIS row's source_path/status, never touch
// any project's clip data, satisfying "relink ... không đổi asset ID" for free by construction.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { runVideoJob } = require('../agent/videoJobs');
const { toContainerPath } = require('../utils/hostPath');
const { recoverProjectState, applyCommand, getLatestCommandSeq } = require('./video-projects');

const router = express.Router();
const mediaUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 256 * 1024 * 1024, files: 1 } });
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const AUDIO_EXTS = ['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.opus', '.aiff', '.aif', '.wma'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

function detectKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return null;
}

function toUploadsUrl(p) {
  return p ? `/uploads/${path.relative(UPLOADS_DIR, p).replace(/\\/g, '/')}` : null;
}

function toPublicAsset(row) {
  return {
    id: row.id,
    sourceLocality: row.source_locality || 'agent',
    rights: row.rights_json ? JSON.parse(row.rights_json) : {},
    sourcePath: row.source_path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    fps: row.fps,
    codecVideo: row.codec_v,
    codecAudio: row.codec_a,
    thumbnailUrl: row.thumbnail_path && fs.existsSync(row.thumbnail_path) ? toUploadsUrl(row.thumbnail_path) : null,
    proxyUrl: row.proxy_path && fs.existsSync(row.proxy_path) ? toUploadsUrl(row.proxy_path) : null,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

// makeRunJob(userId, needsAgent) -> same dispatch shape as the deleted Phase 0 spike route's own
// runJob() was: a direct in-process call (SPACE_FLOW_MODE=agent) or a real WS video-job round-trip to the paired agent
// (SPACE_FLOW_MODE=server). Every fs-touching step (hash/probe/thumbnail/proxy) goes through this
// — including the content-hash step, which earlier only ever called assetService.hashFile()
// directly on THIS process, silently broken in SPACE_FLOW_MODE=server since the source file lives
// on the caller's own paired agent, not this central server's disk.
function makeRunJob(userId, needsAgent) {
  return async function runJob(kind, payload) {
    if (!needsAgent) return runVideoJob(kind, payload, () => {});
    const agentServer = require('../ws/agentServer');
    if (['thumbnail', 'proxy'].includes(kind)) {
      const outPath = payload.outPath;
      const partial = `${outPath}.${crypto.randomUUID()}.partial`;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      let fd = fs.openSync(partial, 'wx');
      let transferError;
      let bytes = 0;
      try {
        const remotePayload = { ...payload }; delete remotePayload.outPath;
        await agentServer.sendJob(userId, { type: 'video-job', kind, payload: remotePayload }, (event, data) => {
          if (event !== 'output-chunk' || transferError) return;
          try {
            const chunk = Buffer.from(data.chunkBase64, 'base64');
            let offset = 0;
            while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
            bytes += chunk.length;
          } catch (err) { transferError = err; }
        });
        if (transferError) throw transferError;
        if (!bytes) throw new Error('Agent returned an empty media rendition');
        fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
        fs.renameSync(partial, outPath);
        return { outPath };
      } finally {
        if (fd !== null) fs.closeSync(fd);
        fs.rmSync(partial, { force: true });
      }
    }
    return new Promise((resolve, reject) => {
      agentServer.sendJob(userId, { type: 'video-job', kind, payload }, (event, data) => {
        if (event === 'done') resolve(data.result);
        else if (event === 'error') reject(new Error(data.error));
      }).catch(reject);
    });
  };
}

// resolveRunJob(req, res) -> a runJob() function ready to use, or null after already sending a
// 409 response (agent required but offline) — shared by /import and /relink so both routes gate
// on the same agent-online check instead of duplicating it.
function resolveRunJob(req, res) {
  const needsAgent = (process.env.SPACE_FLOW_MODE || 'agent') === 'server';
  if (needsAgent) {
    const agentServer = require('../ws/agentServer');
    if (!agentServer.isAgentOnline(req.user.id)) {
      res.status(409).json({
        error: 'Thao tác này chạy trên máy local của bạn nhưng agent hiện không online — mở agent trên máy bạn rồi thử lại.',
      });
      return null;
    }
  }
  return makeRunJob(req.user.id, needsAgent);
}

// importAsset(ownerId, sourcePath, runJob, opts) -> the persisted DB row. Exported so
// backend/routes/video-assets.test.js can exercise it directly against real ffmpeg/ffprobe + real
// fixture files without going through Express/auth (same pattern backend/routes/video-projects.js
// uses for recoverProjectState()).
//
// A job failure (hash/probe/thumbnail/proxy) does NOT throw — it's recorded as status:'error' on
// the row and the row is still returned, so Media Bin can show a clear per-asset error badge
// instead of the whole import silently vanishing. Only a failure BEFORE the row exists
// (unrecognized extension, preflight) throws to the caller.
const importsByIdentity = new Map();
async function importAsset(ownerId, sourcePath, runJob, { skipPreflight = false, forceKind = null, sourceLocality = 'agent' } = {}) {
  // `forceKind` (Phase 15, §0): a voice recording's real container is `.webm` (MediaRecorder's own
  // output), which `detectKind()`'s extension table already classifies as 'video' (a real .webm
  // FILE genuinely can be either) — the caller (POST /record below) knows for certain this one is
  // audio-only because it came straight from `getUserMedia({audio:true})`, so it skips extension
  // sniffing entirely instead of renaming the file to some other (misleading) extension.
  const kind = forceKind || detectKind(sourcePath);
  if (!kind) throw new Error(`Không nhận diện được loại file từ phần mở rộng: "${sourcePath}"`);

  // 08-C C6 + ADR 0031: dispatched through runJob() — not a direct runPreflight() call — so this
  // always checks the ffmpeg install on whichever process actually runs the hash/probe/thumbnail/
  // proxy jobs below (the paired agent in SPACE_FLOW_MODE=server, this process in =agent). Before
  // this, importAsset() called runPreflight() directly, unconditionally checking THIS server's own
  // ffmpeg — meaningless in server mode, which is why callers used to pass skipPreflight:true there
  // instead of trusting a check that couldn't have been checking the right machine.
  if (!skipPreflight) {
    const preflight = await runJob('preflight', {});
    if (!preflight.ok) throw new Error(`Preflight thất bại: ${preflight.errors.join('; ')}`);
  }

  let id = crypto.randomUUID();
  let identity, finishImport;
  db.prepare('INSERT INTO video_assets (id, owner_id, source_path, kind, status, source_locality) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, sourcePath, kind, 'processing', sourceLocality);

  try {
    // 'hash' (like every other kind below) goes through runJob() — not a direct assetService
    // call — since the source file only exists on whichever process actually has fs access to
    // it (this server in SPACE_FLOW_MODE=agent, the caller's paired agent in =server).
    const { contentHash, sizeBytes } = await runJob('hash', { path: sourcePath });
    identity = JSON.stringify([ownerId, contentHash, kind, sourceLocality]);
    if (importsByIdentity.has(identity)) {
      db.prepare('DELETE FROM video_assets WHERE id = ?').run(id);
      return await importsByIdentity.get(identity);
    }
    importsByIdentity.set(identity, new Promise(resolve => { finishImport = resolve; }));
    const existing = db.prepare("SELECT * FROM video_assets WHERE owner_id = ? AND content_hash = ? AND kind = ? AND source_locality = ? AND status = 'ok' ORDER BY created_at, id LIMIT 1").get(ownerId, contentHash, kind, sourceLocality);
    if (existing) {
      db.prepare('DELETE FROM video_assets WHERE id = ?').run(id);
      db.prepare("UPDATE video_assets SET source_path = ?, removed_from_bin_at = NULL, last_seen_at = datetime('now') WHERE id = ?").run(sourcePath, existing.id);
      id = existing.id;
      if ((kind === 'image' && existing.width && existing.height) || kind === 'audio' || (kind === 'video' && existing.proxy_path && existing.thumbnail_path && fs.existsSync(existing.proxy_path) && fs.existsSync(existing.thumbnail_path))) {
        return db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id);
      }
      db.prepare("UPDATE video_assets SET status = 'processing' WHERE id = ?").run(id);
    }
    const outDir = path.join(UPLOADS_DIR, 'video-assets', id);
    const update = { content_hash: contentHash };

    if (kind === 'image') {
      const { metadata } = await runJob('probe', { path: sourcePath });
      update.size_bytes = sizeBytes;
      update.width = metadata.width;
      update.height = metadata.height;
    } else {
      const { metadata } = await runJob('probe', { path: sourcePath });
      update.size_bytes = metadata.sizeBytes;
      update.duration_ms = metadata.durationMs;
      update.width = metadata.width;
      update.height = metadata.height;
      update.fps = metadata.fps;
      update.codec_v = metadata.codecVideo;
      update.codec_a = metadata.codecAudio;

      // Thumbnail/proxy only make sense for a video stream — audio has neither a frame to grab
      // nor a GOP-scrubbing problem a proxy would fix (native <audio> plays the source directly).
      if (kind === 'video') {
        const thumbPath = path.join(outDir, 'thumb.jpg');
        const thumbAtSeconds = metadata.durationMs ? Math.min(1, metadata.durationMs / 2000) : 0;
        await runJob('thumbnail', { path: sourcePath, outPath: thumbPath, atSeconds: thumbAtSeconds });
        update.thumbnail_path = thumbPath;

        const proxyPath = path.join(outDir, 'proxy.mp4');
        await runJob('proxy', { path: sourcePath, outPath: proxyPath, gopSeconds: 0.5, fps: metadata.fps || 30, durationMs: metadata.durationMs });
        update.proxy_path = proxyPath;
      }
    }

    db.prepare(`
      UPDATE video_assets SET
        content_hash = ?, size_bytes = ?, duration_ms = ?, width = ?, height = ?, fps = ?,
        codec_v = ?, codec_a = ?, thumbnail_path = ?, proxy_path = ?, status = 'ok', error_message = NULL,
        last_seen_at = datetime('now')
      WHERE id = ?
    `).run(
      update.content_hash ?? null, update.size_bytes ?? null, update.duration_ms ?? null,
      update.width ?? null, update.height ?? null, update.fps ?? null,
      update.codec_v ?? null, update.codec_a ?? null, update.thumbnail_path ?? null, update.proxy_path ?? null,
      id
    );
  } catch (err) {
    db.prepare("UPDATE video_assets SET status = 'error', error_message = ? WHERE id = ?").run(err.message, id);
  } finally {
    if (finishImport) {
      finishImport(db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id));
      importsByIdentity.delete(identity);
    }
  }

  return db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id);
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM video_assets WHERE owner_id = ? AND removed_from_bin_at IS NULL ORDER BY created_at DESC').all(req.user.id);

  // Liveness check only makes sense when THIS process has direct filesystem access to
  // source_path — true in SPACE_FLOW_MODE=agent (the default, this dev server IS the agent), but
  // NOT in SPACE_FLOW_MODE=server where source_path lives on the owner's own machine, not this
  // server's disk. Checking fs.existsSync() there would flip every asset to "offline" regardless
  // of its real state. A real check in server mode needs a dedicated video-job kind dispatched to
  // the agent — intentionally out of scope for Phase 2 (not in the task checklist), left for
  // whichever phase first needs it for real. toContainerPath() handles the other axis (this
  // process itself being a Linux container with a Windows path pasted by the user).
  if ((process.env.SPACE_FLOW_MODE || 'agent') !== 'server') {
    for (const row of rows) {
      if (row.status === 'ok' && !fs.existsSync(toContainerPath(row.source_path))) {
        db.prepare("UPDATE video_assets SET status = 'offline' WHERE id = ?").run(row.id);
        row.status = 'offline';
      }
    }
  }

  res.json(rows.map(toPublicAsset));
});

router.post('/:id/rights', (req, res) => {
  const row = db.prepare('SELECT * FROM video_assets WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy media' });
  const { license = '', source = '', expiresAt = '' } = req.body || {};
  if ([license, source, expiresAt].some(v => typeof v !== 'string') || license.length > 1000 || source.length > 2000 || (expiresAt && !Number.isFinite(Date.parse(expiresAt)))) return res.status(400).json({ error: 'Thông tin quyền sử dụng không hợp lệ' });
  const rights = { license: license.trim(), source: source.trim(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null };
  db.prepare('UPDATE video_assets SET rights_json = ? WHERE id = ?').run(JSON.stringify(rights), row.id);
  res.json(toPublicAsset({ ...row, rights_json: JSON.stringify(rights) }));
});

// 08-C C6 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md) +
// ADR 0031: structured AgentCapabilitySnapshot (codec/encoder/disk/hardware — see
// backend/video/capabilitySnapshot.js), dispatched through the same runJob() mechanism as
// import/render so it always reports the ffmpeg-executing machine (the paired agent in
// SPACE_FLOW_MODE=server), not this backend process. Nothing in the editor UI queries this yet —
// this is the plumbing 08-C's proactive capability-gating goal (ADR 0031) will build on, same
// prepare-before-consumer shape as backend/routes/video-projects.js's GET /:id/timeline-collection.
router.get('/capability', async (req, res) => {
  const runJob = resolveRunJob(req, res);
  if (!runJob) return; // resolveRunJob() already sent the 409 response

  try {
    const snapshot = await runJob('capability-snapshot', {});
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  const { path: sourcePath } = req.body;
  if (!sourcePath) return res.status(400).json({ error: 'Thiếu "path" (đường dẫn file local)' });

  const runJob = resolveRunJob(req, res);
  if (!runJob) return; // resolveRunJob() already sent the 409 response

  try {
    const row = await importAsset(req.user.id, sourcePath, runJob);
    res.json(toPublicAsset(row));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Phase 15 (§0): voice recording — a browser `MediaRecorder` blob, base64-encoded (small JSON
// body is fine here: even several minutes of webm/opus voice-over is a few MB, well under
// express.json()'s 50mb limit in backend/server.js). Allowlist, not a free-form extension: this
// value ends up as a filename on disk (backend/agent/videoJobs.js's own 'save-blob' job), and
// unlike every other kind that job handles, THIS caller's `extension` is fully user-influenced
// (comes straight from the request body) — validate at this trust boundary, not deeper in the
// pipeline that already assumes its caller sanitized it.
const RECORDING_EXTENSIONS = new Set(['webm', 'ogg', 'wav']);

router.get('/system-fonts', async (req, res) => {
  const runJob = resolveRunJob(req, res); if (!runJob) return;
  try { res.json(await runJob('system-fonts', {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/:id/waveform', async (req, res) => {
  const asset = db.prepare('SELECT * FROM video_assets WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!asset) return res.status(404).json({ error: 'Không tìm thấy asset.' });
  if (!asset.duration_ms || !['audio', 'video'].includes(asset.kind)) return res.status(400).json({ error: 'Asset không có audio.' });
  const runJob = resolveRunJob(req, res); if (!runJob) return;
  try { res.json(await runJob('audio-peaks', { path: asset.source_path, durationMs: asset.duration_ms })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

function assetUsage(ownerId, ids) {
  const usage = [];
  for (const row of db.prepare('SELECT id, name FROM video_projects WHERE owner_id = ?').all(ownerId)) {
    const state = recoverProjectState(row.id);
    const deletions = state.tracks.flatMap(t => t.clips.flatMap((clip, index) => ids.includes(clip.assetId) ? [{ trackId: t.id, index, clip }] : []));
    if (deletions.length) usage.push({ id: row.id, name: row.name, revision: getLatestCommandSeq(row.id), clipCount: deletions.length, deletions,
      transitions: (state.transitions || []).filter(t => deletions.some(d => d.clip.id === t.fromClipId || d.clip.id === t.toClipId)) });
  }
  return usage;
}

router.post('/usage', (req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !db.prepare('SELECT id FROM video_assets WHERE id = ? AND owner_id = ?').get(id, req.user.id))) return res.status(400).json({ error: 'Danh sách asset không hợp lệ' });
  res.json(assetUsage(req.user.id, ids).map(({ deletions, transitions, ...row }) => row));
});

router.post('/remove-from-bin', (req, res) => {
  const { ids, expectedUsage } = req.body;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !Array.isArray(expectedUsage) || ids.some(id => typeof id !== 'string' || !db.prepare('SELECT id FROM video_assets WHERE id = ? AND owner_id = ?').get(id, req.user.id))) return res.status(400).json({ error: 'Danh sách asset không hợp lệ' });
  let transaction = false;
  try {
    db.exec('BEGIN'); transaction = true;
    const usage = assetUsage(req.user.id, ids);
    if (usage.length !== expectedUsage.length || usage.some(row => !expectedUsage.some(expected => expected.id === row.id && expected.revision === row.revision))) throw new Error('Timeline đã thay đổi. Kiểm tra danh sách sử dụng và xác nhận lại.');
    for (const row of usage) applyCommand(row.id, { type: 'DeleteClips', args: { deletions: row.deletions, transitions: row.transitions }, baseRevision: row.revision });
    for (const id of ids) db.prepare("UPDATE video_assets SET removed_from_bin_at = datetime('now') WHERE id = ?").run(id);
    db.exec('COMMIT'); transaction = false;
    res.json({ deletedIds: ids, affectedTimelineIds: usage.map(row => row.id) });
  } catch (err) { if (transaction) db.exec('ROLLBACK'); res.status(409).json({ error: err.message }); }
});

router.post('/upload', (req, res) => {
  mediaUpload.single('file')(req, res, async error => {
    if (error) return res.status(400).json({ error: error.message });
    if (!req.file || !detectKind(req.file.originalname)) return res.status(400).json({ error: 'Định dạng media không hỗ trợ.' });
    const runJob = resolveRunJob(req, res); if (!runJob) return;
    try {
      const { path: savedPath } = await runJob('save-blob', { dataBase64: req.file.buffer.toString('base64'), extension: path.extname(req.file.originalname).slice(1).toLowerCase(), originalName: req.file.originalname });
      res.json(toPublicAsset(await importAsset(req.user.id, savedPath, runJob)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
});

router.post('/record', async (req, res) => {
  const { dataBase64, extension } = req.body;
  if (!dataBase64) return res.status(400).json({ error: 'Thiếu "dataBase64" (dữ liệu ghi âm)' });
  if (!RECORDING_EXTENSIONS.has(extension)) {
    return res.status(400).json({ error: `Định dạng ghi âm không hỗ trợ: "${extension}"` });
  }

  const runJob = resolveRunJob(req, res);
  if (!runJob) return; // resolveRunJob() already sent the 409 response (agent required but offline)

  try {
    const { path: savedPath } = await runJob('save-blob', { dataBase64, extension });
    const row = await importAsset(req.user.id, savedPath, runJob, { forceKind: 'audio' });
    res.json(toPublicAsset(row));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// relinkAsset(assetId, ownerId, newPath, runJob) -> { ok, status, error } | { ok: true, row } —
// plain object result (matching backend/video/preflight.js's `{ ok, errors }` convention) rather
// than a thrown Error, so backend/routes/video-assets.test.js can assert on the exact
// status/reason without going through Express. Only ever touches THIS row (source_path/status) —
// clips reference asset id, never path, so no project data needs updating (see file header
// comment). Hashing goes through runJob() (not a direct assetService call) for the same reason
// importAsset()'s hash step does — the new file only exists on whichever process has fs access.
async function relinkAsset(assetId, ownerId, newPath, runJob) {
  const row = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(assetId);
  if (!row) return { ok: false, status: 404, error: 'Không tìm thấy asset' };
  if (row.owner_id !== ownerId) return { ok: false, status: 403, error: 'Chỉ chủ sở hữu mới relink được asset này' };

  let newHash;
  try {
    ({ contentHash: newHash } = await runJob('hash', { path: newPath }));
  } catch (err) {
    return { ok: false, status: 400, error: `Không đọc được file: ${err.message}` };
  }

  if (row.content_hash && newHash !== row.content_hash) {
    return { ok: false, status: 409, error: 'Nội dung file khác với asset gốc — không tự relink. Chọn đúng file gốc, hoặc import như asset mới.' };
  }

  db.prepare("UPDATE video_assets SET source_path = ?, status = 'ok', error_message = NULL, last_seen_at = datetime('now') WHERE id = ?")
    .run(newPath, assetId);
  return { ok: true, row: db.prepare('SELECT * FROM video_assets WHERE id = ?').get(assetId) };
}

router.post('/:id/relink', async (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath) return res.status(400).json({ error: 'Thiếu "path" (đường dẫn file mới)' });

  const runJob = resolveRunJob(req, res);
  if (!runJob) return; // resolveRunJob() already sent the 409 response

  const result = await relinkAsset(req.params.id, req.user.id, newPath, runJob);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(toPublicAsset(result.row));
});

// 08-C (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md, work
// package C5 "Cleanup: reference-aware") — findProjectsReferencingAsset(ownerId, assetId) -> [{id,
// name}], the owner's projects whose CURRENT recovered state has a clip referencing this asset.
// Before this existed there was no DELETE route for video_assets at all — an unused/mistaken import
// had no way to ever be removed. Deleting an asset still referenced by a clip would leave that clip
// pointing at a dangling assetId, so this check exists to block exactly that instead of silently
// breaking a timeline.
function findProjectsReferencingAsset(ownerId, assetId) {
  const rows = db.prepare('SELECT id, name FROM video_projects WHERE owner_id = ?').all(ownerId);
  const referencing = [];
  for (const row of rows) {
    const state = recoverProjectState(row.id);
    const used = (state.tracks || []).some((track) => (track.clips || []).some((clip) => clip.assetId === assetId));
    const pinned = !used && db.prepare('SELECT dependencies_json FROM video_named_versions WHERE project_id = ?').all(row.id).some(v => JSON.parse(v.dependencies_json).some(d => d.assetId === assetId));
    if (used || pinned) referencing.push({ id: row.id, name: row.name });
  }
  return referencing;
}

// deleteAsset(assetId, ownerId, runJob) -> { ok, status, error } | { ok: true } — same result
// convention as relinkAsset() above, so backend/routes/video-assets.test.js can assert exact
// status/reason without Express. Only ever removes THIS row + its own generated thumbnail/proxy
// cache dir (`uploads/video-assets/<id>/`, entirely regenerable) — `source_path` itself is NEVER
// touched, whether it's a user's own file elsewhere on disk or a saved voice recording, matching
// every other route in this file's existing "never touch source_path except updating the pointer"
// rule (08-C acceptance: "Cleanup không xóa source/deliverable"). Renditions are owned by this
// backend after the authenticated relay finishes, so deletion never requires an online agent.
// A cache-cleanup failure is logged and swallowed, never blocking the DB delete the user asked for —
// an orphaned cache dir is a disk-usage nit, not a reason to refuse a delete.
async function deleteAsset(assetId, ownerId) {
  const row = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(assetId);
  if (!row) return { ok: false, status: 404, error: 'Không tìm thấy asset' };
  if (row.owner_id !== ownerId) return { ok: false, status: 403, error: 'Chỉ chủ sở hữu mới xoá được asset này' };

  const referencing = findProjectsReferencingAsset(ownerId, assetId);
  const templateUse = db.prepare("SELECT name, payload_json FROM video_automation_inputs WHERE owner_id = ? AND kind IN ('recipe', 'component')").all(ownerId).find(r => {
    const content = JSON.parse(r.payload_json);
    return content.clip?.assetId === assetId || content.document?.tracks.some(t => t.clips.some(c => c.assetId === assetId));
  });
  if (templateUse) return { ok: false, status: 409, error: `Media đang được ghim trong mẫu/component “${templateUse.name}” — không thể xoá.` };
  if (referencing.length > 0) {
    return {
      ok: false, status: 409,
      error: `Asset đang được dùng trong ${referencing.length} timeline (${referencing.map((p) => p.name).join(', ')}) — không thể xoá`,
      referencingProjects: referencing,
    };
  }

  try {
    const cacheRoot = path.resolve(UPLOADS_DIR, 'video-assets');
    const cacheDir = path.resolve(cacheRoot, assetId);
    if (path.dirname(cacheDir) !== cacheRoot) throw new Error('Invalid rendition cache path');
    fs.rmSync(cacheDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    console.error(`[video-assets] delete-cache thất bại cho asset ${assetId} (bỏ qua, vẫn xoá DB row): ${err.message}`);
  }

  db.prepare('DELETE FROM video_assets WHERE id = ?').run(assetId);
  return { ok: true };
}

router.delete('/:id', async (req, res) => {
  const result = await deleteAsset(req.params.id, req.user.id);
  if (!result.ok) {
    const body = { error: result.error };
    if (result.referencingProjects) body.referencingProjects = result.referencingProjects;
    return res.status(result.status).json(body);
  }
  res.json({ success: true });
});

module.exports = router;
// 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): importAsset() and
// toPublicAsset() are also the real caller now, not just tests — backend/routes/video-render.js's
// promote-to-asset route reuses this exact same hash/probe/thumbnail/proxy pipeline to turn a
// finished render job's output file into an ordinary asset a compound clip can reference.
module.exports.importAsset = importAsset;
module.exports.makeRunJob = makeRunJob;
module.exports.toPublicAsset = toPublicAsset;
module.exports.relinkAsset = relinkAsset; // exported for backend/routes/video-assets.test.js only
module.exports.deleteAsset = deleteAsset; // exported for backend/routes/video-assets.test.js only
module.exports.detectKind = detectKind; // exported for backend/routes/video-assets.test.js only
