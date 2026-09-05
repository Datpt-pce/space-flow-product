// Graph Library Phase 2 (specs/space-flow-master-plan/02-graph-library.md): expose the
// relationship index over REST — "module khác không đọc thẳng DB nội bộ" (master-plan.md §2.2).
// Workflow visibility (private/team) is enforced here from entities.meta/owner_id (populated by
// backend/graph/indexer.js) — never by reading backend/db workflows rows directly, so this stays
// a pure projection consumer like every other module would be.

const express = require('express');
const db = require('../db');
const { rebuildAll } = require('../graph/rebuild');
const { ENTITY_TYPES, workflowEntityId, parseEntityId } = require('../graph/entityId');

const router = express.Router();

// Hard cap on recursive-CTE row explosion for a pathological cyclic subgraph (risk noted in
// 02-graph-library.md §4 Phase 2) — depth is already bounded to 1-3, this is a 2nd backstop.
const MAX_LOCAL_GRAPH_ROWS = 2000;
const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGE_LIMIT = 1000;
// How many extra rowid batches we'll scan looking for `limit` visible rows before giving up and
// returning a short page — bounds worst case for a workspace that's almost entirely private.
const MAX_SCAN_BATCHES = 10;

function toApiEntity(row, degree) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    ownerId: row.owner_id,
    meta: row.meta ? JSON.parse(row.meta) : null,
    degree,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Every workflow entity the caller is allowed to see (own, any visibility, or team-shared) —
// same rule as routes/workflows.js's list query, sourced from the graph index instead of the
// workflows table directly.
function visibleWorkflowIds(userId) {
  const rows = db.prepare("SELECT id, owner_id, meta FROM entities WHERE type = 'workflow'").all();
  const visible = new Set();
  for (const r of rows) {
    if (r.owner_id === userId) { visible.add(r.id); continue; }
    try {
      if (JSON.parse(r.meta || '{}').visibility === 'team') visible.add(r.id);
    } catch { /* malformed meta — treat as not team-visible */ }
  }
  return visible;
}

// node_package/user entities carry no privacy of their own; workflow/node_instance entities
// belong to exactly 1 workflow (node_instance ids embed it: node_instance:<workflowId>:<nodeId>).
function containerWorkflowId(entity) {
  if (entity.type === ENTITY_TYPES.WORKFLOW) return entity.id;
  if (entity.type === ENTITY_TYPES.NODE_INSTANCE) {
    const { localId } = parseEntityId(entity.id);
    return workflowEntityId(localId.slice(0, localId.indexOf(':')));
  }
  return null;
}

function isVisible(entity, visibleIds) {
  const wfId = containerWorkflowId(entity);
  return wfId === null || visibleIds.has(wfId);
}

function degreeOf(id) {
  return db.prepare('SELECT COUNT(*) c FROM edges WHERE source_id = ? OR target_id = ?').get(id, id).c;
}

// Global graph — paginated, permission-filtered.
router.get('/', (req, res) => {
  const { type, owner } = req.query;
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_LIMIT));
  const afterRowid = req.query.cursor ? parseInt(req.query.cursor, 10) : 0;
  const ownerId = owner === 'me' ? req.user.id : owner;

  const visibleIds = visibleWorkflowIds(req.user.id);
  const result = [];
  let lastScannedRowid = afterRowid;
  const batchSize = Math.max(limit, DEFAULT_PAGE_LIMIT);

  for (let batch = 0; batch < MAX_SCAN_BATCHES && result.length < limit; batch++) {
    const conditions = ['e.rowid > ?'];
    const params = [lastScannedRowid];
    if (type) { conditions.push('e.type = ?'); params.push(type); }
    if (ownerId) { conditions.push('e.owner_id = ?'); params.push(ownerId); }
    params.push(batchSize);

    const rows = db.prepare(`
      SELECT e.*, e.rowid AS _rowid FROM entities e WHERE ${conditions.join(' AND ')}
      ORDER BY e.rowid ASC LIMIT ?
    `).all(...params);
    if (!rows.length) break;

    lastScannedRowid = rows[rows.length - 1]._rowid;
    for (const row of rows) {
      if (result.length >= limit) break;
      if (isVisible(row, visibleIds)) result.push(row);
    }
    if (rows.length < batchSize) break; // reached the end of the table
  }

  // Global Graph (Phase 6) needs edges to actually draw anything — only among entities in THIS
  // page (an edge to an entity outside the page would dangle with nothing to render at the other
  // end); both endpoints are already permission-checked by construction (each is in `result`).
  const idPlaceholders = result.map(() => '?').join(',');
  const resultIds = result.map((r) => r.id);
  const edgeRows = resultIds.length
    ? db.prepare(
        `SELECT * FROM edges WHERE source_id IN (${idPlaceholders}) AND target_id IN (${idPlaceholders})`
      ).all(...resultIds, ...resultIds)
    : [];

  res.json({
    entities: result.map((r) => toApiEntity(r, degreeOf(r.id))),
    edges: edgeRows.map((e) => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, relation: e.relation })),
    nextCursor: result.length === limit ? String(lastScannedRowid) : null,
  });
});

