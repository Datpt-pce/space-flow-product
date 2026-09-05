// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4 task checklist):
// "backend/services/sheetSyncWorker.js: job định kỳ ... quét sheet_external_links mode
// linked_readonly đến hạn → batchGet → hash-diff → cập nhật sheets.snapshot nếu đổi; 429/5xx →
// backoff+jitter; 401/403 → sync_status='permission_lost'". Same in-memory-timer shape as
// backend/engine/scheduler.js (no persistence across restart — acceptable for this prototype
// scope, matches that file's own documented tradeoff).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { pruneSheetRevisions } = require('../sheet/schema');
const { fetchValues, resolveTabTitle, GoogleSheetsApiError } = require('./googleSheets');
const { valuesToSheetTab } = require('../sheet/googleImport');
const { getAccessTokenForUser, GooglePermissionLostError } = require('./googleOAuthClient');

const TICK_MS = 15 * 1000; // floor from §2's research note ("sàn 15s")
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const LOG_PATH = path.join(__dirname, '..', '..', 'logs', 'sheet-sync.log');
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
function logLine(message) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
}

// §2's per-user token-bucket note ("~40 req/phút/user"), scoped to the worker only (the Google
// call this makes IS the request the quota is about) — a simple sliding 60s window counter is
// enough here; a 2nd real bucket in the HTTP route layer would just be redundant since only this
// worker ever calls fetchValues() for linked_readonly links.
const MAX_REQUESTS_PER_MINUTE = 40;
const requestLog = new Map(); // userId -> timestamps[] within the last 60s

function underRateLimit(userId) {
  const now = Date.now();
  const timestamps = (requestLog.get(userId) || []).filter((t) => now - t < 60000);
  if (timestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    requestLog.set(userId, timestamps);
    return false;
  }
  timestamps.push(now);
  requestLog.set(userId, timestamps);
  return true;
}

function hashValues(values) {
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

// Attempt counters for backoff are intentionally in-memory only (like requestLog above) — a
// restart just resets to attempt 1, which is a fine failure mode for a sync job (worst case: 1
// fetch that could've waited a bit longer, not a correctness issue).
const attemptCounts = new Map(); // link id -> consecutive failure count

function backoffDelayMs(attempt) {
  const base = Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 1000); // jitter
}

function isLinkDue(link) {
  if (link.next_retry_at && new Date(link.next_retry_at).getTime() > Date.now()) return false;
  if (!link.last_sync_at) return true;
  const elapsedSeconds = (Date.now() - new Date(link.last_sync_at.replace(' ', 'T') + 'Z').getTime()) / 1000;
  return elapsedSeconds >= link.refresh_interval_seconds;
}

// syncLink(linkId) -> { status, message } — the single sync attempt for 1 external link, shared
// by the periodic tick() below AND the "Refresh now" HTTP route (backend/routes/sheets.js), so
// both paths can never drift in behavior.
async function syncLink(linkId) {
  const link = db.prepare('SELECT * FROM sheet_external_links WHERE id = ?').get(linkId);
  if (!link) return { status: 'error', message: 'Link không tồn tại' };
  const sheet = db.prepare('SELECT * FROM sheets WHERE id = ?').get(link.sheet_id);
  if (!sheet) return { status: 'error', message: 'Sheet không tồn tại' };

  if (!underRateLimit(sheet.owner_id)) {
    return { status: 'skipped', message: 'Đang chờ tới lượt (rate limit ~40 req/phút/user)' };
  }

  const tabMap = JSON.parse(link.tab_range_map || '{}');

  try {
    const accessToken = await getAccessTokenForUser(sheet.owner_id);
    const tabTitle = tabMap.remoteTitle || await resolveTabTitle(link.spreadsheet_id, link.remote_sheet_id, { accessToken });
    const values = await fetchValues(link.spreadsheet_id, tabTitle, { accessToken });
    const hash = hashValues(values);

    if (hash === link.remote_snapshot_hash) {
      db.prepare(
        "UPDATE sheet_external_links SET sync_status = 'synced', last_sync_at = datetime('now'), last_error = NULL, next_retry_at = NULL WHERE id = ?"
      ).run(link.id);
      attemptCounts.delete(link.id);
      return { status: 'synced', message: 'Không có thay đổi' };
    }

    const workbook = JSON.parse(sheet.snapshot).workbook;
    const localTabId = tabMap.localTabId;
    workbook.sheets[localTabId] = { ...valuesToSheetTab(values, localTabId, tabTitle), id: localTabId };
    const snapshotJson = JSON.stringify({ ...JSON.parse(sheet.snapshot), workbook });

    db.prepare("UPDATE sheets SET snapshot = ?, updated_at = datetime('now') WHERE id = ?").run(snapshotJson, sheet.id);
    const revisionId = crypto.randomUUID();
    db.prepare('INSERT INTO sheet_revisions (id, sheet_id, snapshot, created_by) VALUES (?, ?, ?, ?)')
      .run(revisionId, sheet.id, snapshotJson, sheet.owner_id);
    pruneSheetRevisions(db, sheet.id);

    db.prepare(`
      UPDATE sheet_external_links
      SET sync_status = 'synced', remote_snapshot_hash = ?, local_revision_id = ?, last_sync_at = datetime('now'),
          last_error = NULL, next_retry_at = NULL
      WHERE id = ?
    `).run(hash, revisionId, link.id);
    attemptCounts.delete(link.id);
    logLine(`${link.id} synced, ${values.length} rows, tab changed`);
    return { status: 'synced', message: 'Đã cập nhật' };
  } catch (err) {
    return handleSyncError(link, err);
  }
}

function handleSyncError(link, err) {
  const isPermissionLost = err instanceof GooglePermissionLostError
    || err.code === 'NOT_CONNECTED'
    || (err instanceof GoogleSheetsApiError && (err.status === 401 || err.status === 403));

  if (isPermissionLost) {
    db.prepare(
      "UPDATE sheet_external_links SET sync_status = 'permission_lost', last_error = ?, next_retry_at = NULL WHERE id = ?"
    ).run(err.message, link.id);
    logLine(`${link.id} permission_lost: ${err.message}`);
    return { status: 'permission_lost', message: err.message };
  }

  const isRetryable = err instanceof GoogleSheetsApiError ? (err.status === 429 || err.status >= 500) : true;
  const attempt = (attemptCounts.get(link.id) || 0) + 1;
  attemptCounts.set(link.id, attempt);
  const nextRetryAt = isRetryable ? new Date(Date.now() + backoffDelayMs(attempt)).toISOString() : null;

  db.prepare(
    "UPDATE sheet_external_links SET sync_status = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
  ).run(isRetryable ? 'offline' : 'conflict', err.message, nextRetryAt, link.id);
  logLine(`${link.id} sync lỗi (attempt ${attempt}): ${err.message}`);
  return { status: 'error', message: err.message };
}

let tickHandle = null;

async function tick() {
  const dueLinks = db.prepare("SELECT id FROM sheet_external_links WHERE mode = 'linked_readonly'").all()
    .filter((row) => isLinkDue(db.prepare('SELECT * FROM sheet_external_links WHERE id = ?').get(row.id)));
  for (const { id } of dueLinks) {
    await syncLink(id).catch((err) => logLine(`${id} tick lỗi không bắt được: ${err.message}`));
  }
}

function start() {
  if (tickHandle) return;
  tickHandle = setInterval(() => { tick().catch((err) => logLine(`tick lỗi: ${err.message}`)); }, TICK_MS);
}

function stop() {
  clearInterval(tickHandle);
  tickHandle = null;
}

module.exports = { start, stop, syncLink, tick };
