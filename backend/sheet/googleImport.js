// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3): backend-side
// (CommonJS) equivalent of frontend/src/sheet/io/csv.js's cellData-building convention — turns a
// 2-D array of Google Sheets API values into an IWorkbookData sheet tab. Kept separate from
// frontend/src/sheet/io/ because that directory is ESM/browser-only (imported by Vite), while
// this runs server-side inside backend/routes/sheets.js.

// valuesToSheetTab(values, tabId, tabName) -> IWorkbookData['sheets'][tabId] shape. `values` is
// the raw 2-D array from spreadsheets.values.batchGet with valueRenderOption=UNFORMATTED_VALUE
// (real numbers/booleans/strings, not formatted display strings) — rows can be ragged (Google
// omits trailing empty cells per row), so column count is derived from the widest row.
function valuesToSheetTab(values, tabId, tabName) {
  const cellData = {};
  let maxCol = 0;
  values.forEach((row, r) => {
    cellData[r] = {};
    row.forEach((field, c) => {
      if (field === '' || field === null || field === undefined) return;
      maxCol = Math.max(maxCol, c);
      cellData[r][c] = { v: field };
    });
  });

  return {
    id: tabId,
    name: tabName,
    rowCount: Math.max(values.length, 1),
    columnCount: Math.max(maxCol + 1, 1),
    cellData,
  };
}

// addTabToWorkbook(workbook, values, tabName) -> new workbook object (does not mutate `workbook`)
// with 1 more tab appended, given a unique tab id derived from tabName. `workbook` is the
// envelope's `.workbook` field (IWorkbookData), same shape blankWorkbook.js/csv.js produce.
function addTabToWorkbook(workbook, values, tabName) {
  const existingIds = new Set(workbook.sheetOrder || []);
  let tabId = `sheet-${tabName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` || 'sheet-imported';
  let suffix = 1;
  const baseTabId = tabId;
  while (existingIds.has(tabId)) {
    tabId = `${baseTabId}-${++suffix}`;
  }

  return {
    ...workbook,
    sheetOrder: [...(workbook.sheetOrder || []), tabId],
    sheets: {
      ...(workbook.sheets || {}),
      [tabId]: valuesToSheetTab(values, tabId, tabName),
    },
  };
}

module.exports = { valuesToSheetTab, addTabToWorkbook };
