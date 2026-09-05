// Asset Service — Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md).
// Content-hash + probe + thumbnail/proxy generation for a local media file. This module runs on
// whichever process actually has filesystem access to the source file — the SPACE_FLOW_MODE=agent
// default (this dev server IS the "agent"), or a real paired agent's own process when
// SPACE_FLOW_MODE=server relays a video-job to it (backend/agent/videoJobs.js calls straight into
// this file on the agent side, same as executor.run() does for workflow nodes).
//
// Every ffmpeg/ffprobe invocation follows the same convention already established in
// nodes/video-assembly/execute.js: PATH-resolved binary name (no bundled path), execFile/spawn
// with a plain args array (no shell), windowsHide: true.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// hashFile(path) -> Promise<hex sha256> — streamed, so a multi-GB source file never gets fully
// buffered into memory (04-video-editor.md §5 Phase 2 acceptance criteria: "hash file vài GB
// không block HTTP request" — streaming is also what keeps this off the main thread's memory
// budget, not just non-blocking I/O).
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// probeMetadata(path) -> Promise<{ durationMs, width, height, fps, codecVideo, codecAudio,
// sizeBytes }> — a single ffprobe call reading both streams and format at once, matching the
// exact fields 04-video-editor.md §2's `video_assets` schema needs (duration_ms, width, height,
// fps, codec_v, codec_a). fps is computed from ffprobe's `r_frame_rate` fraction string (e.g.
// "24000/1001") rather than trusting a pre-divided float, which ffprobe doesn't provide directly.
async function probeMetadata(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_streams', '-show_format',
    '-of', 'json',
    filePath,
  ], { windowsHide: true });

  const probe = JSON.parse(stdout);
  const videoStream = (probe.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (probe.streams || []).find((s) => s.codec_type === 'audio');

  let fps = null;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den) fps = num / den;
  }

  let displayWidth = videoStream?.width ?? null;
  let displayHeight = videoStream?.height ?? null;
  const [sarWidth, sarHeight] = (videoStream?.sample_aspect_ratio || '1:1').split(':').map(Number);
  if (displayWidth && sarWidth > 0 && sarHeight > 0) displayWidth = Math.round(displayWidth * sarWidth / sarHeight);
  const rotation = Number(videoStream?.side_data_list?.find(data => data.rotation !== undefined)?.rotation ?? videoStream?.tags?.rotate ?? 0);
  if (Math.abs(Math.round(rotation / 90)) % 2 === 1) [displayWidth, displayHeight] = [displayHeight, displayWidth];

  return {
    durationMs: probe.format?.duration ? Math.round(parseFloat(probe.format.duration) * 1000) : null,
    sizeBytes: probe.format?.size ? Number(probe.format.size) : null,
    width: displayWidth,
    height: displayHeight,
    fps,
    codecVideo: videoStream?.codec_name ?? null,
    codecAudio: audioStream?.codec_name ?? null,
  };
}

// generateThumbnail(path, outPath, atSeconds) -> Promise<void> — a single JPEG frame at
// atSeconds. `-ss` BEFORE `-i` (input seeking) so this stays fast even on a long source file —
// ffmpeg can seek to the nearest keyframe without decoding everything before it.
async function generateThumbnail(filePath, outPath, atSeconds = 1) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(atSeconds),
    '-i', filePath,
    '-frames:v', '1',
    '-q:v', '3',
    outPath,
  ], { windowsHide: true });
}

// parseProgressLine(line, accumulator) — ffmpeg -progress pipe:1 emits repeated `key=value`
// lines, one full group per reported instant, terminated by a `progress=continue|end` line.
// Mutates and returns accumulator so a caller streaming stdout line-by-line can call this
// incrementally without re-parsing everything seen so far.
function parseProgressLine(line, accumulator) {
  const eq = line.indexOf('=');
  if (eq === -1) return accumulator;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  accumulator[key] = value;
  return accumulator;
}

// computeProgressPercent(outTimeMsRaw, totalDurationMs) -> a finite 0-100 number, or null if it
// can't compute one right now. ffmpeg's `-progress pipe:1` reports `out_time_ms=N/A` for the
// first instant or two before real numbers appear — Number("N/A") is NaN, and a caller (Phase 4's
// backend/agent/videoJobs.js render job) that fed that straight into a SQLite `progress_pct REAL
// NOT NULL` column crashed the ENTIRE backend process on an uncaught constraint violation the
// very first time a real render ran through it (see docs/issues/2026-08-28-
// render-progress-nan-crashes-server.md) — never trust this value as already-numeric.
function computeProgressPercent(outTimeMsRaw, totalDurationMs) {
  if (!totalDurationMs || outTimeMsRaw == null) return null;
  const outTimeMs = Number(outTimeMsRaw);
  if (!Number.isFinite(outTimeMs)) return null;
  const pct = Math.min(100, (outTimeMs / 1000 / totalDurationMs) * 100);
  return Number.isFinite(pct) ? pct : null;
}

// generateProxy(path, outPath, { gopSeconds, fps, onProgress }) -> Promise<void> — H.264
// baseline MP4 proxy for `<video>`-tag preview (04-video-editor.md §3: Chrome's <video> tag
// cannot decode ProRes/DNxHD, so every proxy is H.264/AAC regardless of source codec). GOP is
// deliberately SHORT (`-g` = fps * gopSeconds, default 0.5s) — §3's own finding: long-GOP H.264
// scrubs badly in a plain <video> tag, and this is the one place that must not be left at
// ffmpeg's own default. Streams `-progress pipe:1` through onProgress(percent) when a total
// duration is known (durationMs), matching the same progress-event shape Phase 4's real render
// job will need later (backend/agent/videoJobs.js reuses this parsing pattern, not a rewrite).
function generateProxy(filePath, outPath, { gopSeconds = 0.5, fps = 30, durationMs = null, crf = 23 } = {}, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const gopFrames = Math.max(1, Math.round(fps * gopSeconds));

    const proc = spawn('ffmpeg', [
      '-y',
      '-i', filePath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
      '-g', String(gopFrames), '-keyint_min', String(gopFrames),
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      outPath,
    ], { windowsHide: true });

    let progressAcc = {};
    let lineBuffer = '';
    let stderrTail = '';

    proc.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) {
        parseProgressLine(line.trim(), progressAcc);
        if (progressAcc.progress) {
          const pct = computeProgressPercent(progressAcc.out_time_ms, durationMs);
          if (onProgress && pct !== null) onProgress(pct);
          progressAcc = {};
        }
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000); // ffmpeg's real error is always near the end
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg proxy generation exited with code ${code}: ${stderrTail.trim()}`));
      }
    });
  });
}

module.exports = { hashFile, probeMetadata, generateThumbnail, generateProxy, parseProgressLine, computeProgressPercent };
