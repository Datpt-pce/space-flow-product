// Sheet Phase 1 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 1): CRUD for the `sheets`
// document, copying backend/routes/workflows.js's ownership/visibility pattern verbatim (same
// private/team model, same 403/404 shape) — Sheet Phase 2 UI (SheetLibraryModal) is explicitly
// modeled on WorkflowLibraryModal, so the API it talks to should look the same.
//
// `snapshot` in request/response bodies is the FULL envelope ({schemaVersion, engine,
// engineVersion, workbook}), not just the Univer workbook — the caller (frontend adapter) builds
// that envelope; this route never inspects its contents, only stores/returns it verbatim.

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { pruneSheetRevisions } = require('../sheet/schema');
const { fetchValues, resolveTabTitle, GoogleSheetsApiError } = require('../services/googleSheets');
const { addTabToWorkbook, valuesToSheetTab } = require('../sheet/googleImport');
const googleOAuthClient = require('../services/googleOAuthClient');
const sheetSyncWorker = require('../services/sheetSyncWorker');
const { parseA1, toA1, shiftRange } = require('../sheet/rangeA1');

const router = express.Router();

// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3): same regex as
// frontend/src/sheet/google/parseSheetUrl.js — kept as a 2-line duplicate here rather than a
// shared module because the frontend copy is ESM (Vite) and this is CommonJS; re-validating
// server-side is required anyway (never trust a client-parsed id for a server-side fetch).
function parseGoogleSheetUrl(url) {
  const idMatch = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = String(url).match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

function toMeta(row) {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    isMine: undefined, // filled in by the route (needs req.user)
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertRevision(sheetId, snapshotJson, userId) {
  db.prepare(
    'INSERT INTO sheet_revisions (id, sheet_id, snapshot, created_by) VALUES (?, ?, ?, ?)'
  ).run(crypto.randomUUID(), sheetId, snapshotJson, userId);
  pruneSheetRevisions(db, sheetId);
}

// Every sheet the caller is allowed to see: their own (any visibility) + team-shared ones.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.name AS owner_name
    FROM sheets s JOIN users u ON u.id = s.owner_id
    WHERE s.visibility = 'team' OR s.owner_id = ?
    ORDER BY s.updated_at DESC
  `).all(req.user.id);
  res.json(rows.map(r => ({ ...toMeta(r), isMine: r.owner_id === req.user.id })));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT s.*, u.name AS owner_name FROM sheets s JOIN users u ON u.id = s.owner_id WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.visibility === 'private' && row.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Sheet này là riêng tư của người khác' });
  }
  res.json({ ...toMeta(row), isMine: row.owner_id === req.user.id, snapshot: JSON.parse(row.snapshot) });
});

router.post('/', (req, res) => {
  const { name, visibility, snapshot } = req.body;
  if (!name || !snapshot) return res.status(400).json({ error: 'Thiếu name hoặc snapshot' });
  const vis = visibility === 'team' ? 'team' : 'private';
  const id = crypto.randomUUID();
  const snapshotJson = JSON.stringify(snapshot);
  db.prepare(
    'INSERT INTO sheets (id, owner_id, name, visibility, snapshot) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.user.id, name, vis, snapshotJson);
  insertRevision(id, snapshotJson, req.user.id);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const { name, visibility, snapshot } = req.body;
  const nextName = name ?? row.name;
  const nextVisibility = visibility === 'team' || visibility === 'private' ? visibility : row.visibility;
  const nextSnapshotJson = snapshot !== undefined ? JSON.stringify(snapshot) : row.snapshot;

  db.prepare(
    "UPDATE sheets SET name = ?, visibility = ?, snapshot = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nextName, nextVisibility, nextSnapshotJson, req.params.id);
  if (snapshot !== undefined) insertRevision(req.params.id, nextSnapshotJson, req.user.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới xoá được sheet này' });
  db.prepare('DELETE FROM sheets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2): CRUD for
// sheet_port_bindings (table created in Phase 1, schema.js). Read follows the same
// private/team visibility as GET /:id (a team member wiring a shared sheet into their own
// workflow needs to see existing bindings); write is owner-only like every other mutation on
// this document — matches §3 phản biện #4 (Flow queries this table/route, never the sheet's
// snapshot blob, to find out which workflow a sheet feeds).
function loadSheetForBindings(req, res) {
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'Không tìm thấy sheet' }); return null; }
  if (row.visibility === 'private' && row.owner_id !== req.user.id) {
    res.status(403).json({ error: 'Sheet này là riêng tư của người khác' });
    return null;
  }
  return row;
}

router.get('/:id/bindings', (req, res) => {
  if (!loadSheetForBindings(req, res)) return;
  const rows = db.prepare(
    'SELECT * FROM sheet_port_bindings WHERE sheet_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(rows.map(r => ({
    id: r.id,
    sheetId: r.sheet_id,
    tabId: r.tab_id,
    rangeA1: r.range_a1,
    direction: r.direction,
    workflowNodeId: r.workflow_node_id,
    createdAt: r.created_at,
  })));
});

router.post('/:id/bindings', (req, res) => {
  const row = loadSheetForBindings(req, res);
  if (!row) return;
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const { tabId, rangeA1, direction, workflowNodeId } = req.body;
  if (!tabId || !rangeA1 || !workflowNodeId) return res.status(400).json({ error: 'Thiếu tabId, rangeA1 hoặc workflowNodeId' });
  if (direction !== 'input' && direction !== 'output') return res.status(400).json({ error: "direction phải là 'input' hoặc 'output'" });

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO sheet_port_bindings (id, sheet_id, tab_id, range_a1, direction, workflow_node_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, tabId, rangeA1, direction, workflowNodeId);
  res.json({ id });
});

router.delete('/:id/bindings/:bindingId', (req, res) => {
  const row = loadSheetForBindings(req, res);
  if (!row) return;
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const binding = db.prepare('SELECT id FROM sheet_port_bindings WHERE id = ? AND sheet_id = ?')
    .get(req.params.bindingId, req.params.id);
  if (!binding) return res.status(404).json({ error: 'Không tìm thấy binding' });
  db.prepare('DELETE FROM sheet_port_bindings WHERE id = ?').run(req.params.bindingId);
  res.json({ success: true });
});

// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3): paste-URL, 1-time
// copy into a new tab — no OAuth, public-sheet-only (API key). Rate-limited per user since the
// API key is shared across every user of this server (§4 Phase 3 "Rủi ro riêng").
const importGoogleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Quá nhiều lần import Google Sheets, vui lòng thử lại sau.' },
});

router.post('/:id/import-google', importGoogleLimiter, async (req, res) => {
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const parsed = req.body.url && parseGoogleSheetUrl(req.body.url);
  if (!parsed) return res.status(400).json({ error: 'URL Google Sheets không hợp lệ' });
  if (!process.env.GOOGLE_SHEETS_API_KEY) {
    return res.status(500).json({ error: 'Server chưa cấu hình GOOGLE_SHEETS_API_KEY — xem .env.example' });
  }

  try {
    const auth = { apiKey: process.env.GOOGLE_SHEETS_API_KEY };
    const tabTitle = await resolveTabTitle(parsed.spreadsheetId, parsed.gid, auth);
    const values = await fetchValues(parsed.spreadsheetId, tabTitle, auth);

    const envelope = JSON.parse(row.snapshot);
    envelope.workbook = addTabToWorkbook(envelope.workbook, values, tabTitle);
    const snapshotJson = JSON.stringify(envelope);

    db.prepare("UPDATE sheets SET snapshot = ?, updated_at = datetime('now') WHERE id = ?").run(snapshotJson, row.id);
    insertRevision(row.id, snapshotJson, req.user.id);

    db.prepare(`
      INSERT INTO sheet_external_links (id, sheet_id, provider, spreadsheet_id, remote_sheet_id, tab_range_map, mode, sync_status, last_sync_at)
      VALUES (?, ?, 'google_sheets', ?, ?, ?, 'import_once', 'synced', datetime('now'))
    `).run(crypto.randomUUID(), row.id, parsed.spreadsheetId, parsed.gid, JSON.stringify({ remoteTitle: tabTitle }));

    res.json({ success: true, tabTitle, rowCount: values.length, snapshot: envelope });
  } catch (err) {
    if (err instanceof GoogleSheetsApiError && (err.status === 403 || err.status === 404)) {
      return res.status(400).json({ error: 'Sheet riêng tư hoặc không tồn tại — cần kết nối Google (Settings) để đọc sheet riêng tư.' });
    }
    console.error('[sheets] import-google lỗi:', err.message);
    res.status(502).json({ error: 'Import từ Google Sheets thất bại: ' + err.message });
  }
});

// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4): OAuth-linked,
// read-only, kept in sync by backend/services/sheetSyncWorker.js. Requires the caller to have
// already connected via GET /api/google-oauth/connect.
router.post('/:id/link-google', async (req, res) => {
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const parsed = req.body.url && parseGoogleSheetUrl(req.body.url);
  if (!parsed) return res.status(400).json({ error: 'URL Google Sheets không hợp lệ' });
  const refreshIntervalSeconds = Math.max(Number(req.body.refreshIntervalSeconds) || 60, 15);

  try {
    const accessToken = await googleOAuthClient.getAccessTokenForUser(req.user.id);
    const tabTitle = await resolveTabTitle(parsed.spreadsheetId, parsed.gid, { accessToken });
    const values = await fetchValues(parsed.spreadsheetId, tabTitle, { accessToken });

    const envelope = JSON.parse(row.snapshot);
    const localTabId = `sheet-linked-${crypto.randomUUID().slice(0, 8)}`;
    envelope.workbook.sheetOrder = [...(envelope.workbook.sheetOrder || []), localTabId];
    envelope.workbook.sheets = { ...(envelope.workbook.sheets || {}), [localTabId]: valuesToSheetTab(values, localTabId, tabTitle) };
    const snapshotJson = JSON.stringify(envelope);

    db.prepare("UPDATE sheets SET snapshot = ?, updated_at = datetime('now') WHERE id = ?").run(snapshotJson, row.id);
    insertRevision(row.id, snapshotJson, req.user.id);

    const credentialRow = db.prepare(
      "SELECT id FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?"
    ).get(req.user.id, googleOAuthClient.CREDENTIAL_NAME);
    const hash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
    const linkId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sheet_external_links
        (id, sheet_id, provider, spreadsheet_id, remote_sheet_id, tab_range_map, owner_credential_ref, mode, refresh_interval_seconds, sync_status, remote_snapshot_hash, last_sync_at)
      VALUES (?, ?, 'google_sheets', ?, ?, ?, ?, 'linked_readonly', ?, 'synced', ?, datetime('now'))
    `).run(linkId, row.id, parsed.spreadsheetId, parsed.gid, JSON.stringify({ localTabId, remoteTitle: tabTitle }), credentialRow?.id ?? null, refreshIntervalSeconds, hash);

    res.json({ id: linkId, tabTitle, localTabId });
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      return res.status(400).json({ error: 'Chưa kết nối Google Sheets — vào Settings để kết nối trước.' });
    }
    if (err instanceof googleOAuthClient.GooglePermissionLostError) {
      return res.status(403).json({ error: err.message });
    }
    if (err instanceof GoogleSheetsApiError && (err.status === 403 || err.status === 404)) {
      return res.status(400).json({ error: 'Không có quyền đọc sheet này — kiểm tra sheet đã chia sẻ cho tài khoản Google đã kết nối chưa.' });
    }
    console.error('[sheets] link-google lỗi:', err.message);
    res.status(502).json({ error: 'Kết nối Google Sheets thất bại: ' + err.message });
  }
});

