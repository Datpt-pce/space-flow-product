// 100k-cell fixture — Sheet Phase 0 spike (specs/space-flow-master-plan/03-spreadsheet.md
// Phase 0). 500 rows x 200 columns. ~20% of cells carry a formula, in 5 chains of depth 8 per
// row (5*8=40 formula cells/row * 500 rows = 20,000 = 20% of 100,000), so recalculation has to
// walk a real (if short) dependency graph rather than 1-hop formulas only.
//
// Import buildFixtureWorkbook() directly — this returns a plain object (Partial<IWorkbookData>
// shape from @univerjs/core), it does not import any @univerjs/* package itself, so it can be
// generated/inspected without paying Univer's bundle cost.

const ROWS = 500;
const COLS = 200;
const CHAINS_PER_ROW = 5;
const CHAIN_DEPTH = 8;
const CHAIN_SPACING = 40; // columns between chain starts, must be > CHAIN_DEPTH + 1

function columnLetter(col) {
  let n = col;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function buildFixtureWorkbook(seed = 42) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const cellData = {};
  for (let r = 0; r < ROWS; r++) {
    cellData[r] = {};
    for (let c = 0; c < COLS; c++) {
      cellData[r][c] = { v: Math.round(rand() * 1000) };
    }
    for (let chain = 0; chain < CHAINS_PER_ROW; chain++) {
      const startCol = chain * CHAIN_SPACING;
      // startCol itself is the raw seed value (already set above); the next CHAIN_DEPTH
      // columns are formulas each referencing the previous column, same row.
      for (let d = 1; d <= CHAIN_DEPTH; d++) {
        const col = startCol + d;
        const prevCol = col - 1;
        const ref = `${columnLetter(prevCol)}${r + 1}`;
        cellData[r][col] = { f: `=${ref}+1` };
      }
    }
  }

  return {
    id: 'fixture-100k',
    name: 'Fixture 100k',
    appVersion: '0.25.1',
    locale: 'enUS',
    styles: {},
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: 'Sheet1',
        rowCount: ROWS,
        columnCount: COLS,
        cellData,
      },
    },
  };
}

export const FIXTURE_DIMENSIONS = { rows: ROWS, cols: COLS, totalCells: ROWS * COLS, formulaCells: ROWS * CHAINS_PER_ROW * CHAIN_DEPTH };

// Deepest formula cell of the first row's first chain — useful as a "recalculation depth 8"
// probe: editing the chain's raw seed cell (column 0) should ripple through 8 dependent cells
// before this one settles.
export function deepChainProbeCell() {
  return { row: 0, seedCol: 0, deepCol: CHAIN_DEPTH };
}
