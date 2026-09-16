// CSV round-trip test — Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2).
// Pure Node, no browser/Univer needed (csv.js never imports @univerjs/*).
//
// Run with: node src/sheet/io/csv-roundtrip.test.mjs

import assert from 'assert';
import { csvToSnapshot, snapshotToCsv } from './csv.js';

function main() {
  // 1. Values covering the RFC4180 edge cases: plain, quoted-with-comma, quoted-with-newline,
  // escaped double-quote, numeric, and empty trailing field.
  const csv = [
    'name,note,score',
    '"Nguyễn Văn A","hello, world",42',
    '"multi\nline","say ""hi""",3.5',
  ].join('\r\n');

  const snapshot = csvToSnapshot(csv, 'csv-test');
  const cellData = snapshot.sheets['sheet-1'].cellData;
  assert.strictEqual(cellData[0][0].v, 'name');
  assert.strictEqual(cellData[1][0].v, 'Nguyễn Văn A');
  assert.strictEqual(cellData[1][1].v, 'hello, world');
  assert.strictEqual(cellData[1][2].v, 42, 'numeric-looking field should parse as a number');
  assert.strictEqual(cellData[2][0].v, 'multi\nline');
  assert.strictEqual(cellData[2][1].v, 'say "hi"');
  assert.strictEqual(cellData[2][2].v, 3.5);
  console.log('PASS — csvToSnapshot handles quoted commas/newlines/escaped quotes/numerics');

  // 2. Round-trip back to CSV text and re-parse — must be stable (same values survive twice).
  const exported = snapshotToCsv(snapshot);
  const reparsed = csvToSnapshot(exported, 'csv-test-2');
  const reparsedCells = reparsed.sheets['sheet-1'].cellData;
  assert.strictEqual(reparsedCells[1][1].v, 'hello, world');
  assert.strictEqual(reparsedCells[2][0].v, 'multi\nline');
  assert.strictEqual(reparsedCells[2][1].v, 'say "hi"');
  assert.strictEqual(reparsedCells[1][2].v, 42);
  console.log('PASS — snapshotToCsv -> csvToSnapshot round-trip is stable');
}

main();
