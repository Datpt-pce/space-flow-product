// XLSX import/export — Sheet Phase 0 PoC, Phase 2 production (specs/space-flow-master-plan/
// 03-spreadsheet.md). Univer's OWN import/export (`univerAPI.importXLSXToSnapshot`) is
// Pro-gated (see docs/decisions/0015-sheet-engine-spike.md and 03-spreadsheet.md §1) — this
// uses ExcelJS (MIT) instead, converting to/from the same IWorkbookData cellData shape
// univerAdapter.js consumes (row -> col -> {v} | {f}), so it plugs into the adapter without
// Univer needing to know XLSX exists at all.
//
// Phase 2 adds: minimal cell style (bold/italic/font color/background — Univer's IStyleData
// `bl`/`it`/`cl`/`bg` keys, see @univerjs/core's i-style-data.d.ts) and merged ranges. Still not
// handled (out of "tối thiểu" scope): number formats, borders, column widths/row heights,
// conditional formatting/data validation round-trip through the file itself (those OSS Univer
// plugins are enabled in engine/univerAdapter.js, but reading/writing THEIR xlsx representation
// is extra scope beyond Phase 2's "style tối thiểu/merge" wording).

import ExcelJS from 'exceljs';

// "AARRGGBB" (ExcelJS ARGB) -> "#RRGGBB" (Univer IColorStyle.rgb). Alpha is dropped — Univer's
// IColorStyle has no alpha channel.
function argbToRgbHex(argb) {
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

// "#RRGGBB" -> "FFRRGGBB" (ExcelJS ARGB, opaque).
function rgbHexToArgb(hex) {
  if (!hex) return undefined;
  return `FF${hex.replace('#', '')}`;
}

// Map an ExcelJS cell's font/fill onto Univer's IStyleData shape (bl/it/cl/bg) — undefined if
// the cell has no formatting worth carrying over, so plain cells don't grow an empty `s: {}`.
function cellToStyle(cell) {
  const style = {};
  if (cell.font?.bold) style.bl = 1;
  if (cell.font?.italic) style.it = 1;
  const fontRgb = argbToRgbHex(cell.font?.color?.argb);
  if (fontRgb) style.cl = { rgb: fontRgb };
  const fillRgb = cell.fill?.type === 'pattern' ? argbToRgbHex(cell.fill.fgColor?.argb) : undefined;
  if (fillRgb) style.bg = { rgb: fillRgb };
  return Object.keys(style).length ? style : undefined;
}

// Apply a Univer IStyleData object back onto an ExcelJS cell (inverse of cellToStyle).
function applyStyleToCell(excelCell, style) {
  if (!style) return;
  const font = {};
  if (style.bl) font.bold = true;
  if (style.it) font.italic = true;
  if (style.cl?.rgb) font.color = { argb: rgbHexToArgb(style.cl.rgb) };
  if (Object.keys(font).length) excelCell.font = font;
  if (style.bg?.rgb) {
    excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rgbHexToArgb(style.bg.rgb) } };
  }
}

// "A1:C3" -> {startRow,endRow,startColumn,endColumn} (0-indexed, BOTH ends inclusive — verified
// against @univerjs/core's actual runtime range-iteration code, `for (r = startRow; r <=
// endRow; r++)`; the .d.ts JSDoc comment calling endRow "exclusive" does not match that and
// would silently under-merge the last row/column if trusted instead).
function excelRangeToUniverMerge(rangeStr) {
  const [startRef, endRef] = rangeStr.split(':');
  const start = ExcelJS.utils?.decodeAddress ? ExcelJS.utils.decodeAddress(startRef) : decodeA1(startRef);
  const end = ExcelJS.utils?.decodeAddress ? ExcelJS.utils.decodeAddress(endRef) : decodeA1(endRef);
  return { startRow: start.row - 1, endRow: end.row - 1, startColumn: start.col - 1, endColumn: end.col - 1 };
}

// Fallback A1 decoder (ExcelJS.utils.decodeAddress covers this, kept only in case that helper
// isn't exported in a future ExcelJS version) — {row, col} 1-indexed.
function decodeA1(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

function columnLetter(col0) {
  let n = col0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function univerMergeToExcelRange(merge) {
  return `${columnLetter(merge.startColumn)}${merge.startRow + 1}:${columnLetter(merge.endColumn)}${merge.endRow + 1}`;
}

// Convert an ExcelJS Workbook (already loaded) into a Partial<IWorkbookData>-shaped object.
export function excelWorkbookToSnapshot(workbook, id = 'imported') {
  const sheets = {};
  const sheetOrder = [];

  workbook.eachSheet((worksheet, sheetId) => {
    const key = `sheet-${sheetId}`;
    sheetOrder.push(key);
    const cellData = {};
    let maxRow = 0;
    let maxCol = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const r = rowNumber - 1;
      cellData[r] = cellData[r] || {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const c = colNumber - 1;
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
        const style = cellToStyle(cell);
        if (cell.formula) {
          cellData[r][c] = { f: `=${cell.formula}`, ...(style ? { s: style } : {}) };
        } else if (cell.value !== null && cell.value !== undefined) {
          cellData[r][c] = { v: cell.value, ...(style ? { s: style } : {}) };
        }
      });
    });

    const mergeData = (worksheet.model.merges || []).map(excelRangeToUniverMerge);

    sheets[key] = {
      id: key,
      name: worksheet.name,
      rowCount: Math.max(maxRow + 1, 1),
      columnCount: Math.max(maxCol + 1, 1),
      cellData,
      mergeData,
    };
  });

  return {
    id,
    name: workbook.title || id,
    appVersion: '0.25.1',
    locale: 'enUS',
    styles: {},
    sheetOrder,
    sheets,
  };
}

// Convert a Partial<IWorkbookData>-shaped snapshot (e.g. from univerAdapter.getSnapshot())
// into a new ExcelJS Workbook, ready to write to a file/buffer.
export function snapshotToExcelWorkbook(snapshot) {
  const workbook = new ExcelJS.Workbook();
  for (const sheetId of snapshot.sheetOrder) {
    const sheetData = snapshot.sheets[sheetId];
    const worksheet = workbook.addWorksheet(sheetData.name);
    for (const [rowKey, rowData] of Object.entries(sheetData.cellData || {})) {
      const r = Number(rowKey) + 1;
      for (const [colKey, cell] of Object.entries(rowData)) {
        const c = Number(colKey) + 1;
        const excelCell = worksheet.getCell(r, c);
        if (cell.f) {
          excelCell.value = { formula: cell.f.replace(/^=/, '') };
        } else if (cell.v !== undefined) {
          excelCell.value = cell.v;
        }
        const style = typeof cell.s === 'object' ? cell.s : undefined;
        applyStyleToCell(excelCell, style);
      }
    }
    for (const merge of sheetData.mergeData || []) {
      worksheet.mergeCells(univerMergeToExcelRange(merge));
    }
  }
  return workbook;
}
