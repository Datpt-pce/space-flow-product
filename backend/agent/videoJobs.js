// Agent-side video-job dispatch — Video Editor Phase 0 (specs/space-flow-master-plan/
// 04-video-editor.md). Runs on whichever process actually has filesystem access to the source
// file: this same process when SPACE_FLOW_MODE=agent (the common case — see backend/routes/
// video-assets.js's makeRunJob() calling runVideoJob() directly, no WS round-trip needed), or a
// real paired agent's process when SPACE_FLOW_MODE=server relays a `type:'video-job'` message here via
// backend/agent/connection.js. Mirrors how backend/agent/connection.js's `type:'run'` handler
// already calls straight into backend/engine/executor.js — same shape, one level down for video.
//
// `render` (Phase 4) is the last kind added — see runRenderJob()'s own comment for the cancel
// registry it needs that no other kind here does.

const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const assetService = require('../video/assetService');
const { runPreflight } = require('../video/preflight');
const { buildCapabilitySnapshot } = require('../video/capabilitySnapshot');
const { toContainerPath } = require('../utils/hostPath');

// jobId -> ChildProcess, ONLY for in-flight 'render' jobs — a render is the one kind long/heavy
// enough to need mid-flight cancellation (backend/routes/video-render.js's POST .../cancel).
// Whichever process actually ran spawn('ffmpeg', ...) is the only one that can kill it: this
// module instance in SPACE_FLOW_MODE=agent (this process IS the agent), or the real agent's own
// process when relayed — backend/agent/connection.js's `cancel-job` handler calls cancelRenderJob()
// on ITS OWN copy of this module, not this server's.
const activeRenderProcesses = new Map();

function cancelRenderJob(jobId) {
  const proc = activeRenderProcesses.get(jobId);
  if (!proc) return false;
  proc.kill();
  return true;
}

