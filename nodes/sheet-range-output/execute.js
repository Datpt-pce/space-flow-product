const crypto = require('crypto');
const db = require('../../backend/db');
const { pruneSheetRevisions } = require('../../backend/sheet/schema');
const { parseA1, toA1 } = require('../../backend/sheet/rangeA1');
const { loadSheetForNode, getTab, upsertBinding } = require('../../backend/sheet/nodeAccess');
const { fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config, context) {
  const { sheetId, tabId, anchorA1, includeHeaderRow } = config;
  if (!tabId) throw new Error('Thiếu config.tabId');
  if (!anchorA1) throw new Error('Thiếu config.anchorA1');

  const rows = fromItems(inputs.items || []);
  if (rows.length === 0) {
    context?.log?.('Không có item nào để ghi — bỏ qua.');
    return { written_count: 0, range_a1: anchorA1 };
  }

  const anchor = parseA1(anchorA1);

  // Column order: keys of the first item, plus any extra key seen later (first-seen order) —
  // so a batch with slightly ragged shape never silently drops a field just because it wasn't
  // on item[0].
  const headers = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) { seen.add(key); headers.push(key); }
    }
  }

  const sheetRow = loadSheetForNode(sheetId, context?.userId, { write: true });
  const envelope = JSON.parse(sheetRow.snapshot);
  const tab = getTab(envelope.workbook, tabId);
  tab.cellData = tab.cellData || {};

  let r = anchor.startRow;
  if (includeHeaderRow) {
    tab.cellData[r] = tab.cellData[r] || {};
    headers.forEach((h, i) => { tab.cellData[r][anchor.startCol + i] = { v: h }; });
    r++;
  }
  for (const row of rows) {
    tab.cellData[r] = tab.cellData[r] || {};
    headers.forEach((h, i) => {
      const value = row[h];
      if (value !== undefined) tab.cellData[r][anchor.startCol + i] = { v: value === null ? '' : value };
    });
    r++;
  }
  const endRow = r - 1;
  const endCol = anchor.startCol + headers.length - 1;
  tab.rowCount = Math.max(tab.rowCount || 0, endRow + 1);
  tab.columnCount = Math.max(tab.columnCount || 0, endCol + 1);

  const snapshotJson = JSON.stringify(envelope);
  db.prepare("UPDATE sheets SET snapshot = ?, updated_at = datetime('now') WHERE id = ?").run(snapshotJson, sheetId);
  db.prepare('INSERT INTO sheet_revisions (id, sheet_id, snapshot, created_by) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), sheetId, snapshotJson, context?.userId || null);
  pruneSheetRevisions(db, sheetId);

  const rangeA1 = toA1({ startRow: anchor.startRow, endRow, startCol: anchor.startCol, endCol });
  upsertBinding(sheetId, tabId, rangeA1, 'output', context?.nodeId || 'unknown');
  context?.log?.(`Ghi ${rows.length} hàng vào ${tabId}!${rangeA1}`);

  return { written_count: rows.length, range_a1: rangeA1 };
};
