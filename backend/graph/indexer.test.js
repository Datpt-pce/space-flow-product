// Graph Library Phase 1 (specs/space-flow-master-plan/02-graph-library.md): proves
// reindexWorkflow() derives the right entities/edges from a real workflow row and that
// delete-then-rewrite keeps shared node_package entities intact across workflows while
// cleaning up a workflow's own scope on update/delete.
//
// Run with: node backend/graph/indexer.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const { reindexWorkflow } = require('./indexer');
const { rebuildAll } = require('./rebuild');
const { workflowEntityId, nodeInstanceEntityId, nodePackageEntityId } = require('./entityId');

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

function makeWorkflow(ownerId, payload, name = 'Test Workflow') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO workflows (id, owner_id, name, visibility, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, ownerId, name, 'private', JSON.stringify(payload));
  return id;
}

const payloadWithNodes = (nodeType) => ({
  version: 2,
  pages: [{
    id: 'page-1',
    name: 'Page 1',
    nodes: [
      { id: 'n1', type: nodeType, position: { x: 0, y: 0 }, data: { manifest: { name: 'Set' } } },
      { id: 'n2', type: nodeType, position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [],
  }],
});

function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `graph-indexer-test-sub-${ownerId}`, `graph-indexer-test-${ownerId}@space-flow.local`, 'Graph Test User', 'member');

  const workflowIds = [];
  try {
    check('reindexWorkflow(): tạo đúng workflow, node_instance, node_package entity + edge', () => {
      const wfId = makeWorkflow(ownerId, payloadWithNodes('set'));
      workflowIds.push(wfId);
      reindexWorkflow(wfId);

      const wfEntity = db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId));
      assert.ok(wfEntity, 'workflow entity phải tồn tại');
      assert.strictEqual(wfEntity.owner_id, ownerId);

      const instance1 = db.prepare('SELECT * FROM entities WHERE id = ?').get(nodeInstanceEntityId(wfId, 'n1'));
      assert.ok(instance1, 'node_instance n1 phải tồn tại');
      assert.strictEqual(instance1.label, 'Set');

      const pkg = db.prepare('SELECT * FROM entities WHERE id = ?').get(nodePackageEntityId('set'));
      assert.ok(pkg, 'node_package "set" phải tồn tại');

      const containsCount = db.prepare(
        "SELECT COUNT(*) c FROM edges WHERE source_id = ? AND relation = 'contains'"
      ).get(workflowEntityId(wfId)).c;
      assert.strictEqual(containsCount, 2, 'phải có 2 edge contains (n1, n2)');

      const usesCount = db.prepare(
        "SELECT COUNT(*) c FROM edges WHERE source_id = ? AND relation = 'uses'"
      ).get(nodeInstanceEntityId(wfId, 'n1')).c;
      assert.strictEqual(usesCount, 1, 'n1 phải có 1 edge uses tới node_package');

      const createdByCount = db.prepare(
        "SELECT COUNT(*) c FROM edges WHERE source_id = ? AND relation = 'created_by'"
      ).get(workflowEntityId(wfId)).c;
      assert.strictEqual(createdByCount, 1);
    });

    check('reindexWorkflow(): reindex sau update xoá đúng node cũ, không đụng node_package dùng chung', () => {
      const wfIdA = makeWorkflow(ownerId, payloadWithNodes('set'));
      workflowIds.push(wfIdA);
      reindexWorkflow(wfIdA);
      const wfIdB = makeWorkflow(ownerId, payloadWithNodes('set'));
      workflowIds.push(wfIdB);
      reindexWorkflow(wfIdB);

      // A sửa còn 1 node — reindex lại A không được xoá node_package "set" (B vẫn dùng).
      db.prepare("UPDATE workflows SET payload = ? WHERE id = ?").run(
        JSON.stringify({ version: 2, pages: [{ id: 'page-1', name: 'Page 1', nodes: [{ id: 'n1', type: 'set', position: { x: 0, y: 0 }, data: {} }], edges: [] }] }),
        wfIdA
      );
      reindexWorkflow(wfIdA);

      assert.strictEqual(
        db.prepare('SELECT * FROM entities WHERE id = ?').get(nodeInstanceEntityId(wfIdA, 'n2')),
        undefined,
        'n2 phải bị xoá khỏi scope A sau reindex'
      );
      assert.ok(
        db.prepare('SELECT * FROM entities WHERE id = ?').get(nodePackageEntityId('set')),
        'node_package "set" phải vẫn còn vì B vẫn tham chiếu'
      );
      const containsCountB = db.prepare(
        "SELECT COUNT(*) c FROM edges WHERE source_id = ? AND relation = 'contains'"
      ).get(workflowEntityId(wfIdB)).c;
      assert.strictEqual(containsCountB, 2, 'scope B không bị ảnh hưởng bởi reindex A');
    });

    check('reindexWorkflow(): gọi sau khi workflow đã bị xoá thì wipe sạch scope, không throw', () => {
      const wfId = makeWorkflow(ownerId, payloadWithNodes('set'));
      workflowIds.push(wfId);
      reindexWorkflow(wfId);
      db.prepare('DELETE FROM workflows WHERE id = ?').run(wfId);

      reindexWorkflow(wfId);

      assert.strictEqual(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)), undefined);
      assert.strictEqual(db.prepare('SELECT * FROM entities WHERE id = ?').get(nodeInstanceEntityId(wfId, 'n1')), undefined);
    });

    check('reindexWorkflow(): node thiếu id/type bị bỏ qua thay vì làm fail toàn bộ reindex', () => {
      const wfId = makeWorkflow(ownerId, {
        version: 2,
        pages: [{ id: 'page-1', name: 'Page 1', nodes: [{ id: 'n1', type: 'set', data: {} }, { id: 'broken' }], edges: [] }],
      });
      workflowIds.push(wfId);
      reindexWorkflow(wfId);

      assert.ok(db.prepare('SELECT * FROM entities WHERE id = ?').get(nodeInstanceEntityId(wfId, 'n1')));
      const total = db.prepare(
        "SELECT COUNT(*) c FROM entities WHERE type = 'node_instance' AND id LIKE ?"
      ).get(`node_instance:${wfId}:%`).c;
      assert.strictEqual(total, 1, 'node "broken" (thiếu type) không được index');
    });

    check('rebuildAll(): idempotent, chạy 2 lần liên tiếp cho kết quả giống nhau', () => {
      const wfId = makeWorkflow(ownerId, payloadWithNodes('set'));
      workflowIds.push(wfId);
      reindexWorkflow(wfId);

      const r1 = rebuildAll();
      const countAfter1 = db.prepare("SELECT COUNT(*) c FROM entities WHERE type = 'workflow'").get().c;
      const r2 = rebuildAll();
      const countAfter2 = db.prepare("SELECT COUNT(*) c FROM entities WHERE type = 'workflow'").get().c;

      assert.strictEqual(r1.workflowsIndexed, r2.workflowsIndexed);
      assert.strictEqual(countAfter1, countAfter2);
      assert.ok(db.prepare('SELECT * FROM entities WHERE id = ?').get(workflowEntityId(wfId)));
    });

    check('reindexWorkflow(): chạy trong 1 transaction (SAVEPOINT), không phải 1 commit/statement — 30 node phải xong dưới 500ms', () => {
      // Bug thật tìm thấy khi code Phase 8: trước khi bọc withGraphTransaction(), mỗi statement
      // (~4 statement/node) tự commit riêng — 30 node đo được ~3.3s/lần gọi trên máy này (SQLite
      // WAL vẫn fsync mỗi commit). Ngưỡng 500ms ở đây rộng rãi so với ~30ms đo thật, chỉ để bắt
      // hồi quy nếu ai đó vô tình bỏ transaction wrapper sau này, không phải benchmark chính xác.
      const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, type: 'set', position: { x: 0, y: 0 }, data: {} }));
      const wfId = makeWorkflow(ownerId, { version: 2, pages: [{ id: 'page-1', name: 'Page 1', nodes, edges: [] }] });
      workflowIds.push(wfId);

      const start = process.hrtime.bigint();
      reindexWorkflow(wfId);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(elapsedMs < 500, `reindexWorkflow(30 node) mất ${elapsedMs.toFixed(1)}ms — nghi ngờ mất transaction wrapper`);

      const count = db.prepare(
        "SELECT COUNT(*) c FROM entities WHERE type = 'node_instance' AND id LIKE ?"
      ).get(`node_instance:${wfId}:%`).c;
      assert.strictEqual(count, 30);
    });
  } finally {
    for (const id of workflowIds) {
      db.prepare('DELETE FROM edges WHERE source_id LIKE ? OR source_id = ?').run(`node_instance:${id}:%`, workflowEntityId(id));
      db.prepare('DELETE FROM entities WHERE id = ? OR id LIKE ?').run(workflowEntityId(id), `node_instance:${id}:%`);
      db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    }
    db.prepare("DELETE FROM edges WHERE relation = 'created_by' AND target_id = ?").run(`user:${ownerId}`);
    db.prepare('DELETE FROM entities WHERE id = ?').run(`user:${ownerId}`);
    db.prepare('DELETE FROM entities WHERE id = ?').run(nodePackageEntityId('set'));
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
