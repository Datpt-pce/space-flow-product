// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #8): proves the
// pure A1 parse/format + structural-edit shift math backend/routes/sheets.js's bindings rebase
// endpoint depends on — this is the "test riêng" the phase's acceptance criteria calls for
// (insert/delete row/col between 2 runs must not silently read the wrong range).
//
// Run with: node backend/sheet/rangeA1.test.js

const assert = require('assert');
const { colToLetter, letterToCol, parseA1, toA1, shiftRange } = require('./rangeA1');

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

check('colToLetter/letterToCol round-trip qua ranh giới AA', () => {
  assert.strictEqual(colToLetter(0), 'A');
  assert.strictEqual(colToLetter(25), 'Z');
  assert.strictEqual(colToLetter(26), 'AA');
  assert.strictEqual(letterToCol('A'), 0);
  assert.strictEqual(letterToCol('Z'), 25);
  assert.strictEqual(letterToCol('AA'), 26);
});

check('parseA1/toA1 round-trip cho range và single cell', () => {
  assert.deepStrictEqual(parseA1('A1:D20'), { startRow: 0, endRow: 19, startCol: 0, endCol: 3 });
  assert.strictEqual(toA1(parseA1('A1:D20')), 'A1:D20');
  assert.deepStrictEqual(parseA1('B2'), { startRow: 1, endRow: 1, startCol: 1, endCol: 1 });
  assert.strictEqual(toA1(parseA1('B2')), 'B2');
});

check('insert row TRƯỚC range → toàn bộ range dịch xuống, không đọc sai vùng cũ', () => {
  const range = parseA1('A10:D20'); // rows 9..19 (0-indexed)
  const shifted = shiftRange(range, { kind: 'row', op: 'insert', index: 2, count: 3 });
  assert.strictEqual(toA1(shifted), 'A13:D23');
});

check('insert row SAU range → range không đổi', () => {
  const range = parseA1('A1:D10');
  const shifted = shiftRange(range, { kind: 'row', op: 'insert', index: 50, count: 3 });
  assert.strictEqual(toA1(shifted), 'A1:D10');
});

check('insert row GIỮA range → range mở rộng để chứa hàng mới', () => {
  const range = parseA1('A1:D20'); // rows 0..19
  const shifted = shiftRange(range, { kind: 'row', op: 'insert', index: 10, count: 2 });
  assert.strictEqual(toA1(shifted), 'A1:D22');
});

check('delete row TRƯỚC range → range dịch lên đúng số hàng bị xoá', () => {
  const range = parseA1('A10:D20'); // rows 9..19
  const shifted = shiftRange(range, { kind: 'row', op: 'delete', index: 0, count: 5 });
  assert.strictEqual(toA1(shifted), 'A5:D15');
});

check('delete row NẰM TRỌN trong range → range bị tiêu thụ hoàn toàn, trả null', () => {
  const range = parseA1('A10:D20'); // rows 9..19
  const shifted = shiftRange(range, { kind: 'row', op: 'delete', index: 5, count: 20 });
  assert.strictEqual(shifted, null);
});

check('delete row cắt NGANG đầu range → range co lại từ đúng điểm xoá', () => {
  const range = parseA1('A10:D20'); // rows 9..19
  const shifted = shiftRange(range, { kind: 'row', op: 'delete', index: 5, count: 6 }); // xoá rows 5..10
  // row 9 (A10) nằm trong khối xoá 5..10 -> co về row 5 (A6); row 19 (D20) sau khối xoá -> 19-6=13 (D14)
  assert.strictEqual(toA1(shifted), 'A6:D14');
});

check('insert/delete col hoạt động đối xứng với row', () => {
  const range = parseA1('C1:F10'); // cols 2..5
  const insertedBefore = shiftRange(range, { kind: 'col', op: 'insert', index: 0, count: 2 });
  assert.strictEqual(toA1(insertedBefore), 'E1:H10');
  const deletedFullRange = shiftRange(range, { kind: 'col', op: 'delete', index: 0, count: 10 });
  assert.strictEqual(deletedFullRange, null);
});

check('scenario acceptance criteria Phase 5: chèn 3 hàng phía trên rồi đọc lại đúng vùng dữ liệu cũ', () => {
  // Binding gốc trỏ A2:C5 (data, có 1 header row phía trên tại row 1). User chèn 3 hàng ngay
  // trên cùng (index 0). Nếu KHÔNG rebase, lần chạy sau vẫn đọc "A2:C5" sẽ trúng 3 hàng trống
  // mới chèn + 1 hàng data cũ — sai. Sau rebase, range phải trỏ đúng "A5:C8".
  const original = parseA1('A2:C5');
  const rebased = shiftRange(original, { kind: 'row', op: 'insert', index: 0, count: 3 });
  assert.strictEqual(toA1(rebased), 'A5:C8');
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
