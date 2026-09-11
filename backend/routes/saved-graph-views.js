// Graph Library Phase 7 (specs/space-flow-master-plan/02-graph-library.md): CRUD for a saved
// graph view (filter/color-groups/force-settings/camera/pinned positions), scoped per-owner —
// these are personal bookmarks, not shared team resources, so unlike routes/workflows.js there is
// no 'team' visibility here (kept simple until a real use case asks for sharing one).

const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function toApi(row) {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    filters: JSON.parse(row.filters_json),
    groups: JSON.parse(row.groups_json),
    forces: JSON.parse(row.forces_json),
    camera: JSON.parse(row.camera_json),
    pinnedPositions: JSON.parse(row.pinned_positions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ?scope= required — a view is always opened from a specific graph (Global or 1 Local root),
// never listed context-free.
router.get('/', (req, res) => {
  if (!req.query.scope) return res.status(400).json({ error: 'Thiếu scope' });
  const rows = db.prepare(
    'SELECT * FROM saved_graph_views WHERE owner_id = ? AND scope = ? ORDER BY updated_at DESC'
  ).all(req.user.id, req.query.scope);
  res.json(rows.map(toApi));
});

router.post('/', (req, res) => {
  const { scope, name, filters, groups, forces, camera, pinnedPositions } = req.body;
  if (!scope || !name) return res.status(400).json({ error: 'Thiếu scope hoặc name' });
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO saved_graph_views (id, owner_id, scope, name, filters_json, groups_json, forces_json, camera_json, pinned_positions_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, scope, name,
    JSON.stringify(filters ?? {}), JSON.stringify(groups ?? []), JSON.stringify(forces ?? {}),
    JSON.stringify(camera ?? {}), JSON.stringify(pinnedPositions ?? {})
  );
  res.json({ id });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM saved_graph_views WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy saved view' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới xoá được' });
  db.prepare('DELETE FROM saved_graph_views WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
