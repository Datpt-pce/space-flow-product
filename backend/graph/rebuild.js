// Graph Library Phase 1 (specs/space-flow-master-plan/02-graph-library.md): full re-derive of
// the workflow-sourced slice of the graph index. Used by the future consistency-check/rebuild
// command (Phase 8) and as a backfill for workflows that existed before the indexer did.

const db = require('../db');
const { reindexWorkflow, withGraphTransaction } = require('./indexer');

function rebuildAll() {
  // 1 outer transaction for the whole sweep — each reindexWorkflow() call below opens its own
  // nested SAVEPOINT, but only this outer one actually commits to disk (see indexer.js's
  // withGraphTransaction comment: unbatched, this was ~89x slower on a real 30-node workflow).
  return withGraphTransaction(() => {
    db.exec("DELETE FROM edges WHERE source_id LIKE 'workflow:%' OR source_id LIKE 'node_instance:%'");
    db.exec("DELETE FROM entities WHERE type IN ('workflow', 'node_instance')");

    const ids = db.prepare('SELECT id FROM workflows').all().map((r) => r.id);
    for (const id of ids) reindexWorkflow(id);
    return { workflowsIndexed: ids.length };
  });
}

module.exports = { rebuildAll };
