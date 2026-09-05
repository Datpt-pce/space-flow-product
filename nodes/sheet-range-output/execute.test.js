// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 5 acceptance criteria):
// "ghi kết quả ngược range khác". Same real-dev-DB convention as
// nodes/sheet-range-input/execute.test.js.
//
// Run with: node nodes/sheet-range-output/execute.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../../backend/db');
const execute = require('./execute');

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function makeUser() {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, `sheet-output-test-${id}`, `sheet-output-test-${id}@space-flow.local`, 'Test', 'member');
  return id;
}

function makeSheet(ownerId) {
  const id = crypto.randomUUID();
  const workbook = { sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { id: 'sheet-1', cellData: {} } } };
  const snapshot = JSON.stringify({ schemaVersion: 1, engine: 'univer', engineVersion: '0.25.1', workbook });
  db.prepare('INSERT INTO sheets (id, owner_id, name, visibility, snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, 'Test Sheet', 'private', snapshot);
  return id;
}

const cleanupUserIds = [];
const cleanupSheetIds = [];

async function run() {
  const owner = makeUser();
  cleanupUserIds.push(owner);
  const sheetId = makeSheet(owner);
  cleanupSheetIds.push(sheetId);

  await check('ghi items vào anchor -> header + hàng đúng vị trí, cập nhật snapshot + tạo revision', async () => {
    const items = [{ json: { name: 'Alice', score: 95 } }, { json: { name: 'Bob', score: 80 } }];
    const result = await execute({ items }, { sheetId, tabId: 'sheet-1', anchorA1: 'B2', includeHeaderRow: true }, { userId: owner, nodeId: 'node-out' });
    assert.strictEqual(result.written_count, 2);
    assert.strictEqual(result.range_a1, 'B2:C4');

    const row = db.prepare('SELECT snapshot FROM sheets WHERE id = ?').get(sheetId);
    const cellData = JSON.parse(row.snapshot).workbook.sheets['sheet-1'].cellData;
    assert.strictEqual(cellData[1][1].v, 'name');   // B2 (row 1, col 1, 0-indexed)
    assert.strictEqual(cellData[1][2].v, 'score');  // C2
    assert.strictEqual(cellData[2][1].v, 'Alice');  // B3
    assert.strictEqual(cellData[3][1].v, 'Bob');    // B4

    const revisionCount = db.prepare('SELECT COUNT(*) c FROM sheet_revisions WHERE sheet_id = ?').get(sheetId).c;
    assert.strictEqual(revisionCount, 1);
  });

  await check('items rỗng -> không ghi gì, written_count=0', async () => {
    const result = await execute({ items: [] }, { sheetId, tabId: 'sheet-1', anchorA1: 'A1', includeHeaderRow: true }, { userId: owner, nodeId: 'node-out' });
    assert.strictEqual(result.written_count, 0);
    const revisionCount = db.prepare('SELECT COUNT(*) c FROM sheet_revisions WHERE sheet_id = ?').get(sheetId).c;
    assert.strictEqual(revisionCount, 1, 'không thêm revision mới khi không ghi gì');
  });

  await check('không phải owner -> throw, không ghi lén vào sheet của người khác', async () => {
    const stranger = makeUser();
    cleanupUserIds.push(stranger);
    const items = [{ json: { x: 1 } }];
    await assert.rejects(
      () => execute({ items }, { sheetId, tabId: 'sheet-1', anchorA1: 'A1', includeHeaderRow: false }, { userId: stranger, nodeId: 'node-out' }),
      /chủ sở hữu/
    );
  });

  for (const id of cleanupSheetIds) db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
  for (const id of cleanupUserIds) db.prepare('DELETE FROM users WHERE id = ?').run(id);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
