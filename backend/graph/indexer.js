// Graph Library Phase 1 (specs/space-flow-master-plan/02-graph-library.md): derives
// entities/edges straight from workflows.payload — delete-then-rewrite per workflow, correct
// at this scale (see §2 "Event-driven index" — outbox/CDC would be over-engineering for a
// single-process SQLite app). Graph is a projection, never the source of truth
// (master-plan.md §2.2).

const crypto = require('crypto');
const db = require('../db');
const {
  ENTITY_TYPES,
  RELATIONS,
  workflowEntityId,
  nodeInstanceEntityId,
  nodePackageEntityId,
  userEntityId,
} = require('./entityId');

const upsertEntity = db.prepare(`
  INSERT INTO entities (id, type, label, owner_id, meta)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label,
    owner_id = excluded.owner_id,
    meta = excluded.meta,
    updated_at = datetime('now')
`);

const insertEdge = db.prepare(
  'INSERT INTO edges (id, source_id, target_id, relation, meta) VALUES (?, ?, ?, ?, ?)'
);

// A single reindexWorkflow() call does ~4 statements per node (measured: 30-node workflow took
// ~3.3s with each statement autocommitting separately on this machine — WAL still fsyncs per
// commit unless batched — vs ~37ms wrapped in 1 transaction, an ~89x difference). SAVEPOINT
// instead of BEGIN/COMMIT because this must nest safely: rebuild.js's rebuildAll() and
// reindexQueue.js's processQueue() both call reindexWorkflow() in a loop and want the WHOLE loop
// as 1 outer transaction — nested BEGIN throws in SQLite, nested SAVEPOINT does not.
function withGraphTransaction(fn) {
  const savepoint = `sp_${crypto.randomUUID().replace(/-/g, '')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = fn();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw err;
  }
}

// Workflow payload has 2 historical shapes: current "pages v2" ({ pages: [{nodes,edges}] },
// frontend/src/store.js buildExportPayload()) and legacy flat {nodes,edges}. Read both so old
// saved workflows don't silently index as empty.
function collectNodes(payload) {
  if (Array.isArray(payload?.pages) && payload.pages.length) {
    return payload.pages.flatMap((p) => p.nodes ?? []);
  }
  return payload?.nodes ?? [];
}

function removeWorkflowScope(workflowId) {
  const wfId = workflowEntityId(workflowId);
  const instancePrefix = `node_instance:${workflowId}:`;
  db.prepare('DELETE FROM edges WHERE source_id = ? OR source_id LIKE ?').run(wfId, `${instancePrefix}%`);
  db.prepare(
    "DELETE FROM entities WHERE id = ? OR (type = 'node_instance' AND id LIKE ?)"
  ).run(wfId, `${instancePrefix}%`);
}

// Re-derives every graph entity/edge sourced from 1 workflow. Call after workflow
// INSERT/UPDATE/DELETE (routes/workflows.js) — on DELETE the row is already gone, so this just
// wipes the scope and returns.
function reindexWorkflow(workflowId) {
  withGraphTransaction(() => {
    removeWorkflowScope(workflowId);

    const row = db.prepare(`
      SELECT w.*, u.name AS owner_name FROM workflows w JOIN users u ON u.id = w.owner_id WHERE w.id = ?
    `).get(workflowId);
    if (!row) return;

    const wfId = workflowEntityId(workflowId);
    upsertEntity.run(wfId, ENTITY_TYPES.WORKFLOW, row.name, row.owner_id, JSON.stringify({ visibility: row.visibility }));

    const ownerId = userEntityId(row.owner_id);
    upsertEntity.run(ownerId, ENTITY_TYPES.USER, row.owner_name, row.owner_id, null);
    insertEdge.run(crypto.randomUUID(), wfId, ownerId, RELATIONS.CREATED_BY, null);

    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch (err) {
      console.warn(`[graph/indexer] workflow ${workflowId}: payload không parse được JSON`, err.message);
      return;
    }

    for (const node of collectNodes(payload)) {
      try {
        if (!node?.id || !node?.type) continue;
        const instanceId = nodeInstanceEntityId(workflowId, node.id);
        const packageId = nodePackageEntityId(node.type);
        const label = node.data?.manifest?.name || node.type;
        upsertEntity.run(instanceId, ENTITY_TYPES.NODE_INSTANCE, label, null, JSON.stringify({ nodeType: node.type }));
        upsertEntity.run(packageId, ENTITY_TYPES.NODE_PACKAGE, label, null, null);
        insertEdge.run(crypto.randomUUID(), wfId, instanceId, RELATIONS.CONTAINS, null);
        insertEdge.run(crypto.randomUUID(), instanceId, packageId, RELATIONS.USES, null);
      } catch (err) {
        console.warn(`[graph/indexer] workflow ${workflowId}: bỏ qua node lỗi ${node?.id}`, err.message);
      }
    }
  });
}

module.exports = { reindexWorkflow, removeWorkflowScope, withGraphTransaction };
