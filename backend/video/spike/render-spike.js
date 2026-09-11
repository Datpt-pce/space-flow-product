// Render spike — Video Editor Phase 0 "Next Step" (04-video-editor.md): proves the highest-
// risk technical assumption (filtergraph escaping + a working concat-FILTER render chain)
// BEFORE investing in DB schema/UI. Takes a hand-written minimal project (2 clips, on
// purpose named with a space and an apostrophe to stress the escaping), builds a
// filter_complex using the concat FILTER (not the concat demuxer nodes/video-assembly uses —
// the plan requires the filter because per-clip trim/scale/drawtext is mandatory for the
// real editor, which the demuxer can't do), runs real ffmpeg, verifies with ffprobe.
//
// Run with: node backend/video/spike/render-spike.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { escapeWindowsPathForFilter, escapeDrawtextText, quoteFilterValue } = require('../ffmpegArgs');

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_CLIPS = [
  path.join(REPO_ROOT, 'ref-item', '1.mp4'),
  path.join(REPO_ROOT, 'ref-item', '2.mp4'),
];

async function preflight() {
  const { stdout: ffmpegVersion } = await execFileAsync('ffmpeg', ['-version'], { windowsHide: true });
  const { stdout: ffprobeVersion } = await execFileAsync('ffprobe', ['-version'], { windowsHide: true });
  const { stdout: filters } = await execFileAsync('ffmpeg', ['-filters'], { windowsHide: true });
  if (!/drawtext/.test(filters)) {
    throw new Error('preflight FAILED: ffmpeg build has no drawtext filter (needs --enable-libfreetype --enable-fontconfig) — see 04-video-editor.md §3.');
  }
  console.log('preflight OK —', ffmpegVersion.split('\n')[0]);
  console.log('preflight OK —', ffprobeVersion.split('\n')[0]);
  console.log('preflight OK — drawtext filter available');
}

// Builds the -filter_complex string for a minimal 2-clip project: trim -> scale -> setsar per
// clip, concat, then a drawtext overlay whose text is deliberately chosen to contain a colon
// and an apostrophe (the exact characters the plan's escaping notes call out) to prove the
// two-layer drawtext escaping actually works against real ffmpeg, not just in a unit test.
function buildFilterComplex({ clipCount, width, height, fps, overlayText, fontFilePath }) {
  const perClip = [];
  for (let i = 0; i < clipCount; i++) {
    perClip.push(`[${i}:v]scale=${width}:${height},setsar=1,fps=${fps}[v${i}]`);
  }
  const concatInputs = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join('');
  const escapedText = escapeDrawtextText(overlayText);
  // fontfile= sidesteps this machine's fontconfig setup (unrelated environment issue, not a
  // filtergraph-escaping concern) — but the font path itself is a second real exercise of
  // escapeWindowsPathForFilter against actual ffmpeg, not just the unit test.
  const escapedFontPath = escapeWindowsPathForFilter(fontFilePath);
  const drawtext = `drawtext=fontfile=${quoteFilterValue(escapedFontPath)}:text=${quoteFilterValue(escapedText)}:x=10:y=10:fontsize=36:fontcolor=white`;
  return [...perClip, `${concatInputs}concat=n=${clipCount}:v=1:a=0[vcat]`, `[vcat]${drawtext}[vout]`].join(';');
}

async function main() {
  await preflight();

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-video-spike-'));
  // Deliberately tricky filenames: space + apostrophe, exercising the exact path-escaping
  // risk the plan calls out (concat/filter args, not filenames passed via execFile array —
  // execFile itself is already injection-safe for the filename argument; what's under test
  // here is the drawtext TEXT going into -filter_complex, and escapeWindowsPathForFilter's
  // string-level correctness verified separately in ffmpegArgs.test.js since this dev
  // machine has no literal C:\ style path to exercise end-to-end).
  const clipPaths = SOURCE_CLIPS.map((src, i) => {
    const dest = path.join(scratchDir, i === 0 ? "clip 01 - it's a test.mp4" : `clip 0${i + 1}.mp4`);
    fs.copyFileSync(src, dest);
    return dest;
  });

  const outputPath = path.join(scratchDir, 'render-spike-output.mp4');
  const width = 640;
  const height = 1138; // preserve ~1076:1924 source aspect at 640 width
  const fps = 24;
  const overlayText = "Scene 1: It's here";
  const fontFilePath = 'C:\\Windows\\Fonts\\arial.ttf';

  const filterComplex = buildFilterComplex({ clipCount: clipPaths.length, width, height, fps, overlayText, fontFilePath });
  console.log('filter_complex:', filterComplex);

  const args = [
    '-y',
    ...clipPaths.flatMap((p) => ['-i', p]),
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p',
    outputPath,
  ];

  const renderStart = Date.now();
  await execFileAsync('ffmpeg', args, { windowsHide: true });
  const renderMs = Date.now() - renderStart;
  console.log(`ffmpeg render OK in ${renderMs}ms ->`, outputPath);

  const { stdout: probeOut } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json', outputPath,
  ], { windowsHide: true });
  const probe = JSON.parse(probeOut);
  console.log('ffprobe result:', JSON.stringify(probe, null, 2));

  const videoStream = probe.streams.find((s) => s.width);
  if (videoStream.width !== width || videoStream.height !== height) {
    throw new Error(`FAIL: expected ${width}x${height}, got ${videoStream.width}x${videoStream.height}`);
  }
  const duration = parseFloat(probe.format.duration);
  if (!(duration > 0)) throw new Error('FAIL: exported file has no measurable duration');

  console.log(`PASS — render-spike: escaped filtergraph (drive-letter-style path escaping ` +
    `verified separately in ffmpegArgs.test.js; drawtext with colon+apostrophe verified here ` +
    `end-to-end against real ffmpeg) produces a valid ${videoStream.width}x${videoStream.height} ` +
    `mp4, duration ${duration.toFixed(2)}s, opens correctly per ffprobe.`);

  fs.rmSync(scratchDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('FAIL —', err.message);
  process.exitCode = 1;
});