router.get('/:id/external-links', (req, res) => {
  if (!loadSheetForBindings(req, res)) return;
  const rows = db.prepare('SELECT * FROM sheet_external_links WHERE sheet_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(rows.map((r) => ({
    id: r.id,
    sheetId: r.sheet_id,
    provider: r.provider,
    spreadsheetId: r.spreadsheet_id,
    mode: r.mode,
    refreshIntervalSeconds: r.refresh_interval_seconds,
    lastSyncAt: r.last_sync_at,
    syncStatus: r.sync_status,
    lastError: r.last_error,
    createdAt: r.created_at,
  })));
});

router.post('/:id/external-links/:linkId/refresh-now', async (req, res) => {
  const row = db.prepare('SELECT owner_id FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });
  const link = db.prepare('SELECT id FROM sheet_external_links WHERE id = ? AND sheet_id = ?').get(req.params.linkId, req.params.id);
  if (!link) return res.status(404).json({ error: 'Không tìm thấy link' });

  const result = await sheetSyncWorker.syncLink(link.id);
  res.json(result);
});

router.delete('/:id/external-links/:linkId', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });
  db.prepare('DELETE FROM sheet_external_links WHERE id = ? AND sheet_id = ?').run(req.params.linkId, req.params.id);
  res.json({ success: true });
});

// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #8): called by
// frontend/src/sheet/SheetWorkspace.jsx whenever Univer executes a structural row/col
// insert/delete command, so a sheet_port_binding's range_a1 keeps pointing at the same DATA
// after the edit instead of silently drifting. See backend/sheet/rangeA1.js for the shift math.
router.post('/:id/bindings/rebase', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM sheets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy sheet' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được sheet này' });

  const { tabId, kind, op, index, count } = req.body;
  if (!tabId || !['row', 'col'].includes(kind) || !['insert', 'delete'].includes(op)
    || !Number.isInteger(index) || !Number.isInteger(count)) {
    return res.status(400).json({ error: 'Thiếu hoặc sai tabId/kind/op/index/count' });
  }

  const bindings = db.prepare('SELECT * FROM sheet_port_bindings WHERE sheet_id = ? AND tab_id = ?').all(req.params.id, tabId);
  let updated = 0;
  let removed = 0;
  for (const binding of bindings) {
    const shifted = shiftRange(parseA1(binding.range_a1), { kind, op, index, count });
    if (!shifted) {
      db.prepare('DELETE FROM sheet_port_bindings WHERE id = ?').run(binding.id);
      removed++;
      continue;
    }
    const nextA1 = toA1(shifted);
    if (nextA1 !== binding.range_a1) {
      db.prepare('UPDATE sheet_port_bindings SET range_a1 = ? WHERE id = ?').run(nextA1, binding.id);
      updated++;
    }
  }
  res.json({ success: true, updated, removed });
});

module.exports = router;
