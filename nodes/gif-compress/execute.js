const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { itemToPath, pathToItem } = require('../../backend/utils/items');

const execFileAsync = promisify(execFile);

// No winget package exists for gifsicle, so a small (~294KB) static Windows build
// ships alongside this node. Linux (Docker product) relies on `apt-get install
// gifsicle` (Dockerfile.backend) instead — ffmpeg itself is never bundled, it's
// already a system dependency everywhere this project runs (see video-assembly).
const GIFSICLE_BIN = process.platform === 'win32'
  ? path.join(__dirname, 'bin', 'gifsicle.exe')
  : 'gifsicle';

const MAX_ATTEMPTS = 7;
const SAMPLE_DURATION_SEC = 1;

// Cheap probe run before the real escalation loop: cuts a short sample out of the
// video, compresses just that at native scale + max lossy (the smallest size native
// resolution can ever reach), and extrapolates to the full duration. If that floor
// already fits under targetMax, native resolution is fine (lossy escalation alone
// will handle it). If not, back-solve the scale needed via area ratio (GIF size scales
// roughly with pixel count, i.e. scale^2) and round DOWN to the nearest 0.1 step so the
// guess is never optimistic — the real loop below still corrects any remaining gap.
// Verified against 3 real videos: predicted scale landed exact or one 0.1 step
// conservative of the actual converged value in all 3 cases.
async function estimateStartScale(inputPath, config, scratchDir, fileIdx, log) {
  const baseScale = config.scale ?? 1.0;
  const fps = config.fps ?? 24;
  const ditherStr = config.dither !== false ? 'floyd_steinberg' : 'none';
  const targetMax = config.target_max_mb ?? 9.5;

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath,
    ], { windowsHide: true });
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= SAMPLE_DURATION_SEC * 2) return baseScale;

    const sampleStart = duration * 0.3;
    const sampleRaw = path.join(scratchDir, `sample_${fileIdx}.gif`);
    const sampleOut = path.join(scratchDir, `sample_out_${fileIdx}.gif`);
    const w = `iw*${baseScale.toFixed(2)}`;
    const h = `ih*${baseScale.toFixed(2)}`;

    await execFileAsync('ffmpeg', [
      '-y', '-ss', sampleStart.toFixed(2), '-t', String(SAMPLE_DURATION_SEC), '-i', inputPath,
      '-filter_complex', `[0:v] fps=${fps},scale=${w}:${h}:flags=lanczos,split [a][b]; [a] palettegen=stats_mode=diff [p]; [b][p] paletteuse=dither=${ditherStr}:bayer_scale=3`,
      sampleRaw,
    ], { windowsHide: true });
    await execFileAsync(GIFSICLE_BIN, ['-O2', '--lossy=120', sampleRaw, '-o', sampleOut], { windowsHide: true });

    const sampleSizeMb = fs.statSync(sampleOut).size / (1024 * 1024);
    const estimatedFloorMb = (sampleSizeMb / SAMPLE_DURATION_SEC) * duration;
    fs.rmSync(sampleRaw, { force: true });
    fs.rmSync(sampleOut, { force: true });

    if (estimatedFloorMb <= targetMax) {
      log(`  ước tính trước: sàn nén ở scale gốc ~${estimatedFloorMb.toFixed(2)}MB, đủ dùng`);
      return baseScale;
    }

    const rawScale = Math.sqrt(targetMax / estimatedFloorMb) * baseScale;
    const roundedScale = Math.max(0.3, Math.min(baseScale, Math.floor(rawScale * 10) / 10));
    log(`  ước tính trước: sàn nén ở scale gốc ~${estimatedFloorMb.toFixed(2)}MB > target ${targetMax}MB -> bắt đầu ở scale=${roundedScale.toFixed(2)} thay vì ${baseScale.toFixed(2)}`);
    return roundedScale;
  } catch (err) {
    log(`  ước tính trước: bỏ qua (${err.message})`);
    return baseScale;
  }
}

