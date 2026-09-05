// 08-H S7 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md) spike:
// verifies the gap-fill approach for absolute-time compositing BEFORE touching renderPlanner.js's
// real code path — same "verify against real ffmpeg first" discipline as
// backend/video/spike/render-spike.js (see docs/decisions/0016-video-render-spike.md).
//
// Two things under test, both against real ffmpeg:
// 1. A "gap" pseudo-segment (a plain `color=` source, no asset input) concatenates correctly with
//    real clip-shaped segments via `concat=n=...:v=1:a=0`, producing the exact expected total
//    duration and the right color at the right time (proves the pixel-format/concat compatibility
//    of a synthesized gap segment against a real clip branch's own output shape).
// 2. If BOTH the base track and an overlay track are built this way (gap-filled from project t=0,
//    not compressed), a plain `overlay=x=0:y=0:eof_action=pass` with NO extra `tpad` wrapper
//    already aligns them correctly on absolute project time — because gap-filling IS the
//    positioning mechanism, applied once per track instead of once per external composite step.
//
// Run with: node backend/video/spike/absolute-time-spike.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const WIDTH = 320;
const HEIGHT = 240;
const FPS = 24;

async function preflight() {
  const { stdout } = await execFileAsync('ffmpeg', ['-version'], { windowsHide: true });
  console.log('preflight OK —', stdout.split('\n')[0]);
}

// extractAvgColor(videoPath, atSec) -> {r,g,b} average color of the frame at atSec — proves WHAT
// is visible at that timestamp, not just that ffmpeg didn't error.
async function extractAvgColor(videoPath, atSec) {
  const { stdout } = await execFileAsync('ffmpeg', [
    '-ss', String(atSec), '-i', videoPath, '-vframes', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-',
  ], { windowsHide: true, encoding: 'buffer', maxBuffer: 1024 * 1024 * 10 });
  const buf = stdout;
  let r = 0, g = 0, b = 0;
  const pixelCount = buf.length / 3;
  for (let i = 0; i < buf.length; i += 3) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
  return { r: Math.round(r / pixelCount), g: Math.round(g / pixelCount), b: Math.round(b / pixelCount) };
}

function isCloseTo(actual, expected, tolerance = 20) {
  return Math.abs(actual.r - expected.r) <= tolerance && Math.abs(actual.g - expected.g) <= tolerance && Math.abs(actual.b - expected.b) <= tolerance;
}

async function ffprobeDuration(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath], { windowsHide: true });
  return parseFloat(stdout.trim());
}

