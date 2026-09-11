// 08-C C6 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md) +
// ADR 0031 (docs/decisions/0031-renderer-capability-boundary-and-local-agent-responsibility.md):
// AgentCapabilitySnapshot per 08-C §2 (OS/runtime/filesystem, codec/decode/encode/filter/font,
// CPU/GPU/memory/disk, renderer/adapter+version) — a structured, cacheable report replacing the old
// pass/fail-only backend/video/preflight.js as the source future proactive capability-gating UI
// work will query. Pure-ish (only reads env/process/fs, no writes) so it's testable directly with
// `node`, same as preflight.js. Dispatched via runJob('capability-snapshot', {}) in
// backend/agent/videoJobs.js — never called directly from the backend Express process — so it
// always probes whichever machine actually runs ffmpeg (the paired agent in SPACE_FLOW_MODE=server,
// this process in =agent), same fix as the one already applied to preflight.

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { runPreflight } = require('./preflight');

const execFileAsync = promisify(execFile);

// env/hardware rarely changes mid-session, but a stale snapshot must expire rather than be trusted
// forever (08-C §3: "snapshot có expiry và failure reason").
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

// MVP codec scope per docs/decisions/0021-video-codec-os-matrix.md — H.264 (libx264) + AAC only.
// Checking for more would be speculative (no feature consumes broader codec support yet); checking
// for less would silently under-report what backend/video/renderPlanner.js actually depends on.
const REQUIRED_ENCODERS = { h264: 'libx264', aac: 'aac' };

async function checkEncoders() {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-encoders'], { windowsHide: true });
    const encoders = {};
    for (const [key, encoderName] of Object.entries(REQUIRED_ENCODERS)) {
      encoders[key] = new RegExp(`\\b${encoderName}\\b`).test(stdout);
    }
    return { ok: true, encoders };
  } catch (err) {
    return { ok: false, error: `Không liệt kê được encoder: ${err.message}`, encoders: {} };
  }
}

async function checkDiskFree(dirPath) {
  try {
    const stats = await fs.promises.statfs(dirPath);
    return { ok: true, freeBytes: stats.bfree * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  } catch (err) {
    return { ok: false, error: `Không đọc được dung lượng đĩa tại "${dirPath}": ${err.message}` };
  }
}

// buildCapabilitySnapshot(uploadsDir) -> AgentCapabilitySnapshot. `uploadsDir` should always be a
// path meaningful on THIS process (see videoJobs.js's 'capability-snapshot' case, which computes it
// relative to its own __dirname — never a path constructed by a caller on a DIFFERENT process, the
// same cross-machine-path mistake ADR 0031 already documents for the old direct runPreflight()
// call). GPU is explicitly NOT probed — no reliable cross-platform check exists in this codebase
// today — reported as `{ probed: false }` rather than a guessed/false value, matching this
// project's own "no false claims" stance (docs/decisions/0021-video-codec-os-matrix.md).
async function buildCapabilitySnapshot(uploadsDir) {
  const [preflight, encoders, disk] = await Promise.all([
    runPreflight(),
    checkEncoders(),
    checkDiskFree(uploadsDir),
  ]);

  const errors = [...preflight.errors];
  if (!encoders.ok) errors.push(encoders.error);
  if (!disk.ok) errors.push(disk.error);

  return {
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString(),
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    runtime: { node: process.version },
    filesystem: {
      checkedPath: uploadsDir,
      ok: disk.ok,
      freeBytes: disk.ok ? disk.freeBytes : null,
      totalBytes: disk.ok ? disk.totalBytes : null,
    },
    codec: {
      ffmpeg: preflight.ffmpeg,
      ffprobe: preflight.ffprobe,
      drawtext: preflight.drawtext,
      encoders: encoders.encoders,
    },
    hardware: {
      cpuCount: os.cpus().length,
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      gpu: { probed: false },
    },
    renderer: { adapter: 'ffmpeg', ffmpegVersion: preflight.ffmpeg.ok ? preflight.ffmpeg.version : null },
    ok: preflight.ok && encoders.ok && disk.ok,
    errors,
  };
}

module.exports = { buildCapabilitySnapshot, SNAPSHOT_TTL_MS };
