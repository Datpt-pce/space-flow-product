// Graph Library Phase 8 (specs/space-flow-master-plan/02-graph-library.md): durability backstop
// for the relationship index — reduces "Graph index lệch source of truth" from Medium to Low
// (master-plan.md §7 risk register). routes/workflows.js keeps calling reindexWorkflow()
// SYNCHRONOUSLY in the request path (measured well under 1ms per call on this dev machine — see
// 02-graph-library.md §0 — no reason to make callers wait on a queue round-trip for something
// this cheap). This module exists purely so a crash BETWEEN the workflow write and that
// synchronous call still leaves a trail: the queue row from enqueueReindex() survives even if the
// process dies before reindexWorkflow() runs, and a periodic sweep (processQueue) or the
// consistency check (checkConsistency/runConsistencyCheck) catches up later.
//
// Deliberately just 1 table + 1 in-process consumer loop (wired into server.js) — no external
// broker (Redis/BullMQ). Space-Flow is 1 Express process on 1 SQLite file; a distributed queue
// would be solving a problem this deployment doesn't have (same reasoning as §2 "Event-driven
// index" in 02-graph-library.md).

const crypto = require('crypto');
const db = require('../db');
const { reindexWorkflow, withGraphTransaction } = require('./indexer');
const { workflowEntityId, parseEntityId } = require('./entityId');

function enqueueReindex(workflowId) {
  db.prepare('INSERT INTO relationship_reindex_queue (id, workflow_id) VALUES (?, ?)')
    .run(crypto.randomUUID(), workflowId);
}

// Drains unprocessed rows oldest-first, deduping by workflow_id within the batch —
// reindexWorkflow() is idempotent delete-then-rewrite, so running it twice for the same id in 1
// sweep would just be wasted work, not incorrect.
function processQueue(batchSize = 50) {
  const rows = db.prepare(
    'SELECT * FROM relationship_reindex_queue WHERE processed_at IS NULL ORDER BY enqueued_at ASC LIMIT ?'
  ).all(batchSize);
  if (!rows.length) return { processed: 0, workflowsReindexed: 0 };

  return withGraphTransaction(() => {
    const seen = new Set();
    for (const row of rows) {
      if (!seen.has(row.workflow_id)) {
        reindexWorkflow(row.workflow_id);
        seen.add(row.workflow_id);
      }
    }
    const ids = rows.map((r) => r.id);
    db.prepare(
      `UPDATE relationship_reindex_queue SET processed_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);
    return { processed: rows.length, workflowsReindexed: seen.size };
  });
}

// Compares workflows (source of truth) against the entities they should have produced. 2 drift
// shapes: (a) a workflow whose entity is missing or older than the workflow's last write — reindex
// never ran, or ran against a since-superseded version; (b) a workflow entity left behind after its
// workflow row was deleted — reindex never ran the DELETE-triggered wipe. Returns the list of
// workflow ids that need a reindex pass (case (b)'s "id" doubles as the scope to wipe, since
// reindexWorkflow() on an already-deleted workflow just removes its scope — see indexer.js).
function checkConsistency() {
  const drifted = new Set();

  const workflows = db.prepare('SELECT id, updated_at FROM workflows').all();
  for (const wf of workflows) {
    const entity = db.prepare('SELECT updated_at FROM entities WHERE id = ?').get(workflowEntityId(wf.id));
    if (!entity || new Date(entity.updated_at) < new Date(wf.updated_at)) {
      drifted.add(wf.id);
    }
  }

  const liveEntityIds = new Set(workflows.map((w) => workflowEntityId(w.id)));
  const workflowEntities = db.prepare("SELECT id FROM entities WHERE type = 'workflow'").all();
  for (const e of workflowEntities) {
    if (!liveEntityIds.has(e.id)) {
      drifted.add(parseEntityId(e.id).localId);
    }
  }

  return [...drifted];
}

function runConsistencyCheck() {
  const drifted = checkConsistency();
  for (const workflowId of drifted) enqueueReindex(workflowId);
  const { workflowsReindexed } = processQueue(Math.max(drifted.length, 1));
  return { driftedFound: drifted.length, workflowsReindexed };
}

const QUEUE_POLL_INTERVAL_MS = 5 * 1000;
const CONSISTENCY_CHECK_INTERVAL_MS = 60 * 1000;

// Wired into server.js like backend/agent/autoUpdate.js's start() — 1 process, 1 in-memory
// interval, no external scheduler.
function start() {
  setInterval(() => {
    try { processQueue(); } catch (err) { console.error('[graph/reindexQueue] processQueue lỗi:', err.message); }
  }, QUEUE_POLL_INTERVAL_MS);

  setInterval(() => {
    try { runConsistencyCheck(); } catch (err) { console.error('[graph/reindexQueue] runConsistencyCheck lỗi:', err.message); }
  }, CONSISTENCY_CHECK_INTERVAL_MS);
}

module.exports = { enqueueReindex, processQueue, checkConsistency, runConsistencyCheck, start };
