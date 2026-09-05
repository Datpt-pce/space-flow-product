// Render + Export — Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5),
// closing the Video MVP. POST creates a `video_render_jobs` row and kicks the actual ffmpeg run
// off DETACHED from the request (a render can run far longer than any single HTTP request should
// stay open) — GET polls/streams that row's live state, POST cancel/retry act on it. Dispatch
// mirrors backend/routes/video-assets.js's own agent/direct branching (SPACE_FLOW_MODE), but
// render additionally needs live progress written back over TIME (not a single awaited result)
// and, in relay mode, the finished file streamed back from the agent — see
// backend/agent/connection.js's own comment for why a render can't just reuse video-assets.js's
// simpler makeRunJob() helper.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const execFileAsync = require('node:util').promisify(require('node:child_process').execFile);
const db = require('../db');
const { recoverProjectState, getLatestCommandSeq } = require('./video-projects');
const { runVideoJob } = require('../agent/videoJobs');
const { RENDER_PRESETS, resolveExportResolution } = require('../video/renderPresets');
const { probeMetadata, hashFile } = require('../video/assetService');
const lifecycle = require('../video/renderLifecycle').createRenderLifecycle(db);

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const LOG_MAX_CHARS = 8000; // "log giới hạn dung lượng" (task checklist) — a runaway ffmpeg stderr must never grow a DB row unbounded
const verificationControllers = new Map();

async function removeAttemptOutput(outputDir) {
  const root = path.resolve(UPLOADS_DIR, 'video-renders');
  const target = path.resolve(outputDir);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid render cleanup path');
  await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function stopWorker(ownerId, jobId) {
  verificationControllers.get(jobId)?.abort();
  if ((process.env.SPACE_FLOW_MODE || 'agent') === 'server') require('../ws/agentServer').cancelJob(ownerId, jobId);
  else require('../agent/videoJobs').cancelRenderJob(jobId);
}

function updateJob(jobId, patch) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE video_render_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values, jobId);
}

function appendLog(jobId, line) {
  const row = db.prepare('SELECT log FROM video_render_jobs WHERE id = ?').get(jobId);
  if (!row) return;
  const next = (row.log + line + '\n').slice(-LOG_MAX_CHARS);
  updateJob(jobId, { log: next });
}

// resolveAssetPaths(state, ownerId) -> { paths: {[assetId]: source_path}, kinds: {[assetId]: kind} }
// — every clip's asset MUST be 'ok' (not offline/error/processing) or this throws with a clear,
// specific message rather than letting ffmpeg fail cryptically on a missing/stale path later.
// `kinds` (Phase 14, §0) is only ever consulted by renderPlanner.js to decide whether an asset's
// ffmpeg input needs `-loop 1` (image) — sent alongside `paths` in the job payload (not looked up
// again from `assetKinds` server-side) for the same reason `rawAssetPaths` already is: in
// SPACE_FLOW_MODE=server the render itself runs on the agent, which has no DB access at all.
function resolveAssetPaths(state, ownerId) {
  const assetIds = new Set();
  // Phase 13 (§0): a caption cue is a clip with NO `assetId` at all (its content is `clip.text`,
  // not an asset) — renderPlanner.js never calls inputIndexFor() for one, so it must never end up
  // in this Set either, or the lookup below throws "Asset undefined không tồn tại" on the very
  // first real export of a project with a caption track (found while wiring Phase 14's own kinds
  // lookup through this same loop — pre-existing, not something this phase introduced; see
  // docs/issues/2026-08-29-video-render-caption-clip-undefined-asset.md).
  for (const track of state.tracks) for (const clip of track.clips) if (clip.assetId) assetIds.add(clip.assetId);
  const paths = {};
  const kinds = {};
  for (const assetId of assetIds) {
    const row = db.prepare('SELECT source_path, status, kind, rights_json FROM video_assets WHERE id = ? AND owner_id = ?').get(assetId, ownerId);
    if (!row) throw new Error(`Asset ${assetId} không tồn tại hoặc không thuộc về bạn`);
    if (row.status !== 'ok') throw new Error(`Asset ${assetId} (${row.status}) chưa sẵn sàng — relink hoặc chờ xử lý xong trước khi export`);
    const rights = row.rights_json ? JSON.parse(row.rights_json) : {};
    if (rights.expiresAt && Date.parse(rights.expiresAt) <= Date.now()) throw new Error(`Quyền sử dụng media ${assetId} đã hết hạn. Kiểm tra lại thông tin media trước khi xuất.`);
    paths[assetId] = row.source_path;
    kinds[assetId] = row.kind;
  }
  return { paths, kinds };
}

