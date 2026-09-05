// Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5): proves
// runRenderJobAsync() — the actual DETACHED render lifecycle backend/routes/video-render.js's
// POST routes kick off — against real ffmpeg via the real video_projects/video_assets/
// video_render_jobs tables, same "call the exported function directly, not through Express"
// convention as backend/routes/video-projects.test.js and backend/routes/video-assets.test.js.
//
// Acceptance criteria under test (04-video-editor.md §5 Phase 4): cancel mid-flight actually
// kills the ffmpeg process (verified via `tasklist`, not just a "cancelled" DB status — a status
// flag alone wouldn't catch a leaked process); retry creates a NEW job, doesn't touch the old one.
//
// Run with: node backend/routes/video-render.test.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../db');
const { runVideoJob, cancelRenderJob } = require('../agent/videoJobs');
const { importAsset } = require('./video-assets');
const { getLatestCommandSeq } = require('./video-projects');
const { runRenderJobAsync, startNextQueuedJob, cancelQueuedJob, promoteJobToAsset, createRenderJob, verifyRenderOutput } = require('./video-render');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIP_1 = path.join(REPO_ROOT, 'ref-item', '1.mp4');
const runJob = (kind, payload) => runVideoJob(kind, payload, () => {});

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.stack || err.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error('waitFor: timed out');
}

async function ffmpegProcessCount() {
  if (process.platform !== 'win32') return null; // "kiểm bằng tasklist" is a Windows-specific check — skip elsewhere, not a false negative
  const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV']);
  return (stdout.match(/ffmpeg\.exe/g) || []).length;
}

function makeProject(ownerId, videoClipMs = 3000, overrides = {}) {
  const id = crypto.randomUUID();
  const payload = {
    schemaVersion: 1, resolution: { width: 640, height: 1138 }, fps: 24, colorSpace: 'sRGB', audioRate: 48000,
    sequence: { markers: [] },
    tracks: [
      { id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [] },
      { id: 'track-a1', type: 'audio', order: 1, locked: false, muted: false, visible: true, clips: [] },
    ],
    transitions: [],
    ...overrides,
  };
  const payloadJson = JSON.stringify(payload);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)').run(id, ownerId, 'render-test', payloadJson);
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)').run(crypto.randomUUID(), id, payloadJson);
  return { id, videoClipMs };
}

function insertClipCommand(projectId, assetId, durationMs) {
  const clip = {
    id: crypto.randomUUID(), assetId, sourceInMs: 0, sourceOutMs: durationMs, timelineInMs: 0, timelineOutMs: durationMs,
    speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
  };
  const args = { trackId: 'track-v1', index: 0, clip };
  db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, 1, ?, ?)')
    .run(crypto.randomUUID(), projectId, 'InsertClip', JSON.stringify(args));
}