// runRenderJob({ args, totalDurationMs }, onProgress, jobId) -> Promise<void> — spawns ffmpeg
// with the render plan's own args (backend/video/renderPlanner.js already appended `-progress
// pipe:1 -nostats <outputPath>`), reusing assetService.parseProgressLine's exact `-progress`
// parsing convention (same as generateProxy — proven, not reinvented). Registers the child
// process under `jobId` for the duration so cancelRenderJob() above can reach it.
function runRenderJob({ args, totalDurationMs }, onProgress, jobId) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { windowsHide: true });
    if (jobId) activeRenderProcesses.set(jobId, proc);

    let progressAcc = {};
    let lineBuffer = '';
    let stderrTail = '';
    let cancelled = false;

    proc.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) {
        assetService.parseProgressLine(line.trim(), progressAcc);
        if (progressAcc.progress) {
          const pct = assetService.computeProgressPercent(progressAcc.out_time_ms, totalDurationMs);
          if (onProgress && pct !== null) onProgress(pct);
          progressAcc = {};
        }
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    proc.on('error', (err) => {
      if (jobId) activeRenderProcesses.delete(jobId);
      reject(err);
    });
    proc.on('close', (code) => {
      if (jobId) activeRenderProcesses.delete(jobId);
      if (cancelled) {
        reject(Object.assign(new Error('Render bị huỷ'), { cancelled: true }));
      } else if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg render exited with code ${code}: ${stderrTail.trim()}`));
      }
    });

    // .kill() above only sends the signal; the 'close' handler is what actually settles this
    // promise — mark intent here so that settlement resolves as "cancelled", not "ffmpeg failed".
    const originalKill = proc.kill.bind(proc);
    proc.kill = (...killArgs) => { cancelled = true; return originalKill(...killArgs); };
  });
}

// runVideoJob(kind, payload, onProgress, jobId) -> Promise<result> — payload shape depends on kind:
//   preflight: {} -> { ok, ffmpeg, ffprobe, drawtext, errors } (08-C C6) — no payload needed, always
//              probes THIS process's own ffmpeg/ffprobe install.
//   delete-cache: { outDir } -> { deleted } (08-C C5) — recursively removes outDir on THIS process's
//              own disk. `outDir` is a write-target-shaped value like `outPath` elsewhere in this
//              file (backend-constructed under its own UPLOADS_DIR, never a user-pasted host path)
//              so it's read directly from payload, NOT through the `sourcePath = toContainerPath
//              (payload.path)` translation below — same "outPath is never a user path" rule already
//              documented further down for 'thumbnail'/'proxy'.
//   capability-snapshot: {} -> AgentCapabilitySnapshot (08-C C6, backend/video/capabilitySnapshot.js)
//              — no payload needed, always reports THIS process's own OS/codec/hardware/disk.
//   save-blob: { dataBase64, extension } -> { path } — Phase 15, backend/routes/video-assets.js's
//              POST /record (voice recording). Always the FIRST job in that route's chain, its
//              output feeding the `hash`/`probe` kinds below exactly like a user-picked file's path
//              already does.
//   hash:      { path } -> { contentHash, sizeBytes } (Phase 2, backend/routes/video-assets.js)
//   probe:     { path } -> { metadata }
//   thumbnail: { path, outPath, atSeconds } -> { outPath }
//   proxy:     { path, outPath, gopSeconds, fps, durationMs, crf } -> { outPath }
//   render:    { projectState, rawAssetPaths: {assetId: path}, rawAssetKinds?: {assetId: kind},
//               renderOptions?: {resolutionOverride, crf}, outputPath? } -> { outputPath,
//               totalDurationMs, sizeBytes } — Phase 4.
//               `rawAssetKinds` (Phase 14) defaults to {} when omitted — renderPlanner.js treats
//               any asset missing from it as 'video' (its own pre-Phase-14 default), so every
//               existing caller/test that never passes it renders byte-identical to before.
//               `renderOptions` (Phase 16, backend/routes/video-render.js's preset resolution) is
//               likewise optional — omitted entirely, `buildRenderPlan()`'s own defaults
//               (project's own resolution, CRF 18) apply, byte-identical to pre-Phase-16.
//               `outputPath` is OPTIONAL: when omitted
//               (SPACE_FLOW_MODE=server relay — the caller has no meaningful path to give a
//               REMOTE agent process), this function invents its own temp path under os.tmpdir()
//               and returns it; backend/agent/connection.js is what actually streams those bytes
//               back to the central server afterward (see that file's own comment) — this
//               function only ever writes to a path that's meaningful ON WHICHEVER PROCESS IT
//               RUNS ON, exactly like every other kind here already does for outPath.
// onProgress(percent) fires for 'proxy' and 'render' (the 2 kinds with real ffmpeg progress to
// report) — callers of the other kinds simply never see it invoked. `jobId` is only meaningful
// for 'render' (see runRenderJob()'s own comment on the cancel registry).
//
// `payload.path`/`payload.rawAssetPaths` values are translated through toContainerPath() here,
// once, for every kind — this is THE point where a user-pasted Windows path (e.g.
// "D:\Videos\a.mp4") actually gets touched by the filesystem, on whichever process this function
// runs on (this server directly in SPACE_FLOW_MODE=agent, or the paired agent's own process when
// relayed — see this file's own header). toContainerPath() is a no-op on win32, so this changes
// nothing when that process is a native Windows machine. `payload.outPath`/`outputPath` (write
// targets) are never user paths — the caller always constructs them under its own UPLOADS_DIR (or
// this function invents one for the render/relay case above) — so they're left untranslated.
// Phase 11 (§0): a `lut` effect's `params.path` is the SAME class of user-pasted host path as
// rawAssetPaths — resolveLutPaths() below applies the identical translation to it, for the render
// kind specifically, so it doesn't silently break under SPACE_FLOW_MODE=server/Docker product the
// same way asset source paths originally did before Phase 2's review caught it.
//
// 08-G (specs/.../08-v2/08-g-canvas-motion-text-and-audio.md, acceptance §4 "Missing... capability
// bị báo/gated, không silently substitute"): `params.path` is a plain text field the user TYPES
// directly (EffectsPanel.jsx's `lut-path` input, not a file picker) — a typo or a moved/deleted
// .cube file used to only surface as a raw ffmpeg subprocess failure deep inside the render job,
// after the whole filtergraph was already built. Checked HERE, right after translation and on the
// exact process that will actually run ffmpeg with this path (renderPlanner.js is explicitly a
// pure function with "no fs/process access at all" — this is the one point in the render pipeline
// that both has fs access AND runs on the right machine, same reasoning C6/ADR 0031 already
// established for preflight itself) — same fail-fast contract renderPlanner.js already gives
// fontFilePath (throws before attempting to render rather than letting ffmpeg discover it).
function resolveLutPaths(projectState) {
  const cloned = JSON.parse(JSON.stringify(projectState));
  for (const track of cloned.tracks || []) {
    for (const clip of track.clips || []) {
      for (const effect of clip.effects || []) {
        if (effect.type === 'lut' && effect.params?.path) {
          const resolved = toContainerPath(effect.params.path);
          if (!fs.existsSync(resolved)) {
            throw new Error(`Clip ${clip.id}'s LUT file không tồn tại: "${effect.params.path}" — kiểm tra lại đường dẫn trong Inspector.`);
          }
          effect.params.path = resolved;
        }
      }
    }
  }
  return cloned;
}

async function runVideoJob(kind, payload, onProgress, jobId) {
  const sourcePath = toContainerPath(payload.path);

  switch (kind) {
    case 'audio-peaks':
      return require('../video/audioPeaks').audioPeaks(sourcePath, payload.durationMs);
    case 'system-fonts':
      return { families: await require('../video/systemFonts').listSystemFonts() };
    // 08-C C6 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md)
    // + ADR 0031 (docs/decisions/0031-renderer-capability-boundary-and-local-agent-responsibility.md):
    // capability probing belongs to whichever process actually has the ffmpeg/ffprobe install that
    // matters — this process in SPACE_FLOW_MODE=agent, the real paired agent's process when relayed
    // in SPACE_FLOW_MODE=server. Before this case existed, backend/routes/video-assets.js called
    // runPreflight() directly on the BACKEND process regardless of mode — checking the wrong
    // machine's ffmpeg in server mode, which is why that route used to skip the check entirely in
    // server mode (skipPreflight: needsAgent) instead of trusting a check it knew was meaningless.
    case 'preflight':
      return runPreflight();

    case 'delete-cache':
      fs.rmSync(payload.outDir, { recursive: true, force: true });
      return { deleted: true };

    // capability-snapshot: {} -> AgentCapabilitySnapshot (08-C C6). No payload — `uploadsDir` is
    // deliberately computed HERE, relative to this module's own __dirname, not passed in by the
    // caller (unlike outPath/outDir elsewhere in this file) — the whole point is reporting THIS
    // process's own environment, and a caller-constructed path would be built from a DIFFERENT
    // process's directory layout in SPACE_FLOW_MODE=server (see capabilitySnapshot.js's own
    // comment on this).
    case 'capability-snapshot': {
      const path = require('path');
      return buildCapabilitySnapshot(path.join(__dirname, '..', 'uploads'));
    }

    // Phase 15 (§0): the FIRST step of the voice-recording flow — a browser `MediaRecorder` blob
    // has no "source path" at all (it never touched any disk), unlike every other asset this file
    // handles. Writing it to THIS process's own uploads dir (agent's own disk in
    // SPACE_FLOW_MODE=server relay, this server's own disk in =agent) — same "whichever process
    // actually runs this" rule every other kind here follows — is what turns it into a real
    // sourcePath the REST of the pipeline (hash/probe below, then importAsset()) can use unchanged.
    // `payload.extension` is validated server-side (backend/routes/video-assets.js's POST /record,
    // an allowlist) before it ever reaches here — this function trusts its caller, same as every
    // other kind's `payload.outPath`.
    case 'save-blob': {
      const path = require('path');
      const dir = path.join(__dirname, '..', 'uploads', 'video-recordings', ...(payload.originalName ? [crypto.randomUUID()] : []));
      fs.mkdirSync(dir, { recursive: true });
      const originalName = payload.originalName && path.basename(payload.originalName.replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
      const outPath = path.join(dir, originalName && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(originalName) ? originalName : `${crypto.randomUUID()}.${payload.extension}`);
      fs.writeFileSync(outPath, Buffer.from(payload.dataBase64, 'base64'));
      return { path: outPath };
    }

    case 'hash':
      return { contentHash: await assetService.hashFile(sourcePath), sizeBytes: fs.statSync(sourcePath).size };

    case 'source-begin':
    case 'source-chunk':
    case 'source-finish':
    case 'source-abort':
      return require('../video/sourceTransfer').createSourceReceiver(require('path').join(__dirname, '..', 'uploads', 'video-source-cache'))(kind, payload);

    case 'probe':
      return { metadata: await assetService.probeMetadata(sourcePath) };

    case 'capcut-adapter':
      return require('./capcutJob').runCapcutJob(payload);

    case 'thumbnail': {
      const outPath = payload.outPath || require('path').join(require('os').tmpdir(), `sf-thumbnail-${crypto.randomUUID()}.jpg`);
      await assetService.generateThumbnail(sourcePath, outPath, payload.atSeconds);
      return { outPath };
    }

    case 'proxy': {
      const outPath = payload.outPath || require('path').join(require('os').tmpdir(), `sf-proxy-${crypto.randomUUID()}.mp4`);
      await assetService.generateProxy(sourcePath, outPath, {
        gopSeconds: payload.gopSeconds,
        fps: payload.fps,
        durationMs: payload.durationMs,
        crf: payload.crf,
      }, onProgress);
      return { outPath };
    }

    case 'render': {
      const path = require('path');
      const os = require('os');
      const { buildRenderPlan } = require('../video/renderPlanner');
      const { resolveFontFile } = require('../video/fontResolver');

      const assetPaths = {};
      const assetDimensions = {};
      const assetAudio = {};
      for (const [assetId, rawPath] of Object.entries(payload.rawAssetPaths)) {
        assetPaths[assetId] = toContainerPath(rawPath);
        const metadata = await assetService.probeMetadata(assetPaths[assetId]);
        assetAudio[assetId] = !!metadata.codecAudio;
        if (metadata.width && metadata.height) assetDimensions[assetId] = { width: metadata.width, height: metadata.height };
      }
      const outputPath = payload.outputPath || path.join(os.tmpdir(), `sf-render-${jobId || crypto.randomUUID()}.mp4`);
      const assetKinds = { ...(payload.rawAssetKinds || {}) };
      const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-vector-inputs-'));
      try {
      const renderState = await require('../video/vectorAssets').prepareVectorAssets(
        resolveLutPaths(payload.projectState), assetPaths, assetKinds, generatedDir);
      const plan = buildRenderPlan(renderState, {
        assetPaths, assetDimensions, assetAudio, assetKinds, outputPath, fontFilePath: resolveFontFile(),
        resolutionOverride: payload.renderOptions?.resolutionOverride, crf: payload.renderOptions?.crf,
      });
      await runRenderJob(plan, onProgress, jobId);
      return { outputPath, totalDurationMs: plan.totalDurationMs, sizeBytes: fs.statSync(outputPath).size };
      } finally {
        // mkdtemp owns exactly this attempt's transient inputs, never source assets.
        if (path.dirname(generatedDir) === path.resolve(os.tmpdir()) && path.basename(generatedDir).startsWith('sf-vector-inputs-')) fs.rmSync(generatedDir, { recursive: true, force: true });
      }
    }

    default:
      throw new Error(`Unknown video-job kind: "${kind}"`);
  }
}

module.exports = { runVideoJob, cancelRenderJob };
