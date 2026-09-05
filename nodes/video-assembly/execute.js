const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { itemToPath } = require('../../backend/utils/items');
const { concatListLine } = require('../../backend/video/ffmpegArgs');

const execFileAsync = promisify(execFile);

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function srtTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

async function probeDurationMs(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ], { windowsHide: true });
  const sec = parseFloat(stdout.trim());
  if (!Number.isFinite(sec)) throw new Error(`video-assembly: ffprobe không đọc được duration của ${filePath}`);
  return Math.round(sec * 1000);
}

module.exports = async function execute(inputs, config, context) {
  const items = inputs.items || [];
  if (!items.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const videoPaths = items.map(it => itemToPath(it, 'video'));
  const audioPaths = items.map(it => itemToPath(it, 'audio'));
  const hasAllVideo = videoPaths.every(Boolean);
  const hasAllAudio = audioPaths.every(Boolean);
  if (!hasAllVideo && !hasAllAudio) {
    throw new Error('video-assembly: cần MỌI item có binary.video (Stage 4) hoặc MỌI item có binary.audio (Stage 3a) — không được thiếu/trộn lẫn.');
  }
  const mode = hasAllVideo ? 'video' : 'audio';
  const clipPaths = mode === 'video' ? videoPaths : audioPaths;

  const scratchDir = context.scratchDir();
  const outDir = path.join(context.uploadsDir, 'video-assembly', context.nodeId);
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = config.outputName || 'lesson_final';

  // Subtitle timing comes from real clip durations (ffprobe), not from upstream
  // duration_seconds metadata — self-contained, works regardless of what produced
  // the clips. A scene without dialogue/text just advances the cursor, no entry.
  let srtPath = null;
  if (config.generateSrt !== false) {
    let cursorMs = 0;
    let srt = '';
    let idx = 1;
    for (let i = 0; i < items.length; i++) {
      const durMs = await probeDurationMs(clipPaths[i]);
      const text = items[i]?.json?.dialogue || items[i]?.json?.text;
      if (text) {
        srt += `${idx}\n${srtTime(cursorMs)} --> ${srtTime(cursorMs + durMs)}\n${text}\n\n`;
        idx++;
      }
      cursorMs += durMs;
    }
    srtPath = path.join(outDir, `${baseName}.srt`);
    fs.writeFileSync(srtPath, srt, 'utf8');
  }

  const listFile = path.join(scratchDir, 'concat_list.txt');
  fs.writeFileSync(listFile, clipPaths.map(concatListLine).join('\n'), 'utf8');

  const ext = mode === 'video' ? 'mp4' : 'wav';
  const concatOut = path.join(scratchDir, `concat.${ext}`);
  if (mode === 'video') {
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-crf', String(config.crf ?? 20), '-r', String(config.fps || 24),
      '-c:a', 'aac', '-movflags', '+faststart', concatOut,
    ], { windowsHide: true });
  } else {
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:a', 'pcm_s16le', concatOut,
    ], { windowsHide: true });
  }

  const finalPath = path.join(outDir, `${baseName}.${ext}`);
  if (config.bgMusicPath) {
    if (!fs.existsSync(config.bgMusicPath)) throw new Error(`video-assembly: bgMusicPath không tồn tại: ${config.bgMusicPath}`);
    const vol = config.bgMusicVolume ?? 0.3;
    const filter = `[1:a]volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
    const mapArgs = mode === 'video' ? ['-map', '0:v', '-map', '[aout]', '-c:v', 'copy'] : ['-map', '[aout]'];
    await execFileAsync('ffmpeg', [
      '-y', '-i', concatOut, '-i', config.bgMusicPath,
      '-filter_complex', filter,
      ...mapArgs,
      '-c:a', mode === 'video' ? 'aac' : 'pcm_s16le',
      finalPath,
    ], { windowsHide: true });
  } else {
    fs.copyFileSync(concatOut, finalPath);
  }

  return { video: finalPath, srt: srtPath };
};
