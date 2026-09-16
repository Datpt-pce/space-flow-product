// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3). Pure Node, no
// browser needed (parseSheetUrl.js never imports @univerjs/*).
//
// Run with: node src/sheet/google/parseSheetUrl.test.mjs

import assert from 'assert';
import { parseSheetUrl } from './parseSheetUrl.js';

function main() {
  const withGid = parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit?gid=456789#gid=456789');
  assert.deepStrictEqual(withGid, { spreadsheetId: '1AbC-XyZ_123', gid: '456789' });
  console.log('PASS — URL có #gid= trích đúng spreadsheetId + gid');

  const noGid = parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit');
  assert.deepStrictEqual(noGid, { spreadsheetId: '1AbC-XyZ_123', gid: null });
  console.log('PASS — URL không có gid trả gid: null');

  const noEdit = parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-XyZ_123');
  assert.deepStrictEqual(noEdit, { spreadsheetId: '1AbC-XyZ_123', gid: null });
  console.log('PASS — URL không có /edit vẫn parse được id');

  const invalid = parseSheetUrl('https://example.com/not-a-sheet-url');
  assert.strictEqual(invalid, null);
  console.log('PASS — URL không phải Google Sheets trả null');

  console.log('\nAll parseSheetUrl tests passed.');
}

main();
