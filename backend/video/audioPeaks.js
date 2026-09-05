const { spawn } = require('child_process');

// Stream PCM into fixed-size peak buckets; long sources never accumulate a decoded audio buffer.
function audioPeaks(sourcePath, durationMs) {
  return new Promise((resolve, reject) => {
    const count = 4096, peaks = Array(count).fill(0);
    const samplesPerBucket = Math.max(1, Math.ceil(Number(durationMs) * 8 / count));
    const child = spawn('ffmpeg', ['-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    let pending = Buffer.alloc(0), index = 0, error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Quá thời gian đọc sóng âm.')); }, 120000);
    child.stdout.on('data', chunk => {
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const length = data.length - data.length % 4;
      for (let offset = 0; offset < length; offset += 4) {
        const bucket = Math.min(count - 1, Math.floor(index++ / samplesPerBucket));
        peaks[bucket] = Math.max(peaks[bucket], Math.min(1, Math.abs(data.readFloatLE(offset)) || 0));
      }
      pending = data.subarray(length);
    });
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-2000); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); code === 0 && index ? resolve({ peaks }) : reject(new Error(error || 'Không đọc được sóng âm.')); });
  });
}
module.exports = { audioPeaks };