// verifyRenderOutput(outputPath, expectedDurationMs) -> Promise<{ ok, reason?, probe? }> — 08-J J5
// (specs/.../08-v2/08-j-render-and-deliverables.md): before this, a truncated/corrupt ffmpeg output
// (crash mid-write, the exact class of bug docs/issues/2026-09-04-ffmpeg-tpad-overlay-eof-race.md
// already found once — a render silently finishing "successfully" with a wildly wrong duration) was
// marked `status='done'` on nothing more than "the ffmpeg child process exited 0". This re-probes the
// REAL output file with the same `probeMetadata()` every imported asset already goes through
// (backend/video/assetService.js) — no new ffprobe wrapper. `expectedDurationMs` (the render plan's
// OWN computed total, threaded back from runVideoJob()'s return value / the agent's 'done' event) is
// optional — a caller that genuinely cannot supply it (e.g. some future job kind) still gets the
// structural checks. Tolerance is deliberately generous (container/keyframe rounding at various
// fps/resolutions, not an exact-match assertion) — this is a corruption smoke test, not a frame-
// accurate duration proof (that's what backend/video/__tests__/golden/render.test.js's own per-
// feature duration assertions already are).
async function verifyRenderOutput(outputPath, expectedDurationMs, { signal } = {}) {
  let probe;
  try {
    probe = await probeMetadata(outputPath);
  } catch (err) {
    return { ok: false, reason: `Không đọc được file output vừa render (ffprobe lỗi): ${err.message}` };
  }
  if (!probe.durationMs || probe.durationMs <= 0) {
    return { ok: false, reason: 'File output không có duration hợp lệ — có thể đã bị hỏng hoặc ghi dở.' };
  }
  if (!probe.codecVideo) {
    return { ok: false, reason: 'File output không có video stream.' };
  }
  if (expectedDurationMs > 0) {
    const toleranceMs = Math.max(1000, expectedDurationMs * 0.15);
    if (Math.abs(probe.durationMs - expectedDurationMs) > toleranceMs) {
      return { ok: false, reason: `Duration output (${probe.durationMs}ms) lệch quá xa so với kỳ vọng (${expectedDurationMs}ms).` };
    }
  }
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', outputPath, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], { windowsHide: true, signal, timeout: 600000, maxBuffer: 1024 * 1024 });
  } catch (e) {
    return { ok: false, reason: `Không giải mã được toàn bộ video/âm thanh: ${e.message}` };
  }
  return { ok: true, probe };
}