// Multi-pass auto-optimization ported from the original desktop tool: ffmpeg builds
// a palette then re-encodes through it (paletteuse), gifsicle applies lossy + -O2 on
// top. If the result still exceeds targetMax, escalate in a fixed order — lossy first
// (30->60->90->120), then scale down to a 0.3 floor, then fps down to a 10 floor as a
// last resort — same order/thresholds the original tool used, in both Easy and Custom
// mode (the "mode" config field only controls which fields the UI shows).
//
// Palette + paletteuse run as a single ffmpeg command (filter_complex split) instead
// of two, halving decode work per render. And since `lossy` only affects the gifsicle
// step (not ffmpeg), the raw.gif from the last ffmpeg render is reused across attempts
// where only `lossy` changed — ffmpeg only re-runs when scale/fps actually change.
async function compressOne(inputPath, config, scratchDir, fileIdx, log) {
  let scale = await estimateStartScale(inputPath, config, scratchDir, fileIdx, log);
  let fps = config.fps ?? 24;
  let lossy = config.lossy ?? 30;
  const ditherStr = config.dither !== false ? 'floyd_steinberg' : 'none';
  const targetMax = config.target_max_mb ?? 9.5;

  let outPath = null;
  let sizeMb = 0;
  let rawPath = null;
  let renderedScale = null;
  let renderedFps = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    log(`  lần thử ${attempt + 1}/${MAX_ATTEMPTS}: scale=${scale.toFixed(2)} fps=${fps} lossy=${lossy}`);
    outPath = path.join(scratchDir, `out_${fileIdx}_${attempt}.gif`);

    if (rawPath === null || scale !== renderedScale || fps !== renderedFps) {
      rawPath = path.join(scratchDir, `raw_${fileIdx}_${attempt}.gif`);
      const w = `iw*${scale.toFixed(2)}`;
      const h = `ih*${scale.toFixed(2)}`;

      const t0 = Date.now();
      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath,
        '-filter_complex', `[0:v] fps=${fps},scale=${w}:${h}:flags=lanczos,split [a][b]; [a] palettegen=stats_mode=diff [p]; [b][p] paletteuse=dither=${ditherStr}:bayer_scale=3`,
        rawPath,
      ], { windowsHide: true });
      log(`    ffmpeg render: ${Date.now() - t0}ms`);
      renderedScale = scale;
      renderedFps = fps;
    } else {
      log('    ffmpeg: bỏ qua (tái dùng raw.gif của lần render trước)');
    }

    const t1 = Date.now();
    await execFileAsync(GIFSICLE_BIN, ['-O2', `--lossy=${lossy}`, rawPath, '-o', outPath], { windowsHide: true });
    log(`    gifsicle: ${Date.now() - t1}ms`);

    sizeMb = fs.statSync(outPath).size / (1024 * 1024);
    const ok = sizeMb <= targetMax;
    log(`    kết quả: ${sizeMb.toFixed(2)}MB (target ${targetMax}MB) -> ${ok ? 'đạt, dừng' : 'chưa đạt, leo thang tiếp'}`);
    if (ok) break;

    if (lossy < 60) lossy = 60;
    else if (lossy < 90) lossy = 90;
    else if (lossy < 120) lossy = 120;
    else if (scale > 0.35) scale = Math.max(0.3, scale - 0.1);
    else if (fps > 12) fps = Math.max(10, fps - 4);
    else break;
  }

  return { outPath, sizeMb };
}

function resolveOutputPath(inputPath, config) {
  const base = path.basename(inputPath, path.extname(inputPath));
  const targetDir = config.output_directory || path.join(path.dirname(inputPath), 'GIF_COMPRESSED_OUTPUT');
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, `${base}_compressed.gif`);
}

module.exports = async function execute(inputs, config, context) {
  if (!Array.isArray(inputs.files_in) || inputs.files_in.length === 0)
    throw new Error('gif-compress: No input files connected');

  const filesIn = inputs.files_in.map(it => itemToPath(it));
  const scratchDir = context.scratchDir();
  const filesOut = [];

  for (let i = 0; i < filesIn.length; i++) {
    const inputPath = filesIn[i];
    try {
      if (!inputPath) throw new Error('missing binary.data.path on input item');
      const log = (msg) => context.log(`gif-compress: ${path.basename(inputPath)} - ${msg}`);
      const { outPath, sizeMb } = await compressOne(inputPath, config, scratchDir, i, log);
      const finalPath = resolveOutputPath(inputPath, config);
      fs.copyFileSync(outPath, finalPath);
      context.log(`gif-compress: ${path.basename(inputPath)} -> ${path.basename(finalPath)} (${sizeMb.toFixed(2)} MB)`);
      filesOut.push(pathToItem(finalPath, { mimeType: 'image/gif' }));
    } catch (err) {
      context.log(`gif-compress: bỏ qua ${inputPath || `item #${i}`} — ${err.message}`);
    }
    context.progress(Math.round(((i + 1) / filesIn.length) * 100), `${i + 1}/${filesIn.length}`);
  }

  return { files_out: filesOut };
};
