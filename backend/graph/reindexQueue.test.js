// Graph Library Phase 8 (specs/space-flow-master-plan/02-graph-library.md): proves the crash-
// recovery property the phase's acceptance criteria actually asks for — "mutation ngẫu nhiên (kể
// cả crash giữa chừng mô phỏng) → sau khi consumer chạy lại, consistency check trả 0 lệch". A
// "crash between the workflow write and the synchronous reindex call" is simulated by writing
// directly to the workflows table via raw SQL (bypassing routes/workflows.js entirely, so
// reindexWorkflow() never runs) — exactly the shape of gap this module exists to catch.
//
// Run with: node backend/graph/reindexQueue.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const { enqueueReindex, processQueue, checkConsistency, runConsistencyCheck } = require('./reindexQueue');
const { workflowEntityId, nodeInstanceEntityId } = require('./entityId');

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

function insertWorkflowDirect(ownerId, payload, name = 'Queue Test Workflow') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO workflows (id, owner_id, name, visibility, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, name, 'private', JSON.stringify(payload));
  return id; // deliberately no reindexWorkflow(id) call — simulates the crash window
}

const payloadWithNode = () => ({
  version: 2,
  pages: [{ id: 'page-1', name: 'Page 1', nodes: [{ id: 'n1', type: 'set', position: { x: 0, y: 0 }, data: {} }], edges: [] }],
});

function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `reindex-queue-test-sub-${ownerId}`, `reindex-queue-test-${ownerId}@space-flow.local`, 'Reindex Queue Test User', 'member');

  const workflowIds = [];
  try {
    check('checkConsistency(): phát hiện workflow "crash trước reindex" (entity thiếu hẳn)', () => {
      const wfId = insertWorkflowDirect(ownerId, payloadWithNode());
      workflowIds.push(wfId);

      assert.strictEqual(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)), undefined);
      const drifted = checkConsistency();
      assert.ok(drifted.includes(wfId), 'workflow chưa từng reindex phải bị coi là drift');
    });

    check('processQueue(): enqueue thủ công rồi xử lý -> entity/edge xuất hiện đúng, đánh dấu processed_at', () => {
      const wfId = insertWorkflowDirect(ownerId, payloadWithNode());
      workflowIds.push(wfId);

      enqueueReindex(wfId);
      const before = db.prepare(
        "SELECT COUNT(*) c FROM relationship_reindex_queue WHERE workflow_id = ? AND processed_at IS NULL"
      ).get(wfId).c;
      assert.strictEqual(before, 1);

      const result = processQueue();
      assert.strictEqual(result.workflowsReindexed, 1);

      assert.ok(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)));
      assert.ok(db.prepare('SELECT * FROM entities WHERE id = ?').get(nodeInstanceEntityId(wfId, 'n1')));

      const after = db.prepare(
        "SELECT COUNT(*) c FROM relationship_reindex_queue WHERE workflow_id = ? AND processed_at IS NULL"
      ).get(wfId).c;
      assert.strictEqual(after, 0, 'row phải được đánh dấu processed_at sau khi xử lý');
    });

    check('processQueue(): nhiều row cùng workflow_id trong 1 batch chỉ reindex 1 lần (dedupe)', () => {
      const wfId = insertWorkflowDirect(ownerId, payloadWithNode());
      workflowIds.push(wfId);
      enqueueReindex(wfId);
      enqueueReindex(wfId);
      enqueueReindex(wfId);

      const result = processQueue();
      assert.strictEqual(result.processed, 3);
      assert.strictEqual(result.workflowsReindexed, 1);
    });

    check('runConsistencyCheck(): "crash mô phỏng" rồi chạy lại -> 0 lệch (đúng acceptance criteria gốc)', () => {
      const wfId = insertWorkflowDirect(ownerId, payloadWithNode());
      workflowIds.push(wfId);

      assert.ok(checkConsistency().includes(wfId));
      const result = runConsistencyCheck();
      assert.ok(result.driftedFound >= 1);
      assert.strictEqual(checkConsistency().includes(wfId), false, 'sau khi consumer chạy lại, consistency check phải hết lệch');
    });

    check('checkConsistency(): entity workflow còn sót sau khi workflow đã bị xoá thẳng (crash trước reindex DELETE) cũng bị phát hiện', () => {
      const wfId = insertWorkflowDirect(ownerId, payloadWithNode());
      workflowIds.push(wfId);
      processQueue(); // index nó trước (giả lập đã tồn tại bình thường)
      enqueueReindex(wfId);
      processQueue();
      assert.ok(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)));

      db.prepare('DELETE FROM workflows WHERE id = ?').run(wfId); // "crash" — bỏ qua reindexWorkflow() lẽ ra phải gọi

      const drifted = checkConsistency();
      assert.ok(drifted.includes(wfId), 'entity mồ côi sau khi workflow bị xoá thẳng phải bị phát hiện');

      runConsistencyCheck();
      assert.strictEqual(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)), undefined, 'reindex lại phải wipe sạch entity mồ côi');
    });
  } finally {
    for (const id of workflowIds) {
      db.prepare('DELETE FROM edges WHERE source_id LIKE ? OR source_id = ?').run(`node_instance:${id}:%`, workflowEntityId(id));
      db.prepare('DELETE FROM entities WHERE id = ? OR id LIKE ?').run(workflowEntityId(id), `node_instance:${id}:%`);
      db.prepare('DELETE FROM relationship_reindex_queue WHERE workflow_id = ?').run(id);
      db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    }
    db.prepare("DELETE FROM edges WHERE relation = 'created_by' AND target_id = ?").run(`user:${ownerId}`);
    db.prepare('DELETE FROM entities WHERE id = ?').run(`user:${ownerId}`);
    db.prepare('DELETE FROM entities WHERE id = ?').run('node_package:set');
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
