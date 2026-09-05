// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 5 acceptance criteria):
// "workflow demo đọc range làm input batch". Runs against the real dev DB (same convention as
// backend/graph/indexer.test.js) — creates its own user+sheet row, cleans up after itself.
//
// Run with: node nodes/sheet-range-input/execute.test.js

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
    .run(id, `sheet-input-test-${id}`, `sheet-input-test-${id}@space-flow.local`, 'Test', 'member');
  return id;
}

function makeSheet(ownerId, visibility, workbook) {
  const id = crypto.randomUUID();
  const snapshot = JSON.stringify({ schemaVersion: 1, engine: 'univer', engineVersion: '0.25.1', workbook });
  db.prepare('INSERT INTO sheets (id, owner_id, name, visibility, snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, 'Test Sheet', visibility, snapshot);
  return id;
}

const cleanupUserIds = [];
const cleanupSheetIds = [];

async function run() {
  const owner = makeUser();
  cleanupUserIds.push(owner);

  const workbook = {
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        cellData: {
          0: { 0: { v: 'name' }, 1: { v: 'score' } },
          1: { 0: { v: 'Alice' }, 1: { v: 95 } },
          2: { 0: { v: 'Bob' }, 1: { v: 80 } },
        },
      },
    },
  };
  const sheetId = makeSheet(owner, 'private', workbook);
  cleanupSheetIds.push(sheetId);

  await check('đọc range có header -> mỗi hàng thành 1 item với key theo header', async () => {
    const result = await execute({}, { sheetId, tabId: 'sheet-1', rangeA1: 'A1:B3', hasHeaderRow: true }, { userId: owner, nodeId: 'node-1' });
    assert.strictEqual(result.row_count, 2);
    assert.deepStrictEqual(result.items[0].json, { name: 'Alice', score: 95 });
    assert.deepStrictEqual(result.items[1].json, { name: 'Bob', score: 80 });
  });

  await check('đọc range KHÔNG header -> key theo chữ cái cột', async () => {
    const result = await execute({}, { sheetId, tabId: 'sheet-1', rangeA1: 'A1:B3', hasHeaderRow: false }, { userId: owner, nodeId: 'node-1' });
    assert.strictEqual(result.row_count, 3);
    assert.deepStrictEqual(result.items[0].json, { A: 'name', B: 'score' });
  });

  await check('ghi 1 sheet_port_binding direction=input sau khi chạy, không tạo trùng lần 2', async () => {
    await execute({}, { sheetId, tabId: 'sheet-1', rangeA1: 'A1:B3', hasHeaderRow: true }, { userId: owner, nodeId: 'node-audit' });
    await execute({}, { sheetId, tabId: 'sheet-1', rangeA1: 'A1:B3', hasHeaderRow: true }, { userId: owner, nodeId: 'node-audit' });
    const count = db.prepare(
      'SELECT COUNT(*) c FROM sheet_port_bindings WHERE sheet_id = ? AND workflow_node_id = ?'
    ).get(sheetId, 'node-audit').c;
    assert.strictEqual(count, 1);
  });

  await check('sheet private của người khác -> throw, không đọc lén', async () => {
    const stranger = makeUser();
    cleanupUserIds.push(stranger);
    await assert.rejects(
      () => execute({}, { sheetId, tabId: 'sheet-1', rangeA1: 'A1:B3', hasHeaderRow: true }, { userId: stranger, nodeId: 'node-1' }),
      /riêng tư/
    );
  });

  for (const id of cleanupSheetIds) db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
  for (const id of cleanupUserIds) db.prepare('DELETE FROM users WHERE id = ?').run(id);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
