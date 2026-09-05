// csv.js — Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2 task
// checklist: "viết csv.js riêng"). No @univerjs/* import — same IWorkbookData cellData shape
// convention as io/xlsx.js, but CSV has no formulas/styles/merges by definition, only values,
// so this is deliberately much smaller than xlsx.js.

// Convert raw CSV text into a Partial<IWorkbookData>-shaped snapshot. A field that parses
// cleanly as a number is stored as a number (matches how a real spreadsheet app treats CSV
// import — "1", "2.5" become numeric cells, not text) — anything else stays a string.
export function csvToSnapshot(csvText, id = 'imported') {
  const rows = parseCsv(csvText);
  const cellData = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    cellData[r] = {};
    row.forEach((field, c) => {
      if (field === '') return;
      maxCol = Math.max(maxCol, c);
      const asNumber = Number(field);
      cellData[r][c] = { v: field.trim() !== '' && !Number.isNaN(asNumber) ? asNumber : field };
    });
  });

  return {
    id,
    name: id,
    appVersion: '0.25.1',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: 'Sheet1',
        rowCount: Math.max(rows.length, 1),
        columnCount: Math.max(maxCol + 1, 1),
        cellData,
      },
    },
  };
}

// Convert a Partial<IWorkbookData>-shaped snapshot into CSV text — only the FIRST sheet (CSV
// has no concept of multiple tabs), values only (a formula cell exports its last computed
// value if present, otherwise the raw formula string as a last resort so nothing is silently
// dropped).
export function snapshotToCsv(snapshot) {
  const sheetId = snapshot.sheetOrder[0];
  const sheetData = sheetId ? snapshot.sheets[sheetId] : null;
  const cellData = sheetData?.cellData || {};

  const rowKeys = Object.keys(cellData).map(Number).sort((a, b) => a - b);
  const lines = rowKeys.map((r) => {
    const row = cellData[r];
    const colKeys = Object.keys(row).map(Number);
    const maxCol = colKeys.length ? Math.max(...colKeys) : -1;
    const fields = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = row[c];
      const value = cell ? (cell.v !== undefined && cell.v !== null ? cell.v : cell.f || '') : '';
      fields.push(escapeCsvField(String(value)));
    }
    return fields.join(',');
  });
  return lines.join('\r\n');
}

function escapeCsvField(field) {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

// Minimal RFC4180 CSV parser: quoted fields (embedded commas/newlines/escaped "" quotes),
// CRLF or LF line endings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignore — the paired \n (if any) below closes the row
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // Drop a single trailing blank row (from a final newline) — not a real empty row of data.
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}
