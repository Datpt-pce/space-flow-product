// Preflight — Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md §3, §5):
// "máy dev thiếu FFmpeg full-build (thiếu drawtext) → preflight fail rõ ràng, không để lỗi ffmpeg
// exit code 1 mù mờ lộ ra UI." Checked once before dispatching any video-job on an agent (or this
// same process in SPACE_FLOW_MODE=agent) so a missing/incomplete ffmpeg install surfaces as one
// clear message instead of a generic "ffmpeg exited with code 1" the first time a real job runs.

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function checkBinary(bin) {
  try {
    const { stdout } = await execFileAsync(bin, ['-version'], { windowsHide: true });
    return { ok: true, version: stdout.split('\n')[0] };
  } catch (err) {
    return { ok: false, error: `"${bin}" không chạy được (không có trên PATH?): ${err.message}` };
  }
}

async function checkDrawtext() {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-filters'], { windowsHide: true });
    if (/drawtext/.test(stdout)) return { ok: true };
    return { ok: false, error: 'ffmpeg build này thiếu filter drawtext (cần build "full" có --enable-libfreetype --enable-fontconfig, xem gyan.dev/BtbN).' };
  } catch (err) {
    return { ok: false, error: `Không kiểm tra được danh sách filter: ${err.message}` };
  }
}

// runPreflight() -> { ok, ffmpeg, ffprobe, drawtext, errors: string[] } — `ok` is true only when
// every check passes; `errors` collects every failing check's message so a caller (route/UI) can
// show all of them at once instead of stopping at the first one.
async function runPreflight() {
  const [ffmpeg, ffprobe, drawtext] = await Promise.all([
    checkBinary('ffmpeg'),
    checkBinary('ffprobe'),
    checkDrawtext(),
  ]);

  const errors = [ffmpeg, ffprobe, drawtext].filter((r) => !r.ok).map((r) => r.error);
  return { ok: errors.length === 0, ffmpeg, ffprobe, drawtext, errors };
}

module.exports = { runPreflight };
