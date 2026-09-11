// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 5): shared by
// nodes/sheet-range-input/execute.js and nodes/sheet-range-output/execute.js — both need the
// same "load a sheet document a node is allowed to touch" check (mirrors backend/routes/
// sheets.js's GET/PUT ownership+visibility rules, since a workflow node acting on a sheet should
// never see/write more than the owning user could through the UI) and the same "materialize this
// binding" write (§3 phản biện #4: Flow reads bindings through this table, not the snapshot
// blob — a node execution is exactly the moment a binding becomes real, so this is where it gets
// created/kept in sync).

const crypto = require('crypto');
const db = require('../db');

// loadSheetForNode(sheetId, userId, { write }) -> row (throws a clear Error otherwise, matching
// how other node executors report bad config — see nodes/http-request/execute.js's style).
// write=true requires ownership (matches PUT/:id); write=false allows read for private-if-owner
// or any team-visibility sheet (matches GET /:id).
function loadSheetForNode(sheetId, userId, { write = false } = {}) {
  if (!sheetId) throw new Error('Thiếu config.sheetId');
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(sheetId);
  if (!row) throw new Error(`Không tìm thấy sheet "${sheetId}"`);
  if (write) {
    if (row.owner_id !== userId) throw new Error('Chỉ chủ sở hữu mới ghi được vào sheet này');
  } else if (row.visibility === 'private' && row.owner_id !== userId) {
    throw new Error('Sheet này là riêng tư của người khác');
  }
  return row;
}

function getTab(workbook, tabId) {
  const tab = workbook.sheets?.[tabId];
  if (!tab) throw new Error(`Không tìm thấy tab "${tabId}" trong sheet`);
  return tab;
}

// upsertBinding: idempotent by (sheet_id, tab_id, range_a1, direction, workflow_node_id) — a
// node re-run (or a workflow with this node re-executed) shouldn't accumulate duplicate rows.
function upsertBinding(sheetId, tabId, rangeA1, direction, workflowNodeId) {
  const existing = db.prepare(`
    SELECT id FROM sheet_port_bindings
    WHERE sheet_id = ? AND tab_id = ? AND range_a1 = ? AND direction = ? AND workflow_node_id = ?
  `).get(sheetId, tabId, rangeA1, direction, workflowNodeId);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sheet_port_bindings (id, sheet_id, tab_id, range_a1, direction, workflow_node_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sheetId, tabId, rangeA1, direction, workflowNodeId);
  return id;
}

module.exports = { loadSheetForNode, getTab, upsertBinding };