// runRenderJobAsync(jobId, projectId, ownerId) — the actual render, detached from any HTTP
// request (fired from POST /:projectId/render below, never awaited by it). Every state
// transition is written to `video_render_jobs` — GET's SSE poll and any future page load both
// just read that row, never anything held only in this function's own memory.
async function runRenderJobAsync(jobId, projectId, ownerId) {
  const attemptToken = lifecycle.claim(jobId);
  if (!attemptToken) return;
  const verificationController = new AbortController();
  verificationControllers.set(jobId, verificationController);
  const heartbeat = setInterval(() => lifecycle.heartbeat(jobId, attemptToken), 10000);
  heartbeat.unref();
  const outputDir = path.join(UPLOADS_DIR, 'video-renders', jobId, attemptToken);
  const outputPath = path.join(outputDir, 'output.partial.mp4');
  const configuredTimeout = Number(process.env.VIDEO_RENDER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 2 * 60 * 60 * 1000;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Render quá thời gian cho phép. Hãy thử lại hoặc chia timeline ngắn hơn.'));
      stopWorker(ownerId, jobId);
    }, timeoutMs);
    timeout.unref();
  });
  const withinDeadline = (promise) => Promise.race([promise, deadline]);

  try {
    // Phase 16 (§0) + 08-B B4 (pinned_seq): both read back from the row itself, not passed as a
    // function argument, since a queued job's own render can start much later, from
    // startNextQueuedJob() rather than the original request. preset_id NULL (pre-Phase-16 rows, or
    // a job never given an explicit presetId) means 'original'; pinned_seq NULL (pre-B4 rows, and
    // every `/retry` job) means "use latest at execution time" — recoverProjectState()'s own
    // default param already does exactly that when passed undefined.
    const jobRow = db.prepare('SELECT preset_id, pinned_seq FROM video_render_jobs WHERE id = ?').get(jobId);
    const state = recoverProjectState(projectId, jobRow?.pinned_seq ?? undefined);
    require('../video/renderQc').assertRenderable(state);
    const { paths: rawAssetPaths, kinds: rawAssetKinds } = resolveAssetPaths(state, ownerId);
    fs.mkdirSync(outputDir, { recursive: true });

    const preset = RENDER_PRESETS[jobRow?.preset_id] || RENDER_PRESETS.original;
    const renderOptions = { resolutionOverride: resolveExportResolution(state.resolution, preset.maxDimension), crf: preset.crf };

    const needsAgent = (process.env.SPACE_FLOW_MODE || 'agent') === 'server';
    const sourceHashes = {};
    for (const [assetId, sourcePath] of Object.entries(rawAssetPaths)) {
      const asset = db.prepare('SELECT content_hash, source_locality FROM video_assets WHERE id = ? AND owner_id = ?').get(assetId, ownerId);
      if (!asset?.content_hash) throw new Error('Media chưa có hash nguồn để xác minh. Nhập lại media trước khi xuất.');
      const actualHash = needsAgent && asset.source_locality !== 'server'
        ? (await withinDeadline(require('./video-assets').makeRunJob(ownerId, true)('hash', { path: sourcePath }))).contentHash
        : await withinDeadline(hashFile(sourcePath));
      lifecycle.assertCurrent(jobId, attemptToken);
      if (actualHash !== asset.content_hash) throw new Error('File media đã thay đổi trên đĩa. Nhập lại hoặc relink đúng bản nguồn trước khi xuất.');
      sourceHashes[assetId] = actualHash;
    }
    // Defense in depth on top of backend/video/assetService.js's computeProgressPercent() guard
    // (which is where the real bug was — see docs/issues/2026-08-28-
    // render-progress-nan-crashes-server.md): `progress_pct` is a SQLite `REAL NOT NULL` column,
    // and one bad value here previously crashed the ENTIRE backend process, not just this job —
    // an isFinite check this close to the DB write is cheap insurance against that ever
    // happening again, from this or a future progress source.
    const onProgress = (pct) => {
      try { lifecycle.assertCurrent(jobId, attemptToken); } catch { return; }
      if (Number.isFinite(pct)) updateJob(jobId, { progress_pct: pct, phase: 'rendering' });
    };

    // 08-J J5/J6: `renderResult` (from runVideoJob()'s own return, or the agent's 'done' event
    // payload — see backend/agent/connection.js/videoJobs.js's 'render' case) carries
    // `totalDurationMs`, the render plan's OWN computed expected duration — the number
    // verifyRenderOutput() below checks the REAL output file against, not a second, independently
    // reasoned-about "expected duration" that could quietly drift from renderPlanner.js's actual
    // semantics.
    let renderResult = null;
    if (!needsAgent) {
      renderResult = await withinDeadline(runVideoJob('render', { projectState: state, rawAssetPaths, rawAssetKinds, renderOptions, outputPath }, onProgress, jobId));
    } else {
      const agentServer = require('../ws/agentServer');
      if (!agentServer.isAgentOnline(ownerId)) {
        throw new Error('Thao tác này chạy trên máy local của bạn nhưng agent hiện không online — mở agent trên máy bạn rồi thử lại.');
      }
      // Transfer server-owned source bytes BEFORE dispatching render. A path on the
      // central server has no meaning on the owner's local agent.
      for (const assetId of Object.keys(rawAssetPaths)) {
        const asset = db.prepare('SELECT source_locality FROM video_assets WHERE id = ? AND owner_id = ?').get(assetId, ownerId);
        if (asset?.source_locality !== 'server') continue;
        const runJob = async (kind, payload) => {
          let result;
          await withinDeadline(agentServer.sendJob(ownerId, { type: 'video-job', kind, payload }, (event, data) => { if (event === 'done') result = data.result; }));
          return result;
        };
        rawAssetPaths[assetId] = await withinDeadline(require('../video/sourceTransfer').transferSource(rawAssetPaths[assetId], runJob, () => lifecycle.assertCurrent(jobId, attemptToken)));
      }
      // Bounded synchronous chunk writes keep the WS callback from accumulating an
      // unbounded writable queue. The agent waits for each transmitted chunk.
      const outputFile = fs.openSync(outputPath, 'wx');
      try {
        await withinDeadline(agentServer.sendJob(ownerId, { type: 'video-job', kind: 'render', payload: { projectState: state, rawAssetPaths, rawAssetKinds, renderOptions } }, (event, data) => {
          lifecycle.assertCurrent(jobId, attemptToken);
          if (event === 'progress') onProgress(data.percent);
          else if (event === 'output-chunk') {
            if (typeof data.chunkBase64 !== 'string' || data.chunkBase64.length > 1500000) throw new Error('Render output chunk quá lớn');
            const bytes = Buffer.from(data.chunkBase64, 'base64');
            let offset = 0;
            while (offset < bytes.length) offset += fs.writeSync(outputFile, bytes, offset, bytes.length - offset);
          } else if (event === 'done') renderResult = data.result;
        }, jobId));
        fs.fsyncSync(outputFile);
      } finally {
        fs.closeSync(outputFile);
      }
    }

    lifecycle.assertCurrent(jobId, attemptToken);
    updateJob(jobId, { phase: 'verifying' });
    const verification = await withinDeadline(verifyRenderOutput(outputPath, renderResult?.totalDurationMs, { signal: verificationController.signal }));
    lifecycle.assertCurrent(jobId, attemptToken);
    if (!verification.ok) {
      updateJob(jobId, { status: 'error', phase: 'failed', lease_until: null, error_message: verification.reason });
      appendLog(jobId, `Verify thất bại, không promote: ${verification.reason}`);
      await removeAttemptOutput(outputDir);
      return;
    }

    const manifest = {
      projectId, ownerId, pinnedSeq: jobRow?.pinned_seq ?? null, presetId: jobRow?.preset_id || 'original',
      assetIds: Object.keys(rawAssetPaths),
      assetHashes: sourceHashes,
      outputHash: await withinDeadline(hashFile(outputPath)),
      durationMs: verification.probe.durationMs, width: verification.probe.width, height: verification.probe.height,
      fps: verification.probe.fps, codecVideo: verification.probe.codecVideo, codecAudio: verification.probe.codecAudio,
      verifiedAt: new Date().toISOString(),
    };
    const compilation = db.prepare('SELECT creative_version_id, recipe_version_id, report_json, plan_json FROM video_compilations WHERE project_id = ?').get(projectId);
    if (compilation) {
      manifest.origin = { recipeVersionId: compilation.recipe_version_id, creativeVariantVersionId: compilation.creative_version_id, compileReport: JSON.parse(compilation.report_json), overrides: require('../video/compositionCompiler').overrideLedger(recoverProjectState(projectId, 0), state, JSON.parse(compilation.plan_json)) };
    }
    const completedPath = path.join(outputDir, 'output.mp4');
    lifecycle.assertCurrent(jobId, attemptToken);
    fs.renameSync(outputPath, completedPath);
    updateJob(jobId, { status: 'done', phase: 'complete', lease_until: null, progress_pct: 100, output_path: completedPath, manifest_json: JSON.stringify(manifest) });
    appendLog(jobId, 'Render hoàn tất, đã verify output.');
  } catch (err) {
    const current = db.prepare('SELECT attempt_token, cancel_requested FROM video_render_jobs WHERE id = ?').get(jobId);
    if (current?.attempt_token !== attemptToken || err.staleAttempt) {
      await removeAttemptOutput(outputDir);
      return;
    }
    if (err.cancelled || current.cancel_requested) {
      updateJob(jobId, { status: 'cancelled', phase: 'cancelled', lease_until: null });
      appendLog(jobId, 'Đã huỷ.');
    } else {
      updateJob(jobId, { status: 'error', phase: 'failed', lease_until: null, error_message: err.message });
      appendLog(jobId, `Lỗi: ${err.message}`);
    }
    await removeAttemptOutput(outputDir); // no partial/dangling file left behind for a failed or cancelled render
  } finally {
    verificationControllers.delete(jobId);
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

function requireOwnedProject(req, res) {
  const row = db.prepare('SELECT owner_id FROM video_projects WHERE id = ?').get(req.params.projectId);
  if (!row) { res.status(404).json({ error: 'Không tìm thấy project' }); return null; }
  if (row.owner_id !== req.user.id) { res.status(403).json({ error: 'Chỉ chủ sở hữu mới export được project này' }); return null; }
  return row;
}

// Phase 16 (§0): render QUEUE — before this phase, POST below fired runRenderJobAsync()
// immediately and unconditionally; a 2nd POST from the same owner while one was still running
// (the UI's own `activeJob` check in ExportPanel.jsx only ever prevents this from the SAME
// browser tab, never a 2nd tab, a direct API call, or 2 different projects) would spawn a 2ND
// ffmpeg process concurrently, both genuinely contending for the same CPU — a real, previously
// unguarded resource issue, not hypothetical (this app's target machine, per master-plan.md's own
// Gate decisions, is the SAME machine the user is actively editing on).
//
// `activeOwners`: in-memory only, same class of state as backend/agent/videoJobs.js's own
// `activeRenderProcesses` Map — a render's real "is something running" fact only ever exists in
// THIS process's own memory (ffmpeg's ChildProcess handle isn't persistable), so it can't live in
// the DB anyway. A job stays 'queued' in the DB the whole time it waits its turn; GET already
// polls that row, so ExportPanel.jsx's existing progress list needs NO changes to show "queued"
// correctly — it already renders that status (see STATUS_LABEL there, unchanged since Phase 4).
const activeOwners = new Set();

function startNextQueuedJob(ownerId) {
  if (activeOwners.has(ownerId)) return; // something already running for this owner — ITS OWN .finally() below calls this again once it's done
  if (db.prepare("SELECT 1 FROM video_render_jobs WHERE owner_id = ? AND status = 'running' AND lease_until > ?").get(ownerId, Date.now())) return;
  const next = db.prepare("SELECT id, project_id FROM video_render_jobs WHERE owner_id = ? AND status = 'queued' AND cancel_requested = 0 AND attempt_count < max_attempts ORDER BY created_at ASC LIMIT 1").get(ownerId);
  if (!next) return;
  activeOwners.add(ownerId);
  runRenderJobAsync(next.id, next.project_id, ownerId).finally(() => {
    activeOwners.delete(ownerId);
    startNextQueuedJob(ownerId); // pick up whatever queued next while this one ran, if anything
  });
}

// Start only from the server entrypoint. Expired leases recover bounded attempts;
// tokens fence late completions and each attempt has an isolated output directory.
function startRenderRecovery() {
  const tick = () => {
    lifecycle.recoverExpired();
    for (const { owner_id } of db.prepare("SELECT DISTINCT owner_id FROM video_render_jobs WHERE status = 'queued'").all()) startNextQueuedJob(owner_id);
  };
  tick();
  const timer = setInterval(tick, 5000);
  timer.unref();
  return () => clearInterval(timer);
}

// createRenderJob(ownerId, projectId, { presetId, idempotencyKey }) -> { jobId, idempotent? } —
// 08-J J1: extracted out of the route below (not inlined) so backend/routes/video-render.test.js
// can exercise the idempotency contract directly, same "exported function, not through Express"
// convention runRenderJobAsync()/promoteJobToAsset() above already established. `idempotencyKey` is
// OPTIONAL and scoped (project_id, idempotency_key) — same convention as video_project_commands' own
// key (08-D D2). A retried submit (e.g. after a client timeout for a request that actually reached
// the server) returns the ORIGINAL job instead of starting a second, duplicate ffmpeg run —
// acceptance §8 "Retry cùng request key không duplicate logical deliverable." Omitted entirely, this
// is byte-identical to the pre-08-J call.
function createRenderJob(ownerId, projectId, { presetId = 'original', idempotencyKey = null, baseRevision, versionId } = {}) {
  if (!db.prepare('SELECT id FROM video_projects WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(projectId, ownerId)) {
    throw Object.assign(new Error('Không tìm thấy timeline đang hoạt động.'), { status: 404 });
  }
  let version;
  if (versionId !== undefined) {
    if (typeof versionId !== 'string' || !versionId) throw Object.assign(new Error('Bản lưu không hợp lệ.'), { status: 400 });
    version = require('./video-versions').service.get(ownerId, projectId, versionId);
    if (version.staleDependencies) throw Object.assign(new Error('Media của bản lưu đã thay đổi; không thể tái tạo chính xác bản cũ.'), { status: 409 });
  }
  if (!RENDER_PRESETS[presetId]) throw Object.assign(new Error(`Preset export không hợp lệ: "${presetId}"`), { status: 400 });
  if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200)) {
    throw Object.assign(new Error('Idempotency key không hợp lệ'), { status: 400 });
  }
  if (baseRevision !== undefined && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) {
    throw Object.assign(new Error('Revision export không hợp lệ'), { status: 400 });
  }

  if (idempotencyKey) {
    const existing = db.prepare('SELECT id, pinned_seq, preset_id FROM video_render_jobs WHERE project_id = ? AND idempotency_key = ?').get(projectId, idempotencyKey);
    if (existing) {
      if ((version && version.seq !== existing.pinned_seq) || (baseRevision !== undefined && baseRevision !== existing.pinned_seq) || presetId !== (existing.preset_id || 'original')) {
        throw Object.assign(new Error('Yêu cầu render đã được dùng cho một phiên bản hoặc preset khác.'), { status: 409 });
      }
      return { jobId: existing.id, idempotent: true };
    }
  }

  const jobId = crypto.randomUUID();
  // 08-B B4: pin to the revision AS OF THIS REQUEST — if this job ends up waiting in the render
  // queue (another job already running for this owner), it still exports what the user had on
  // screen when they clicked Export, not whatever the project has drifted to by the time the queue
  // gets to it. Harmless/no-op for the common immediate-start case: nothing else can commit between
  // this line and runRenderJobAsync() actually reading it (both run synchronously, same request).
  const pinnedSeq = version ? version.seq : getLatestCommandSeq(projectId);
  if (baseRevision !== undefined && baseRevision !== pinnedSeq) {
    throw Object.assign(new Error('Timeline đã thay đổi ở phiên khác. Tải lại bản mới nhất trước khi export.'), { status: 409 });
  }
  require('../video/renderQc').assertRenderable(version ? version.document : recoverProjectState(projectId, pinnedSeq));
  try {
    db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, preset_id, pinned_seq, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(jobId, projectId, ownerId, presetId, pinnedSeq, idempotencyKey);
  } catch (err) {
    // Belt-and-suspenders for a concurrent double-submit racing the pre-check above onto the same
    // idempotency key — same reasoning/precedent as video-projects.js's applyCommand().
    if (idempotencyKey && /UNIQUE/i.test(err.message)) {
      const existing = db.prepare('SELECT id FROM video_render_jobs WHERE project_id = ? AND idempotency_key = ?').get(projectId, idempotencyKey);
      if (existing) return { jobId: existing.id, idempotent: true };
    }
    throw err;
  }
  startNextQueuedJob(ownerId); // starts it now if this owner is idle, else it waits its turn — GET below is how the caller observes either way
  return { jobId };
}