// Local graph — BFS to `depth` hops (undirected: neighbors via either edge direction).
router.get('/local/:entityId', (req, res) => {
  const { entityId } = req.params;
  const depth = Math.min(3, Math.max(1, parseInt(req.query.depth, 10) || 1));

  const root = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
  if (!root) return res.status(404).json({ error: 'Không tìm thấy entity' });
  const visibleIds = visibleWorkflowIds(req.user.id);
  if (!isVisible(root, visibleIds)) return res.status(403).json({ error: 'Không có quyền xem entity này' });

  const bfsRows = db.prepare(`
    WITH RECURSIVE bfs(id, depth) AS (
      SELECT ?, 0
      UNION
      SELECT CASE WHEN e.source_id = bfs.id THEN e.target_id ELSE e.source_id END, bfs.depth + 1
      FROM edges e JOIN bfs ON (e.source_id = bfs.id OR e.target_id = bfs.id)
      WHERE bfs.depth < ?
    )
    SELECT id, MIN(depth) AS depth FROM bfs GROUP BY id LIMIT ?
  `).all(entityId, depth, MAX_LOCAL_GRAPH_ROWS);

  const depthById = new Map(bfsRows.map((r) => [r.id, r.depth]));
  const entityRows = bfsRows.map((r) => db.prepare('SELECT * FROM entities WHERE id = ?').get(r.id)).filter(Boolean);
  const visibleEntities = entityRows.filter((e) => isVisible(e, visibleIds));
  const visibleEntityIds = new Set(visibleEntities.map((e) => e.id));

  const placeholders = [...visibleEntityIds].map(() => '?').join(',');
  const edgeRows = visibleEntityIds.size
    ? db.prepare(
        `SELECT * FROM edges WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`
      ).all(...visibleEntityIds, ...visibleEntityIds)
    : [];

  res.json({
    entities: visibleEntities.map((e) => ({ ...toApiEntity(e, degreeOf(e.id)), depth: depthById.get(e.id) })),
    edges: edgeRows.map((e) => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, relation: e.relation })),
  });
});

// Backlinks — edges pointing AT entityId, grouped by relation.
router.get('/backlinks/:entityId', (req, res) => {
  const { entityId } = req.params;
  const root = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
  if (!root) return res.status(404).json({ error: 'Không tìm thấy entity' });
  const visibleIds = visibleWorkflowIds(req.user.id);
  if (!isVisible(root, visibleIds)) return res.status(403).json({ error: 'Không có quyền xem entity này' });

  const rows = db.prepare(`
    SELECT ed.relation, src.* FROM edges ed
    JOIN entities src ON src.id = ed.source_id
    WHERE ed.target_id = ?
  `).all(entityId);

  const grouped = {};
  for (const row of rows) {
    if (!isVisible(row, visibleIds)) continue;
    if (!grouped[row.relation]) grouped[row.relation] = [];
    grouped[row.relation].push(toApiEntity(row, degreeOf(row.id)));
  }
  res.json(grouped);
});

// Admin-only: force a full re-derive of the workflow-sourced slice of the index.
router.post('/rebuild', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới rebuild được graph index' });

  const before = {
    entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
    edges: db.prepare('SELECT COUNT(*) c FROM edges').get().c,
  };
  const { workflowsIndexed } = rebuildAll();
  const after = {
    entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
    edges: db.prepare('SELECT COUNT(*) c FROM edges').get().c,
  };
  res.json({ workflowsIndexed, before, after });
});

module.exports = router;
