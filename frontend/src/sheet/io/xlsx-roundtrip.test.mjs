// XLSX round-trip PoC test — Sheet Phase 0 (specs/space-flow-master-plan/03-spreadsheet.md
// Phase 0 acceptance criteria: "PoC xlsx round-trip không mất giá trị/formula cơ bản trên
// file mẫu 3 tab"). Pure Node + ExcelJS, no browser/Univer needed for this leg (see
// docs/decisions/0015-sheet-engine-spike.md for the note on why Univer itself isn't in this
// loop — snapshotToExcelWorkbook/excelWorkbookToSnapshot map to the exact cellData shape
// univerAdapter.js already consumes/produces, verified separately in the browser spike).
//
// Run with: node src/sheet/io/xlsx-roundtrip.test.mjs

import ExcelJS from 'exceljs';
import assert from 'assert';
import { excelWorkbookToSnapshot, snapshotToExcelWorkbook } from './xlsx.js';

async function main() {
  // 1. Build a 3-tab sample workbook by hand (values, a formula, strings, booleans).
  const original = new ExcelJS.Workbook();
  const s1 = original.addWorksheet('Sheet1');
  s1.getCell('A1').value = 42;
  s1.getCell('B1').value = 'hello world';
  s1.getCell('C1').value = true;
  s1.getCell('A2').value = { formula: 'A1+1' };

  const s2 = original.addWorksheet('Sheet2');
  s2.getCell('A1').value = 3.14159;
  s2.getCell('B1').value = { formula: 'SUM(A1,A1)' };

  const s3 = original.addWorksheet('Sheet3');
  s3.getCell('A1').value = 'unicode: tiếng Việt, 日本語';

  // 2. Write to buffer, read it back (round-trips through the actual XLSX binary format).
  const buffer = await original.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);

  // 3. Map into the IWorkbookData-shaped snapshot univerAdapter.js consumes.
  const snapshot = excelWorkbookToSnapshot(reloaded, 'roundtrip-test');
  assert.strictEqual(snapshot.sheetOrder.length, 3, 'expected 3 sheets');
  assert.strictEqual(snapshot.sheets['sheet-1'].cellData[0][0].v, 42);
  assert.strictEqual(snapshot.sheets['sheet-1'].cellData[0][1].v, 'hello world');
  assert.strictEqual(snapshot.sheets['sheet-1'].cellData[0][2].v, true);
  assert.strictEqual(snapshot.sheets['sheet-1'].cellData[1][0].f, '=A1+1');
  assert.strictEqual(snapshot.sheets['sheet-2'].cellData[0][0].v, 3.14159);
  assert.strictEqual(snapshot.sheets['sheet-2'].cellData[0][1].f, '=SUM(A1,A1)');
  assert.strictEqual(snapshot.sheets['sheet-3'].cellData[0][0].v, 'unicode: tiếng Việt, 日本語');
  console.log('PASS — XLSX -> snapshot mapping preserves values/formulas/unicode across 3 tabs');

  // 4. Map back out to a new XLSX workbook, write, reload, verify still intact.
  const exported = snapshotToExcelWorkbook(snapshot);
  const exportedBuffer = await exported.xlsx.writeBuffer();
  const reReloaded = new ExcelJS.Workbook();
  await reReloaded.xlsx.load(exportedBuffer);

  assert.strictEqual(reReloaded.worksheets.length, 3);
  assert.strictEqual(reReloaded.getWorksheet('Sheet1').getCell('A1').value, 42);
  assert.strictEqual(reReloaded.getWorksheet('Sheet1').getCell('A2').formula, 'A1+1');
  assert.strictEqual(reReloaded.getWorksheet('Sheet3').getCell('A1').value, 'unicode: tiếng Việt, 日本語');
  console.log('PASS — snapshot -> XLSX export round-trip (write -> reload) preserves values/formulas/unicode');

  // 5. Phase 2 production additions: minimal style (bold/italic/font color/background) and a
  // merged range.
  const styled = new ExcelJS.Workbook();
  const s4 = styled.addWorksheet('Styled');
  s4.getCell('A1').value = 'Title';
  s4.getCell('A1').font = { bold: true, italic: true, color: { argb: 'FFFF0000' } };
  s4.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
  s4.getCell('B1').value = 'plain';
  s4.mergeCells('C1:D2');
  s4.getCell('C1').value = 'merged';

  const styledBuffer = await styled.xlsx.writeBuffer();
  const styledReloaded = new ExcelJS.Workbook();
  await styledReloaded.xlsx.load(styledBuffer);

  const styledSnapshot = excelWorkbookToSnapshot(styledReloaded, 'styled-test');
  const styledCells = styledSnapshot.sheets['sheet-1'].cellData;
  assert.strictEqual(styledCells[0][0].s.bl, 1, 'bold');
  assert.strictEqual(styledCells[0][0].s.it, 1, 'italic');
  assert.strictEqual(styledCells[0][0].s.cl.rgb, '#FF0000', 'font color');
  assert.strictEqual(styledCells[0][0].s.bg.rgb, '#00FF00', 'background');
  assert.strictEqual(styledCells[0][1].s, undefined, 'plain cell has no style object');
  assert.deepStrictEqual(
    styledSnapshot.sheets['sheet-1'].mergeData,
    [{ startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 }],
    'C1:D2 (0-indexed, inclusive both ends) merge range'
  );
  console.log('PASS — excelWorkbookToSnapshot maps bold/italic/font-color/background + merge range');

  const exportedStyled = snapshotToExcelWorkbook(styledSnapshot);
  const exportedStyledBuffer = await exportedStyled.xlsx.writeBuffer();
  const reReloadedStyled = new ExcelJS.Workbook();
  await reReloadedStyled.xlsx.load(exportedStyledBuffer);
  const outWs = reReloadedStyled.getWorksheet('Styled');
  assert.strictEqual(outWs.getCell('A1').font.bold, true);
  assert.strictEqual(outWs.getCell('A1').font.italic, true);
  assert.strictEqual(outWs.getCell('A1').font.color.argb, 'FFFF0000');
  assert.strictEqual(outWs.getCell('A1').fill.fgColor.argb, 'FF00FF00');
  assert.strictEqual(outWs.getCell('C1').value, 'merged');
  assert.strictEqual(outWs.model.merges.includes('C1:D2'), true, 'merge survives export round-trip');
  console.log('PASS — snapshot -> XLSX export round-trip preserves style + merge');
}

main().catch((err) => {
  console.error('FAIL —', err.message);
  process.exitCode = 1;
});
