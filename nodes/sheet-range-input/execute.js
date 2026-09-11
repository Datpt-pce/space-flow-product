const { parseA1, colToLetter } = require('../../backend/sheet/rangeA1');
const { loadSheetForNode, getTab, upsertBinding } = require('../../backend/sheet/nodeAccess');
const { toItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config, context) {
  const { sheetId, tabId, rangeA1, hasHeaderRow } = config;
  if (!tabId) throw new Error('Thiếu config.tabId');
  if (!rangeA1) throw new Error('Thiếu config.rangeA1');

  const sheetRow = loadSheetForNode(sheetId, context?.userId, { write: false });
  const workbook = JSON.parse(sheetRow.snapshot).workbook;
  const tab = getTab(workbook, tabId);
  const range = parseA1(rangeA1);
  const cellData = tab.cellData || {};

  const cellValue = (r, c) => {
    const cell = cellData[r]?.[c];
    return cell && cell.v !== undefined ? cell.v : null;
  };

  const dataStartRow = hasHeaderRow ? range.startRow + 1 : range.startRow;
  const headers = [];
  for (let c = range.startCol; c <= range.endCol; c++) {
    headers.push(hasHeaderRow ? (cellValue(range.startRow, c) ?? colToLetter(c)) : colToLetter(c));
  }

  const rows = [];
  for (let r = dataStartRow; r <= range.endRow; r++) {
    const json = {};
    headers.forEach((header, i) => { json[header] = cellValue(r, range.startCol + i); });
    rows.push(json);
  }

  upsertBinding(sheetId, tabId, rangeA1, 'input', context?.nodeId || 'unknown');
  context?.log?.(`Đọc ${rows.length} hàng từ ${tabId}!${rangeA1}`);

  return { items: toItems(rows), row_count: rows.length };
};