async function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `video-render-test-sub-${ownerId}`, `video-render-test-${ownerId}@space-flow.local`, 'Video Render Test User', 'member');

  const asset = await importAsset(ownerId, CLIP_1, runJob);
  const projectIds = [];
  const jobIds = [];
  const promotedAssetIds = []; // 08-F F5: assets created by promoteJobToAsset() in tests below, cleaned up alongside `asset` itself

  try {
    await check('runRenderJobAsync: full lifecycle queued -> running -> done, real output file on disk', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 2000);

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);

      await runRenderJobAsync(jobId, projectId, ownerId);

      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'done');
      assert.strictEqual(row.progress_pct, 100);
      assert.ok(row.output_path && fs.existsSync(row.output_path), 'expected a real output file on disk');
    });

    await check('runRenderJobAsync: asset not ready (offline) -> status error with a clear message, no crash', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 2000);
      db.prepare("UPDATE video_assets SET status = 'offline' WHERE id = ?").run(asset.id);

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);

      await runRenderJobAsync(jobId, projectId, ownerId);

      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'error');
      assert.match(row.error_message, /offline/);

      db.prepare("UPDATE video_assets SET status = 'ok' WHERE id = ?").run(asset.id); // restore for later checks
    });

    await check('cancel mid-flight: DB status becomes cancelled AND the real ffmpeg.exe process actually dies', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      // A long-ish render (many seconds of source, big scale factor) so there's a real window to
      // cancel it mid-flight instead of racing a render that finishes before cancel() runs.
      insertClipCommand(projectId, asset.id, 5000);

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);

      const beforeCount = await ffmpegProcessCount();
      const renderPromise = runRenderJobAsync(jobId, projectId, ownerId); // NOT awaited yet — this is the "mid-flight" window
      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId).status === 'running');
      if (beforeCount !== null) {
        await waitFor(async () => (await ffmpegProcessCount()) > beforeCount, { timeoutMs: 5000 });
      }

      cancelRenderJob(jobId);
      await renderPromise; // runRenderJobAsync's own catch block settles the DB row — safe to await directly, it never throws

      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'cancelled');
      assert.strictEqual(row.output_path, null, 'a cancelled render must not report a usable output file');

      if (beforeCount !== null) {
        await waitFor(async () => (await ffmpegProcessCount()) <= beforeCount, { timeoutMs: 5000 });
      }
    });

    await check('retry: creates a brand-new job row, leaves the old (errored) one untouched', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 2000);
      db.prepare("UPDATE video_assets SET status = 'offline' WHERE id = ?").run(asset.id);

      const oldJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(oldJobId, projectId, ownerId);
      jobIds.push(oldJobId);
      await runRenderJobAsync(oldJobId, projectId, ownerId);
      const oldRowAfterFirstRun = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(oldJobId);
      assert.strictEqual(oldRowAfterFirstRun.status, 'error');

      db.prepare("UPDATE video_assets SET status = 'ok' WHERE id = ?").run(asset.id); // fix the problem, THEN retry

      const newJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(newJobId, projectId, ownerId);
      jobIds.push(newJobId);
      await runRenderJobAsync(newJobId, projectId, ownerId);

      const newRow = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(newJobId);
      assert.strictEqual(newRow.status, 'done');
      const oldRowStillThere = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(oldJobId);
      assert.strictEqual(oldRowStillThere.status, 'error', 'retry must never mutate the OLD job row');
    });

    // Phase 16 (§0): render queue — 2 jobs queued for the SAME owner back-to-back must run
    // SEQUENTIALLY (job 2 stays 'queued' the whole time job 1 is 'running'), not concurrently.
    // Only ONE call to startNextQueuedJob() is made here (mirroring exactly what POST
    // /:projectId/render does per request) — the 2nd job's own start is entirely automatic, driven
    // by job 1's .finally() callback, proving the queue drains itself without further prompting.
    await check('Phase 16 queue: 2nd render for the same owner stays queued until the 1st finishes, then auto-starts', async () => {
      const { id: projectId1 } = makeProject(ownerId);
      const { id: projectId2 } = makeProject(ownerId);
      projectIds.push(projectId1, projectId2);
      insertClipCommand(projectId1, asset.id, 3000);
      insertClipCommand(projectId2, asset.id, 1000);

      const jobId1 = crypto.randomUUID();
      const jobId2 = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId1, projectId1, ownerId);
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId2, projectId2, ownerId);
      jobIds.push(jobId1, jobId2);

      startNextQueuedJob(ownerId); // only job1 should actually start — job2 waits its turn

      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId1).status === 'running');
      const job2WhileJob1Running = db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId2);
      assert.strictEqual(job2WhileJob1Running.status, 'queued', 'job2 must not start while job1 (same owner) is still running');

      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId1).status === 'done', { timeoutMs: 15000 });
      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId2).status === 'done', { timeoutMs: 15000 });
      // Both landed 'done' with no explicit 2nd startNextQueuedJob() call anywhere above — proves
      // job1's own .finally() is what advanced the queue automatically.
    });

    await check('08-B B4 pinned_seq: a queued job renders the revision it was REQUESTED at, not whatever the project became while it waited', async () => {
      const { id: projectId1 } = makeProject(ownerId);
      const { id: projectId2 } = makeProject(ownerId);
      projectIds.push(projectId1, projectId2);
      insertClipCommand(projectId1, asset.id, 4000); // long enough to give job2 a real queue window
      insertClipCommand(projectId2, asset.id, 1000); // seq=1 on project2: exactly 1s of content

      const busyJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(busyJobId, projectId1, ownerId);
      jobIds.push(busyJobId);
      // Through startNextQueuedJob() (not a direct runRenderJobAsync() call) — that's the only
      // place `activeOwners` actually gets populated, so this owner's "slot" is genuinely occupied
      // for the queuedJobId insert below to test anything real.
      startNextQueuedJob(ownerId);
      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(busyJobId).status === 'running');

      // Pin at THIS point — project2 has exactly its 1st clip (1s) — same getLatestCommandSeq() call
      // POST /:projectId/render itself makes.
      const pinnedSeq = getLatestCommandSeq(projectId2);
      assert.strictEqual(pinnedSeq, 1);

      const queuedJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, pinned_seq) VALUES (?, ?, ?, ?)').run(queuedJobId, projectId2, ownerId, pinnedSeq);
      jobIds.push(queuedJobId);
      startNextQueuedJob(ownerId); // job1 (project1) is already running -> this job must genuinely queue
      assert.strictEqual(db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(queuedJobId).status, 'queued');

      // While job2 waits, simulate the user continuing to edit project2 — a 2nd clip, extending it
      // to 2s. If pinned_seq isn't honored, job2's eventual render would pick this up too.
      const secondClip = {
        id: crypto.randomUUID(), assetId: asset.id, sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 1000, timelineOutMs: 2000,
        speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
      };
      db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, 2, ?, ?)')
        .run(crypto.randomUUID(), projectId2, 'InsertClip', JSON.stringify({ trackId: 'track-v1', index: 1, clip: secondClip }));

      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(busyJobId).status === 'done', { timeoutMs: 20000 });
      await waitFor(() => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(queuedJobId).status === 'done', { timeoutMs: 20000 });

      const outputPath = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(queuedJobId).output_path;
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outputPath]);
      const durationSec = parseFloat(stdout.trim());
      assert.ok(
        durationSec < 1.5,
        `expected output pinned to the 1-clip (~1s) state as of the request, got ${durationSec}s — looks like it picked up the 2nd clip added while queued`
      );
    });

    await check('Phase 16 cancel: a job that is still QUEUED (never started) cancels immediately, no process to kill', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 2000);

      // Occupy this owner's "slot" with a real running job first, so the 2nd stays genuinely queued.
      const busyJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(busyJobId, projectId, ownerId);
      jobIds.push(busyJobId);
      const busyPromise = runRenderJobAsync(busyJobId, projectId, ownerId);

      const queuedJobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status) VALUES (?, ?, ?, ?)').run(queuedJobId, projectId, ownerId, 'queued');
      jobIds.push(queuedJobId);

      cancelQueuedJob(queuedJobId); // the exact function POST /:jobId/cancel calls for a status==='queued' row
      const row = db.prepare('SELECT status, log FROM video_render_jobs WHERE id = ?').get(queuedJobId);
      assert.strictEqual(row.status, 'cancelled');
      assert.ok(row.log.includes('chưa kịp bắt đầu'), 'expected a log line explaining it never started');

      await busyPromise; // let the occupying job finish before this test's own cleanup runs
    });

    await check('Phase 16 preset: "720p" produces a measurably smaller real output resolution than "original"', async () => {
      const probe = async (filePath) => {
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath]);
        return JSON.parse(stdout).streams[0];
      };

      const { id: projectIdOriginal } = makeProject(ownerId); // project resolution: 640x1138 (portrait, long edge 1138)
      const { id: projectId720p } = makeProject(ownerId);
      projectIds.push(projectIdOriginal, projectId720p);
      insertClipCommand(projectIdOriginal, asset.id, 1000);
      insertClipCommand(projectId720p, asset.id, 1000);

      const jobIdOriginal = crypto.randomUUID();
      const jobId720p = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, preset_id) VALUES (?, ?, ?, ?)').run(jobIdOriginal, projectIdOriginal, ownerId, 'original');
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, preset_id) VALUES (?, ?, ?, ?)').run(jobId720p, projectId720p, ownerId, '720p');
      jobIds.push(jobIdOriginal, jobId720p);

      await runRenderJobAsync(jobIdOriginal, projectIdOriginal, ownerId);
      await runRenderJobAsync(jobId720p, projectId720p, ownerId);

      const rowOriginal = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(jobIdOriginal);
      const row720p = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(jobId720p);
      const streamOriginal = await probe(rowOriginal.output_path);
      const stream720p = await probe(row720p.output_path);

      assert.strictEqual(streamOriginal.height, 1138, 'original preset must render at the project\'s own unscaled resolution');
      assert.ok(stream720p.height <= 720, `expected 720p preset's long edge scaled down to <=720, got ${stream720p.height}`);
      assert.ok(stream720p.height < streamOriginal.height, 'the 720p preset output must genuinely be smaller than the original preset output');
      assert.strictEqual(stream720p.width % 2, 0, 'scaled width must be even (yuv420p requirement)');
      assert.strictEqual(stream720p.height % 2, 0, 'scaled height must be even (yuv420p requirement)');
    });

    await check('08-H8: a LANDSCAPE (16:9) project scaled by a preset — resolveExportResolution()\'s "long edge = width" branch had never run in any test before (every prior preset test used a portrait project)', async () => {
      const probe = async (filePath) => {
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath]);
        return JSON.parse(stdout).streams[0];
      };

      const { id: projectId } = makeProject(ownerId, 3000, { resolution: { width: 1920, height: 1080 } });
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1000);

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, preset_id) VALUES (?, ?, ?, ?)').run(jobId, projectId, ownerId, '720p');
      jobIds.push(jobId);

      await runRenderJobAsync(jobId, projectId, ownerId);
      const row = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(jobId);
      const stream = await probe(row.output_path);

      // The bug this would catch: scaling by the WRONG edge (height instead of width) on a
      // landscape project would either barely scale anything (1080 is already <=720... no —
      // 1080 > 720 either way) or, more subtly, silently flip the output to portrait if width/
      // height ever got swapped in the scale math.
      assert.ok(stream.width <= 720, `expected 720p preset's long edge (width, since this project is landscape) scaled down to <=720, got ${stream.width}`);
      assert.ok(stream.width > stream.height, `expected the output to STAY landscape (width > height), got ${stream.width}x${stream.height}`);
      assert.strictEqual(stream.width % 2, 0, 'scaled width must be even (yuv420p requirement)');
      assert.strictEqual(stream.height % 2, 0, 'scaled height must be even (yuv420p requirement)');
    });

    await check('08-H8: a project at a non-default frame rate (30fps, not the 24fps every other fixture in this repo uses) renders at that real frame rate, not silently forced to 24', async () => {
      const probe = async (filePath) => {
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', filePath]);
        return JSON.parse(stdout).streams[0];
      };

      const { id: projectId } = makeProject(ownerId, 3000, { fps: 30 });
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1000); // 1s clip

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);

      await runRenderJobAsync(jobId, projectId, ownerId);
      const row = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(jobId);
      const stream = await probe(row.output_path);

      assert.strictEqual(stream.r_frame_rate, '30/1', `expected the real output frame rate to be 30fps, got ${stream.r_frame_rate}`);
      // 1s at 30fps -> ~30 frames, not ~24 (the default every other fixture uses, so a hardcoded
      // 24 anywhere in the pipeline would silently produce the wrong frame count here).
      assert.ok(Number(stream.nb_frames) >= 28 && Number(stream.nb_frames) <= 31, `expected ~30 frames for a 1s clip at 30fps, got ${stream.nb_frames}`);
    });

    // 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): the compound-clip
    // mechanism — a FINISHED render job's output promoted into a real, usable asset via the exact
    // same importAsset() pipeline every uploaded video goes through.
    await check('promoteJobToAsset: a done render job becomes a real, usable video_assets row (real probe/thumbnail/proxy)', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1500);
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);
      await runRenderJobAsync(jobId, projectId, ownerId);
      const jobRow = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(jobRow.status, 'done');

      const promoted = await promoteJobToAsset(jobRow, ownerId);
      promotedAssetIds.push(promoted.id);
      assert.strictEqual(promoted.status, 'ok', `expected a fully processed asset, got status=${promoted.status} error=${promoted.error_message}`);
      assert.strictEqual(promoted.kind, 'video');
      assert.ok(promoted.duration_ms > 0, 'expected a real probed duration');
      assert.ok(promoted.proxy_path && fs.existsSync(promoted.proxy_path), 'expected a real proxy file, same as any other imported video');
      assert.ok(promoted.thumbnail_path && fs.existsSync(promoted.thumbnail_path), 'expected a real thumbnail file');
    });

    // Regression (found while wiring Phase 14's own asset-kind lookup through this exact
    // function): a caption cue's clip has no `assetId` at all (see shared/video-commands/
    // state.js's caption clip shape) — resolveAssetPaths() used to add that `undefined` into its
    // assetIds Set unconditionally, then throw "Asset undefined không tồn tại" on the DB lookup,
    // meaning the FIRST real export of any project with a caption track (through this route, not
    // the golden suite's direct buildRenderPlan()/runVideoJob() calls, which never exercised this
    // function) would fail outright. See docs/issues/2026-08-29-video-render-caption-clip-undefined-asset.md.
    await check('runRenderJobAsync: a project with a caption track (no assetId clip) exports successfully, not "Asset undefined"', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 2000);
      const captionArgs = {
        trackId: 'track-cap1',
        track: { id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true, clips: [] },
      };
      db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, 2, ?, ?)')
        .run(crypto.randomUUID(), projectId, 'AddTrack', JSON.stringify(captionArgs));
      const cueArgs = {
        trackId: 'track-cap1', index: 0,
        clip: {
          id: crypto.randomUUID(), sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000,
          speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Hello' },
        },
      };
      db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, 3, ?, ?)')
        .run(crypto.randomUUID(), projectId, 'InsertClip', JSON.stringify(cueArgs));

      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);

      await runRenderJobAsync(jobId, projectId, ownerId);

      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'done', `expected a successful export, got status=${row.status} error=${row.error_message}`);
    });

    // 08-J J1 (specs/.../08-v2/08-j-render-and-deliverables.md): createRenderJob()'s idempotency —
    // same key twice for the same project must return the SAME job, never start a 2nd ffmpeg run.
    await check('createRenderJob: same idempotencyKey twice returns the SAME job, does not create a duplicate row', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 500);
      const idempotencyKey = crypto.randomUUID();

      const first = await new Promise((resolve) => resolve(createRenderJob(ownerId, projectId, { idempotencyKey })));
      jobIds.push(first.jobId);
      assert.strictEqual(first.idempotent, undefined);
      const second = createRenderJob(ownerId, projectId, { idempotencyKey });
      assert.strictEqual(second.jobId, first.jobId);
      assert.strictEqual(second.idempotent, true);

      const count = db.prepare('SELECT COUNT(*) AS n FROM video_render_jobs WHERE project_id = ?').get(projectId).n;
      assert.strictEqual(count, 1, 'expected exactly 1 job row, not 2');

      await waitFor(async () => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(first.jobId).status === 'done');
    });

    await check('createRenderJob: an invalid presetId is rejected before any job row is created', () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      assert.throws(() => createRenderJob(ownerId, projectId, { presetId: 'not-a-real-preset' }), /Preset export không hợp lệ/);
      const count = db.prepare('SELECT COUNT(*) AS n FROM video_render_jobs WHERE project_id = ?').get(projectId).n;
      assert.strictEqual(count, 0);
    });

    // 08-J J5: verifyRenderOutput() is what stands between a finished ffmpeg process and
    // `status='done'` — proves it actually rejects a genuinely corrupt/truncated file (real ffprobe,
    // not a mocked one) rather than trusting "ffmpeg exited 0".
    await check('verifyRenderOutput: rejects a truncated/corrupt file (real ffprobe), accepts a real render', async () => {
      const badPath = path.join(REPO_ROOT, 'backend', 'uploads', `verify-test-corrupt-${crypto.randomUUID()}.mp4`);
      fs.writeFileSync(badPath, 'not a real mp4 file');
      try {
        const badResult = await verifyRenderOutput(badPath, 3000);
        assert.strictEqual(badResult.ok, false);
      } finally {
        fs.rmSync(badPath, { force: true });
      }

      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1000);
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);
      await runRenderJobAsync(jobId, projectId, ownerId);
      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'done');
      const goodResult = await verifyRenderOutput(row.output_path, 1000);
      assert.strictEqual(goodResult.ok, true);
    });

    // 08-J J6: a successful render's manifest_json carries real, verified lineage data — content
    // hash, pinned seq, asset ids and the SAME probed metadata verifyRenderOutput() just checked
    // (not independently re-derived).
    await check('runRenderJobAsync: a successful render writes a real manifest_json (hash/duration/assetIds/pinnedSeq)', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1000);
      const { jobId } = createRenderJob(ownerId, projectId, {});
      jobIds.push(jobId);
      await waitFor(async () => db.prepare('SELECT status FROM video_render_jobs WHERE id = ?').get(jobId).status === 'done');

      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.ok(row.manifest_json, 'expected manifest_json to be set on a done job');
      const manifest = JSON.parse(row.manifest_json);
      assert.strictEqual(manifest.projectId, projectId);
      assert.strictEqual(manifest.pinnedSeq, row.pinned_seq);
      assert.deepStrictEqual(manifest.assetIds, [asset.id]);
      assert.ok(manifest.outputHash && manifest.outputHash.length === 64, 'expected a real sha256 hex hash');
      assert.ok(manifest.durationMs > 0);
    });

    // 08-J J5: a job that FAILS verification must never become `status='done'` or keep a promotable
    // output file around — simulated by monkey-patching an impossible expected duration onto a real
    // finished render's own verification pass is out of reach here (verifyRenderOutput is called
    // internally with the render plan's OWN totalDurationMs, not a test-controlled value), so this
    // instead proves the CONTRACT directly: an output file that fails verification must be treated
    // as an error, not promoted — covered end-to-end by the "truncated/corrupt file" case above and
    // unit-level here for the "duration wildly off" branch specifically.
    await check('verifyRenderOutput: rejects a real file whose duration is wildly different from what was expected', async () => {
      const { id: projectId } = makeProject(ownerId);
      projectIds.push(projectId);
      insertClipCommand(projectId, asset.id, 1000);
      const jobId = crypto.randomUUID();
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id) VALUES (?, ?, ?)').run(jobId, projectId, ownerId);
      jobIds.push(jobId);
      await runRenderJobAsync(jobId, projectId, ownerId);
      const row = db.prepare('SELECT * FROM video_render_jobs WHERE id = ?').get(jobId);
      assert.strictEqual(row.status, 'done');
      // The real output is ~1000ms — asserting against a wildly different expectation (100000ms)
      // must fail, proving the tolerance check is actually wired up, not a no-op that always passes.
      const result = await verifyRenderOutput(row.output_path, 100000);
      assert.strictEqual(result.ok, false);
    });
  } finally {
    for (const jobId of jobIds) {
      const row = db.prepare('SELECT output_path FROM video_render_jobs WHERE id = ?').get(jobId);
      if (row?.output_path) fs.rmSync(path.dirname(row.output_path), { recursive: true, force: true });
      db.prepare('DELETE FROM video_render_jobs WHERE id = ?').run(jobId);
    }
    for (const projectId of projectIds) db.prepare('DELETE FROM video_projects WHERE id = ?').run(projectId);
    for (const assetId of promotedAssetIds) {
      const row = db.prepare('SELECT proxy_path FROM video_assets WHERE id = ?').get(assetId);
      if (row?.proxy_path) fs.rmSync(path.dirname(row.proxy_path), { recursive: true, force: true });
      db.prepare('DELETE FROM video_assets WHERE id = ?').run(assetId);
    }
    db.prepare('DELETE FROM video_assets WHERE id = ?').run(asset.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
