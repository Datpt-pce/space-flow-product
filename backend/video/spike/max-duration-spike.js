// 08-H (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md, acceptance
// §5 "overlay dài hơn primary track render đúng duration/time") spike: verifies the fix for a real,
// documented gap BEFORE touching renderPlanner.js's real code path — same "verify against real
// ffmpeg first" discipline as backend/video/spike/absolute-time-spike.js
// (docs/decisions/0016-video-render-spike.md).
//
// The bug (confirmed by Test 1 below): `overlay=...:eof_action=pass` truncates the WHOLE composite
// to input0's (the base track's) own length, regardless of how much longer input1 (an overlay
// track) runs — an overlay clip extending past the base track's own end is silently cut off.
//
// The fix (confirmed by Test 2): pad the BASE layer's own stream to the true max duration BEFORE
// compositing any overlay onto it, so input0 is already as long as it needs to be by the time
// `eof_action=pass` matters.
//
// IMPORTANT — a real ffmpeg race discovered AFTER this spike first passed with `tpad=stop_duration`
// (kept here as history, not guessed): looping Test 2's exact filtergraph ~20x with `tpad` for the
// pad segment produced the WRONG duration (observed: 1025s instead of 3s) in roughly half the runs
// — a genuine ffmpeg filtergraph race between `tpad`'s own EOF signal and the downstream
// `overlay=...:eof_action=pass` step when both composited streams end at (or very near) the same
// instant, NOT a logic bug in this file. Test 3 below reproduces that race with `tpad` and confirms
// `concat` (buildGapSegment's own mechanism, already used everywhere else in this file for gaps)
// does NOT exhibit it across the same number of loops — this is why renderPlanner.js's real
// implementation pads via concat, not tpad, despite tpad looking simpler and passing on a single run.
//
// Run with: node backend/video/spike/max-duration-spike.js

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
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-max-dur-spike-'));

  // Shared scenario for both tests: base track = 2s solid blue (opaque). Overlay track = 1s
  // transparent + 2s solid red (transparentBg) = 3s total, i.e. 1s LONGER than the base.
  const baseFilter = `color=c=blue:s=${WIDTH}x${HEIGHT}:d=2:r=${FPS}[base]`;
  const overlayFilter = [
    `color=c=black@0.0:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS},format=yuva420p[ogap]`,
    `color=c=red:s=${WIDTH}x${HEIGHT}:d=2:r=${FPS},format=yuva420p[ored]`,
    `[ogap][ored]concat=n=2:v=1:a=0[overlay]`,
  ].join(';');

  // --- Test 1: confirms the BUG as it exists today (no pad) — output truncates to the base's own
  // 2s, silently dropping the last 1s of the overlay's red content (2s-3s).
  const out1 = path.join(scratchDir, 'test1-unpadded-truncates.mp4');
  const filter1 = [baseFilter, overlayFilter, `[base][overlay]overlay=x=0:y=0:eof_action=pass[vout]`].join(';');
  await execFileAsync('ffmpeg', ['-y', '-filter_complex', filter1, '-map', '[vout]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out1], { windowsHide: true });
  const dur1 = await ffprobeDuration(out1);
  if (Math.abs(dur1 - 2) > 0.15) throw new Error(`Test1 FAIL: expected the CURRENT BUG to truncate to ~2s, got ${dur1}s (bug may already be fixed upstream — re-check assumptions)`);
  console.log(`PASS — Test 1 (confirms the bug): unpadded base truncates a longer overlay to ~2s (got ${dur1.toFixed(2)}s) — the last 1s of red content is silently dropped.`);

  // --- Test 2: the REAL fix — pad the base to the max duration (3s) via a synthesized black
  // segment + `concat` (buildGapSegment's own mechanism) BEFORE compositing the overlay onto it.
  function buildFilterWithPad(padMechanism) {
    const padStep = padMechanism === 'tpad'
      ? `[base]tpad=stop_duration=1:color=black[basepadded]`
      : [`color=c=black:s=${WIDTH}x${HEIGHT}:d=1:r=${FPS}[vpad0]`, `[base][vpad0]concat=n=2:v=1:a=0[basepadded]`].join(';');
    return [baseFilter, padStep, overlayFilter, `[basepadded][overlay]overlay=x=0:y=0:eof_action=pass[vout]`].join(';');
  }

  const out2 = path.join(scratchDir, 'test2-padded-preserves-overlay-tail.mp4');
  await execFileAsync('ffmpeg', ['-y', '-filter_complex', buildFilterWithPad('concat'), '-map', '[vout]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out2], { windowsHide: true });
  const dur2 = await ffprobeDuration(out2);
  if (Math.abs(dur2 - 3) > 0.15) throw new Error(`Test2 FAIL: expected ~3s total after padding, got ${dur2}s`);
  const t05 = await extractAvgColor(out2, 0.5); // base=blue, overlay=transparent gap -> blue
  const t15 = await extractAvgColor(out2, 1.5); // base=blue(still within its own 2s), overlay=red -> red on top
  const t28 = await extractAvgColor(out2, 2.8); // base=padded-black (past its own 2s end), overlay=red -> red on top, PROVING the tail survives
  if (!isCloseTo(t05, { r: 0, g: 0, b: 255 })) throw new Error(`Test2 FAIL: expected blue at t=0.5, got ${JSON.stringify(t05)}`);
  if (!isCloseTo(t15, { r: 255, g: 0, b: 0 })) throw new Error(`Test2 FAIL: expected red (overlay on top of blue) at t=1.5, got ${JSON.stringify(t15)}`);
  if (!isCloseTo(t28, { r: 255, g: 0, b: 0 })) throw new Error(`Test2 FAIL: expected red at t=2.8 (past base's original 2s end) — this is the exact bug being fixed, got ${JSON.stringify(t28)}`);
  console.log(`PASS — Test 2 (confirms the fix): base padded via concat to 3s, overlay's tail (red, 2s-3s) survives past the base's original 2s end — duration=${dur2.toFixed(2)}s.`);

  // --- Test 3: the race — loops BOTH pad mechanisms N times each. `tpad` is expected to
  // occasionally produce a WRONG duration (this is the actual bug that made this file worth
  // updating after Test 2 first passed on a single run); `concat` must be correct every time.
  // Real encodes, real disk I/O — kept to a modest N (not hundreds) so this spike stays fast enough
  // to actually get run; the failure rate observed during investigation (~50%) makes even N=6 a
  // strong signal, not a coin flip.
  const N = 6;
  async function runOnce(padMechanism, i) {
    const out = path.join(scratchDir, `test3-${padMechanism}-${i}.mp4`);
    await execFileAsync('ffmpeg', ['-y', '-filter_complex', buildFilterWithPad(padMechanism), '-map', '[vout]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out], { windowsHide: true });
    return ffprobeDuration(out);
  }
  const tpadDurations = [];
  for (let i = 0; i < N; i++) tpadDurations.push(await runOnce('tpad', i));
  const concatDurations = [];
  for (let i = 0; i < N; i++) concatDurations.push(await runOnce('concat', i));
  const tpadWrongCount = tpadDurations.filter((d) => Math.abs(d - 3) > 0.15).length;
  const concatWrongCount = concatDurations.filter((d) => Math.abs(d - 3) > 0.15).length;
  console.log(`Test 3 raw results — tpad: [${tpadDurations.map((d) => d.toFixed(1)).join(', ')}], concat: [${concatDurations.map((d) => d.toFixed(1)).join(', ')}]`);
  if (concatWrongCount > 0) throw new Error(`Test3 FAIL: concat (the mechanism actually used in renderPlanner.js) produced a wrong duration ${concatWrongCount}/${N} times — the race is NOT actually fixed, re-investigate before trusting this approach.`);
  if (tpadWrongCount === 0) {
    console.log(`PASS — Test 3 (weak — race did not reproduce this run): tpad happened to be correct all ${N} times here (it IS non-deterministic — re-run this spike if you need to see the failure directly), concat correct ${N}/${N} as required.`);
  } else {
    console.log(`PASS — Test 3 (confirms the race + the fix): tpad was wrong ${tpadWrongCount}/${N} times (the real bug), concat correct ${N}/${N} times — concat is the right primitive, not tpad.`);
  }

  fs.rmSync(scratchDir, { recursive: true, force: true });
  console.log('\nALL SPIKE TESTS PASSED — safe to implement max-duration padding (via concat, NOT tpad) in renderPlanner.js buildRenderPlan().');
}

main().catch((err) => {
  console.error('SPIKE FAILED —', err.message);
  process.exitCode = 1;
});