router.post('/:projectId/render', (req, res) => {
  if (!requireOwnedProject(req, res)) return;
  try {
    res.json(createRenderJob(req.user.id, req.params.projectId, { presetId: req.body?.presetId, idempotencyKey: req.body?.idempotencyKey, baseRevision: req.body?.baseRevision, versionId: req.body?.versionId }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /:projectId/render/:jobId — SSE poll: reads the DB row every 500ms and writes a frame only
// when something actually changed, until a terminal status. Same Cloudflare-idle-timeout
// heartbeat as backend/routes/execute.js (see that file's own comment + docs/issues/
// 2026-08-21-sse-heartbeat-cloudflare-idle-timeout.md) — a render can run for minutes with no
// progress change at all if ffmpeg is slow to report, so this is just as real a risk here.
router.get('/:projectId/render/:jobId', (req, res) => {
  const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ? AND project_id = ?').get(req.params.jobId, req.params.projectId);
  if (!row || row.owner_id !== req.user.id) return res.status(404).json({ error: 'Không tìm thấy render job' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let heartbeatTimer = null;
  let stopped = false;
  let pollTimer = null;
  function scheduleHeartbeat() {
    heartbeatTimer = setTimeout(() => {
      if (stopped) return;
      if (!res.writableEnded) res.write(': heartbeat\n\n');
      scheduleHeartbeat();
    }, 15000);
  }
  scheduleHeartbeat();
  const stop = () => { stopped = true; clearTimeout(heartbeatTimer); clearInterval(pollTimer); };
  res.on('close', stop);

  let lastSent = null;
  function sendCurrent() {
    const current = db.prepare('SELECT status, phase, attempt_count, max_attempts, progress_pct, error_message, log FROM video_render_jobs WHERE id = ?').get(req.params.jobId);
    if (!current) { stop(); res.end(); return; }
    const serialized = JSON.stringify(current);
    if (serialized === lastSent) return;
    lastSent = serialized;
    res.write(`event: status\ndata: ${serialized}\n\n`);
    if (current.status === 'done' || current.status === 'error' || current.status === 'cancelled') {
      stop();
      res.end();
    }
  }
  sendCurrent();
  if (!stopped) pollTimer = setInterval(sendCurrent, 500);
});

// cancelQueuedJob(jobId) — Phase 16 (§0): a STILL-QUEUED job (waiting its turn behind another
// render for the same owner) has no ffmpeg process at all yet — cancelRenderJob()/
// agentServer.cancelJob() (used below for a 'running' job) only ever kill an ACTIVE process, so
// calling them on a merely-queued job would silently no-op and leave it stuck 'queued' forever
// despite the user clicking "Huỷ". Written directly here instead — startNextQueuedJob() only ever
// SELECTs status='queued', so this removes it from consideration for real, without racing
// runRenderJobAsync() (which never touches a job it hasn't started). Extracted into its own
// function (not inlined in the route) so backend/routes/video-render.test.js can exercise it
// directly, same "exported for testing only" precedent runRenderJobAsync()/startNextQueuedJob()
// already use.
function cancelQueuedJob(jobId) {
  updateJob(jobId, { status: 'cancelled' });
  appendLog(jobId, 'Đã huỷ (chưa kịp bắt đầu render).');
}

router.post('/:jobId/cancel', (req, res) => {
  const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy render job' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới huỷ được job này' });
  if (row.status !== 'queued' && row.status !== 'running') return res.status(400).json({ error: `Job đã ở trạng thái "${row.status}", không thể huỷ` });
  lifecycle.cancel(req.params.jobId);

  // Phase 16 (§0): a STILL-QUEUED job (waiting its turn behind another render for the same owner)
  // has no ffmpeg process at all yet — cancelRenderJob()/agentServer.cancelJob() below only ever
  // kill an ACTIVE process, so calling them on a merely-queued job would silently no-op and leave
  // it stuck 'queued' forever despite the user clicking "Huỷ". Written directly here instead —
  // startNextQueuedJob() only ever SELECTs status='queued', so this removes it from consideration
  // for real, without racing runRenderJobAsync() (which never touches a job it hasn't started).
  if (row.status === 'queued') {
    cancelQueuedJob(req.params.jobId);
    return res.json({ success: true });
  }

  stopWorker(req.user.id, req.params.jobId);
  // The actual status transition to 'cancelled' happens inside runRenderJobAsync's own catch
  // block once the killed process's promise rejects — not written here, to avoid a race against
  // that same write (see this file's own runRenderJobAsync for why).
  res.json({ success: true });
});

router.post('/:jobId/retry', (req, res) => {
  const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy render job' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới retry được job này' });
  if (row.status !== 'error' && row.status !== 'cancelled') return res.status(400).json({ error: 'Chỉ thử lại job bị lỗi hoặc đã huỷ' });

  const newJobId = crypto.randomUUID();
  // Phase 16 (§0): carries over the OLD job's own preset (row.preset_id, NULL = 'original') — a
  // user retrying an export wants the same settings they originally chose, not a silent reset to
  // default. Fresh project-STATE fetch still happens inside runRenderJobAsync/startNextQueuedJob
  // (never reuses the old job's stale plan), only the preset choice carries over.
  // Retry uses the current saved revision, pinned NOW even if it waits in the queue.
  const pinnedSeq = getLatestCommandSeq(row.project_id);
  db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, preset_id, pinned_seq) VALUES (?, ?, ?, ?, ?)').run(newJobId, row.project_id, row.owner_id, row.preset_id, pinnedSeq);
  startNextQueuedJob(row.owner_id); // starts it now if idle, else queues behind whatever's already running for this owner
  res.json({ jobId: newJobId });
});

router.get('/:projectId/render', (req, res) => {
  const rows = db.prepare('SELECT id, status, phase, attempt_count, max_attempts, progress_pct, error_message, preset_id, pinned_seq, created_at, updated_at FROM video_render_jobs WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC').all(req.params.projectId, req.user.id);
  res.json(rows);
});

router.get('/:projectId/render/:jobId/download', (req, res) => {
  const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ? AND project_id = ? AND owner_id = ?')
    .get(req.params.jobId, req.params.projectId, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy render job' });
  if (row.status !== 'done' || !row.manifest_json || !row.output_path) {
    return res.status(409).json({ error: 'Video chưa hoàn tất và xác minh. Vui lòng export lại nếu đây là bản cũ.' });
  }
  if (!fs.existsSync(row.output_path)) return res.status(404).json({ error: 'File export không còn trên máy lưu trữ. Vui lòng export lại.' });
  const project = db.prepare('SELECT name FROM video_projects WHERE id = ?').get(row.project_id);
  const name = (project?.name || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100);
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.query.inline === '1') {
    res.type('video/mp4');
    return res.sendFile(path.resolve(row.output_path));
  }
  res.download(row.output_path, `${name}-r${row.pinned_seq ?? 0}-${row.preset_id || 'original'}.mp4`, (err) => {
    if (err && !res.headersSent) res.status(err.statusCode || 500).json({ error: 'Không tải được video. Vui lòng thử lại.' });
  });
});

// 08-J J6: a dedicated endpoint (not bolted onto the list/SSE routes above, which ExportPanel.jsx's
// existing progress list polls frequently — this blob is only worth fetching on demand, for the one
// real consumer need: tracing a specific finished deliverable's lineage). manifest_json is only ever
// set on a job that passed verifyRenderOutput() (see runRenderJobAsync above), so `manifest: null`
// here means either the job never finished or it finished but was rejected by verification.
router.get('/:projectId/render/:jobId/manifest', (req, res) => {
  const row = db.prepare('SELECT manifest_json FROM video_render_jobs WHERE id = ? AND project_id = ? AND owner_id = ?').get(req.params.jobId, req.params.projectId, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy render job' });
  res.json({ manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null });
});

// promoteJobToAsset(jobRow, ownerId) -> the persisted video_assets row (importAsset()'s own return
// shape) — 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): turns a
// FINISHED render job's output file into a real asset via the exact same importAsset() pipeline
// every uploaded video already goes through — the mechanism a "compound clip" (one timeline
// embedded inside another) is built from. No new asset-processing code path; this only supplies
// importAsset() with a source_path that happens to be a render job's output instead of something
// the user picked from disk. Extracted out of the route below (not inlined) so backend/routes/
// video-render.test.js can exercise it directly against real ffmpeg, same "exported function, not
// through Express" convention runRenderJobAsync() above already established.
async function promoteJobToAsset(jobRow, ownerId) {
  const { importAsset } = require('./video-assets');
  const runJob = (kind, payload) => runVideoJob(kind, payload, () => {});
  // skipPreflight: the render that JUST produced jobRow.output_path already proves ffmpeg works on
  // this machine — re-checking it here would be redundant, same reasoning importAsset()'s own
  // header gives for its skipPreflight option.
  return importAsset(ownerId, jobRow.output_path, runJob, { skipPreflight: true, sourceLocality: 'server' });
}

router.post('/:projectId/render/:jobId/promote-to-asset', async (req, res) => {
  const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ? AND project_id = ?').get(req.params.jobId, req.params.projectId);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy render job' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới dùng được job này' });
  if (row.status !== 'done') return res.status(400).json({ error: `Job đang ở trạng thái "${row.status}", chưa thể dùng làm compound clip` });

  // Promoted outputs remain server-owned. Later renders transfer their bytes to the
  // requesting owner's agent before constructing the FFmpeg plan (ADR 0039).

  try {
    const { toPublicAsset } = require('./video-assets');
    const assetRow = await promoteJobToAsset(row, req.user.id);
    if (assetRow.status !== 'ok') {
      return res.status(500).json({ error: assetRow.error_message || 'Không thể xử lý file render thành asset' });
    }
    res.json({ asset: toPublicAsset(assetRow), pinnedSeq: row.pinned_seq });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports.startRenderRecovery = startRenderRecovery;
module.exports.runRenderJobAsync = runRenderJobAsync; // exported for backend/routes/video-render.test.js only
module.exports.startNextQueuedJob = startNextQueuedJob; // exported for backend/routes/video-render.test.js only (Phase 16)
module.exports.cancelQueuedJob = cancelQueuedJob; // exported for backend/routes/video-render.test.js only (Phase 16)
module.exports.promoteJobToAsset = promoteJobToAsset; // exported for backend/routes/video-render.test.js only (08-F F5)
module.exports.verifyRenderOutput = verifyRenderOutput; // exported for backend/routes/video-render.test.js only (08-J J5)
module.exports.createRenderJob = createRenderJob; // exported for backend/routes/video-render.test.js only (08-J J1)