async function main() {
  await preflight();
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-abs-time-spike-'));

  // --- Test 1: gap-fill within a single track ---
  // blue(1s) -> gap/black(1s) -> green(1s) = 3s total, plain concat, no asset input for the gap.
  const out1 = path.join(scratchDir, 'test1-gapfill.mp4');
  const filter1 = [
    `color=c=blue:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[c0]`,
    `color=c=black:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[gap0]`,
    `color=c=green:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[c1]`,
    `[c0][gap0][c1]concat=n=3:v=1:a=0[vout]`,
  ].join(';');
  await execFileAsync('ffmpeg', ['-y', '-filter_complex', filter1, '-map', '[vout]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out1], { windowsHide: true });

  const dur1 = await ffprobeDuration(out1);
  if (Math.abs(dur1 - 3) > 0.15) throw new Error(`Test1 FAIL: expected ~3s total, got ${dur1}s`);
  const colorAt05 = await extractAvgColor(out1, 0.5);
  const colorAt15 = await extractAvgColor(out1, 1.5);
  const colorAt25 = await extractAvgColor(out1, 2.5);
  if (!isCloseTo(colorAt05, { r: 0, g: 0, b: 255 })) throw new Error(`Test1 FAIL: expected blue at t=0.5, got ${JSON.stringify(colorAt05)}`);
  if (!isCloseTo(colorAt15, { r: 0, g: 0, b: 0 })) throw new Error(`Test1 FAIL: expected black (gap) at t=1.5, got ${JSON.stringify(colorAt15)}`);
  if (!isCloseTo(colorAt25, { r: 0, g: 128, b: 0 })) throw new Error(`Test1 FAIL: expected green at t=2.5, got ${JSON.stringify(colorAt25)}`);
  console.log(`PASS — Test 1: gap-fill segment concatenates correctly, duration=${dur1.toFixed(2)}s, colors correct at each phase.`);

  // --- Test 2: cross-track absolute alignment via gap-fill, no separate tpad wrapper needed ---
  // Base track (opaque): blue(0-1s) + black-gap(1-2s) + green(2-3s) — same shape as Test 1.
  // Overlay track (transparent bg): transparent-gap(0-2s) + red(2-3s) — built the same way
  // buildClipVideoBranch's own bgLabel/contentLabel/overlay pattern composites a clip onto ITS
  // OWN canvas (opaque black for base, alpha-zero black for overlay), then the two per-track
  // outputs are combined with a PLAIN overlay at (0,0) — no tpad, no extra time-shift.
  const out2 = path.join(scratchDir, 'test2-cross-track.mp4');
  const filter2 = [
    // base track (opaque)
    `color=c=blue:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[b0]`,
    `color=c=black:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[bgap]`,
    `color=c=green:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[b1]`,
    `[b0][bgap][b1]concat=n=3:v=1:a=0[base]`,
    // overlay track (transparent bg) — a real clip branch would composite its content onto its own
    // transparent bg the same way buildClipVideoBranch does; here the "clip" IS just a solid red
    // fill standing in for that already-composited content, for the same reason Test 1 uses plain
    // color sources instead of real decoded video — isolates the concat/overlay mechanics under
    // test from unrelated real-decode noise.
    `color=c=black@0.0:s=${WIDTH}x${HEIGHT}:d=2:r=${FPS},format=yuva420p[ogap]`,
    `color=c=red:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS},format=yuva420p[ored]`,
    `[ogap][ored]concat=n=2:v=1:a=0[overlay]`,
    // composite: plain overlay at (0,0), no tpad — this is the core claim under test.
    `[base][overlay]overlay=x=0:y=0:eof_action=pass[vout]`,
  ].join(';');
  await execFileAsync('ffmpeg', ['-y', '-filter_complex', filter2, '-map', '[vout]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out2], { windowsHide: true });

  const dur2 = await ffprobeDuration(out2);
  if (Math.abs(dur2 - 3) > 0.15) throw new Error(`Test2 FAIL: expected ~3s total, got ${dur2}s`);
  const t05 = await extractAvgColor(out2, 0.5); // base=blue, overlay=transparent -> blue
  const t15 = await extractAvgColor(out2, 1.5); // base=black(gap), overlay=transparent -> black
  const t25 = await extractAvgColor(out2, 2.5); // base=green, overlay=red(opaque) -> red on top
  if (!isCloseTo(t05, { r: 0, g: 0, b: 255 })) throw new Error(`Test2 FAIL: expected blue (base only) at t=0.5, got ${JSON.stringify(t05)}`);
  if (!isCloseTo(t15, { r: 0, g: 0, b: 0 })) throw new Error(`Test2 FAIL: expected black (base gap, overlay still transparent) at t=1.5, got ${JSON.stringify(t15)}`);
  if (!isCloseTo(t25, { r: 255, g: 0, b: 0 })) throw new Error(`Test2 FAIL: expected red (overlay revealed) at t=2.5, got ${JSON.stringify(t25)}`);
  console.log(`PASS — Test 2: base+overlay track gap-filled independently align correctly with a PLAIN overlay (no tpad) — duration=${dur2.toFixed(2)}s, overlay only visible from t=2s as positioned.`);

  fs.rmSync(scratchDir, { recursive: true, force: true });
  console.log('\nALL SPIKE TESTS PASSED — safe to implement gap-fill in renderPlanner.js buildTrackLayer().');
}

main().catch((err) => {
  console.error('SPIKE FAILED —', err.message);
  process.exitCode = 1;
});
