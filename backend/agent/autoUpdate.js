const { execSync } = require('child_process');
const { readAutoUpdateConfig } = require('../config/agentConfig');
const { isAgentClone, runUpdatePipeline, scheduleSelfRestart, ROOT_DIR } = require('../routes/system').internals;
const { isBusy } = require('../engine/executor');

const POLL_INTERVAL_MS = 20 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;

// Chan 2 doi tick chong nhau (vd 1 dot dang cap nhat/reset code cham hon 1 chu ky poll).
let updating = false;

function hasNewCommits(dir) {
  try {
    execSync('git fetch origin', { cwd: dir, stdio: 'ignore', windowsHide: true });
    const local = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
    const remote = execSync('git rev-parse origin/main', { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
    return local !== remote;
  } catch {
    // Mat mang/loi git - bo qua dot nay, thu lai o chu ky sau. Chay ngam, khong ai theo doi
    // nen khong can bao loi ra dau.
    return false;
  }
}

// Ho tro khung gio qua nua dem (vd 22:00-05:00): start > end thi coi la con trong khung khi
// gio hien tai >= start HOAC < end.
function inWindow({ windowStart, windowEnd }) {
  if (!windowStart || !windowEnd) return true;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = windowStart.split(':').map(Number);
  const [eh, em] = windowEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? (mins >= start && mins < end) : (mins >= start || mins < end);
}

async function tick() {
  if (updating) return;

  const cfg = readAutoUpdateConfig();
  if (!cfg.enabled || !inWindow(cfg)) return;
  if (!isAgentClone(ROOT_DIR) || !hasNewCommits(ROOT_DIR)) return;
  if (isBusy()) {
    console.log('[auto-update] có node đang chạy — bỏ qua đợt này, thử lại đợt sau.');
    return;
  }

  updating = true;
  try {
    const onLog = (target, line) => console.log(`[auto-update:${target}] ${line}`);
    const result = await runUpdatePipeline(onLog);
    if (result.pullCode) {
      console.log('[auto-update] code đã cập nhật — agent sẽ tự khởi động lại...');
      scheduleSelfRestart(ROOT_DIR);
    }
  } catch (err) {
    console.error(`[auto-update] lỗi cập nhật (bỏ qua, thử lại đợt sau): ${err.message}`);
  } finally {
    updating = false;
  }
}

function start() {
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { start };
