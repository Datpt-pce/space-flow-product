// Sheet Phase 3: proves the Google values[][] -> IWorkbookData tab mapping (backend/sheet/
// googleImport.js) — ragged rows, empty-cell skipping, tab-id collision handling.
//
// Run with: node backend/sheet/googleImport.test.js

const assert = require('assert');
const { valuesToSheetTab, addTabToWorkbook } = require('./googleImport');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

check('valuesToSheetTab: hàng ragged, ô rỗng bị bỏ qua, giữ nguyên kiểu number/string/boolean', () => {
  const tab = valuesToSheetTab([
    ['Name', 'Score', 'Active'],
    ['Alice', 95, true],
    ['Bob'],
  ], 'sheet-imported', 'Imported');
  assert.strictEqual(tab.rowCount, 3);
  assert.strictEqual(tab.columnCount, 3);
  assert.deepStrictEqual(tab.cellData[0], { 0: { v: 'Name' }, 1: { v: 'Score' }, 2: { v: 'Active' } });
  assert.deepStrictEqual(tab.cellData[1], { 0: { v: 'Alice' }, 1: { v: 95 }, 2: { v: true } });
  assert.deepStrictEqual(tab.cellData[2], { 0: { v: 'Bob' } });
});

check('addTabToWorkbook: thêm tab mới không đổi tab cũ, id không đụng nhau', () => {
  const workbook = { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { id: 'sheet-1', name: 'Sheet1', cellData: {} } } };
  const next = addTabToWorkbook(workbook, [['a', 'b']], 'Imported Data');
  assert.strictEqual(next.sheetOrder.length, 2);
  assert.ok(next.sheets['sheet-1']); // tab cũ còn nguyên
  assert.strictEqual(workbook.sheetOrder.length, 1); // không mutate input

  const tabId = next.sheetOrder[1];
  assert.strictEqual(tabId, 'sheet-imported-data');
  assert.strictEqual(next.sheets[tabId].name, 'Imported Data');
});

check('addTabToWorkbook: import 2 lần cùng tên -> id lần 2 không trùng lần 1', () => {
  let workbook = { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': {} } };
  workbook = addTabToWorkbook(workbook, [['x']], 'Data');
  workbook = addTabToWorkbook(workbook, [['y']], 'Data');
  assert.strictEqual(workbook.sheetOrder.length, 3);
  assert.notStrictEqual(workbook.sheetOrder[1], workbook.sheetOrder[2]);
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
