// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 5, §3 phản biện #8):
// pure A1-notation helpers shared by backend/routes/sheets.js (bindings rebase endpoint) and
// nodes/sheet-range-input|output (reading/writing a range by address). No @univerjs/* import —
// same IWorkbookData 0-indexed row/col convention as frontend/src/sheet/io/csv.js.

// colToLetter(0) -> 'A', colToLetter(26) -> 'AA'
function colToLetter(col) {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// letterToCol('A') -> 0, letterToCol('AA') -> 26
function letterToCol(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

// parseA1("A1:D20") -> {startRow:0,endRow:19,startCol:0,endCol:3} (0-indexed, inclusive).
// parseA1("B2") -> a single-cell range.
function parseA1(a1) {
  const m = String(a1).trim().toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error(`Địa chỉ range không hợp lệ: "${a1}"`);
  const [, colA, rowA, colB, rowB] = m;
  const startCol = letterToCol(colA);
  const startRow = Number(rowA) - 1;
  const endCol = colB ? letterToCol(colB) : startCol;
  const endRow = rowB ? Number(rowB) - 1 : startRow;
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

// toA1({startRow:0,endRow:19,startCol:0,endCol:3}) -> "A1:D20"
function toA1(range) {
  const start = `${colToLetter(range.startCol)}${range.startRow + 1}`;
  const end = `${colToLetter(range.endCol)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

// Shifts a single [start,end] axis (inclusive, 0-indexed) after a structural row/col
// insert or delete of `count` items at `index` on that SAME axis. Returns null if the axis
// range is entirely consumed by a delete (caller must drop the whole range in that case).
//
// insert: anything at/after `index` moves down by `count`. A range straddling `index` GROWS
// (its start stays, its end shifts) — the new rows/cols are treated as landing inside it. This
// is a convention choice (spreadsheet apps differ on this edge case), not a spec requirement —
// documented here so it can be revisited if manual testing shows it surprises users.
//
// delete: rows/cols [index, index+count-1] are removed; anything after shifts up by `count`.
// A range fully inside the deleted block collapses (returns null via the caller's null check on
// the 2-D result, see shiftRange below).
function shiftAxis(start, end, { op, index, count }) {
  if (op === 'insert') {
    return {
      start: start >= index ? start + count : start,
      end: end >= index ? end + count : end,
    };
  }
  // op === 'delete'
  const removeStart = index;
  const removeEnd = index + count - 1;
  let ns = start;
  let ne = end;
  if (ns >= removeStart && ns <= removeEnd) ns = removeStart;
  else if (ns > removeEnd) ns -= count;
  if (ne >= removeStart && ne <= removeEnd) ne = removeStart - 1;
  else if (ne > removeEnd) ne -= count;
  if (ne < ns) return null;
  return { start: ns, end: ne };
}

// shiftRange(range, {tabId, kind:'row'|'col', op:'insert'|'delete', index, count}, editTabId) ->
// new range, or null if the edit fully consumed it (caller should drop the binding). `range`'s
// own tab isn't checked here — the caller (route) only applies this to bindings whose tab_id
// already matches the edit's tab, since a structural edit in 1 tab never affects another tab's
// ranges.
function shiftRange(range, { kind, op, index, count }) {
  if (kind === 'row') {
    const shifted = shiftAxis(range.startRow, range.endRow, { op, index, count });
    if (!shifted) return null;
    return { ...range, startRow: shifted.start, endRow: shifted.end };
  }
  const shifted = shiftAxis(range.startCol, range.endCol, { op, index, count });
  if (!shifted) return null;
  return { ...range, startCol: shifted.start, endCol: shifted.end };
}

module.exports = { colToLetter, letterToCol, parseA1, toA1, shiftRange };
