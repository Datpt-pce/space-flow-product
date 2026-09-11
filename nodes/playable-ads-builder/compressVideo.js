const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_HTML_BYTES = 5_000_000;
const TARGET_HTML_BYTES = 4_800_000;
const MIN_VIDEO_BITRATE = 80_000;
const MAX_ATTEMPTS = 3;

const embeddedBytes = (videoBytes) => 4 * Math.ceil(videoBytes / 3);

// Wait for close (including after abort) before callers remove FFmpeg's files.
function runTool(executable, args, { signal, onTime, timeoutMs = 900_000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let failure;
    const abort = () => { failure = new Error('Đã hủy nén playable ad'); proc.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => {
      failure = new Error('Nén playable ad quá thời gian cho phép');
      proc.kill();
    }, timeoutMs);
    let pending = '';
    proc.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-1_000_000);
      if (!onTime) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) onTime(Number(line.slice(12)) / 1_000_000);
      }
    });
    proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    proc.on('error', (error) => {
      failure = error.code === 'ENOENT'
        ? new Error(`Không tìm thấy ${executable}. Cài FFmpeg (kèm ffprobe) trên máy chạy node hoặc đặt FFMPEG_PATH/FFPROBE_PATH.`)
        : error;
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`FFmpeg/ffprobe thất bại (${code}): ${stderr.trim()}`));
      else resolve(stdout);
    });
  });
}

async function prepareVideo(videoPath, overheadBytes, context = {}) {
  const { signal } = context;
  signal?.throwIfAborted();
  const sourceBytes = fs.statSync(videoPath).size;
  if (!sourceBytes) throw new Error('Video đầu vào rỗng');
  if (overheadBytes + embeddedBytes(sourceBytes) < MAX_HTML_BYTES) {
    return fs.readFileSync(videoPath);
  }
  // Round down to whole Base64 groups. Reserve room inside MP4 for muxing.
  const budget = Math.floor((TARGET_HTML_BYTES - overheadBytes) / 4) * 3;
  if (budget <= 64_000) throw new Error('HTML/config quá lớn, không còn đủ dung lượng cho video dưới 5 MB');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const metadata = JSON.parse(await runTool(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration,avg_frame_rate',
    '-of', 'json', path.resolve(videoPath),
  ], { signal, timeoutMs: 30_000 }));
  const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(metadata.format?.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Không đọc được thời lượng video để tính dung lượng playable ad');
  }
  const hasAudio = metadata.streams.some((stream) => stream.codec_type === 'audio');
  const audioBitrate = hasAudio ? 64_000 : 0;
  let videoBitrate = Math.floor((budget - 64_000) * 8 / duration - audioBitrate);
  const [numerator, denominator] = String(video.avg_frame_rate || '0/1').split('/').map(Number);
  const sourceFps = numerator / denominator;
  const temporaryRoot = path.resolve(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'sf-playable-'));
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      signal?.throwIfAborted();
      if (videoBitrate < MIN_VIDEO_BITRATE) break;
      const longEdge = attempt === 0 && videoBitrate >= 600_000 ? 1280 : 960;
      const fpsCap = attempt === 0 ? 30 : 24;
      const fps = Number.isFinite(sourceFps) && sourceFps > 0 ? Math.min(sourceFps, fpsCap) : fpsCap;
      const filter = `scale=w='trunc(iw*min(1,${longEdge}/max(iw,ih))/2)*2':h='trunc(ih*min(1,${longEdge}/max(iw,ih))/2)*2',fps=${fps}`;
      const output = path.join(temporary, 'compressed.mp4');
      const common = [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.resolve(videoPath),
        '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'medium', '-b:v', String(videoBitrate),
        '-pix_fmt', 'yuv420p', '-vf', filter, '-passlogfile', path.join(temporary, 'encode'),
        '-map_metadata', '-1', '-map_chapters', '-1', '-progress', 'pipe:1', '-nostats',
      ];
      context.log?.(`Nén playable: lượt ${attempt + 1}/${MAX_ATTEMPTS}, video ${Math.round(videoBitrate / 1000)} kbps, audio ${audioBitrate / 1000} kbps`);
      for (const pass of [1, 2]) {
        context.progress?.(0, `Nén video lần ${attempt + 1}, pass ${pass}/2`);
        const end = pass === 1
          ? ['-an', '-pass', '1', '-f', 'null', '-']
          : [...(hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', String(audioBitrate), '-ac', '2'] : ['-an']),
            '-pass', '2', '-movflags', '+faststart', output];
        await runTool(ffmpeg, [...common, ...end], {
          signal,
          onTime: (seconds) => context.progress?.(
            Math.min(99, Math.round(((pass - 1) + Math.min(1, seconds / duration)) * 50)),
            `Nén video lần ${attempt + 1}, pass ${pass}/2`,
          ),
        });
      }
      const actualBytes = fs.statSync(output).size;
      if (actualBytes > 0 && actualBytes <= budget) {
        context.log?.(`Video: ${sourceBytes} → ${actualBytes} byte; giữ nguyên file nguồn`);
        return fs.readFileSync(output);
      }
      videoBitrate = Math.floor(videoBitrate * Math.min(0.85, budget / Math.max(1, actualBytes) * 0.94));
    }
    throw new Error('Không thể nén playable ad dưới 5 MB với mức chất lượng tối thiểu. Hãy dùng video ngắn hơn.');
  } finally {
    // Only delete this invocation's mkdtemp directory, never an input directory.
    if (path.dirname(temporary) === temporaryRoot && path.basename(temporary).startsWith('sf-playable-')) {
      fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

module.exports = { MAX_HTML_BYTES, TARGET_HTML_BYTES, embeddedBytes, prepareVideo, runTool };
