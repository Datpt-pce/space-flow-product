const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { reindexWorkflow } = require('../graph/indexer');
const { enqueueReindex } = require('../graph/reindexQueue');

const router = express.Router();

function toMeta(row) {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    isMine: undefined, // filled in by the route (needs req.user)
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Every workflow the caller is allowed to see: their own (any visibility) + team-shared ones.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT w.*, u.name AS owner_name
    FROM workflows w JOIN users u ON u.id = w.owner_id
    WHERE w.visibility = 'team' OR w.owner_id = ?
    ORDER BY w.updated_at DESC
  `).all(req.user.id);
  res.json(rows.map(r => ({ ...toMeta(r), isMine: r.owner_id === req.user.id })));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT w.*, u.name AS owner_name FROM workflows w JOIN users u ON u.id = w.owner_id WHERE w.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy workflow' });
  if (row.visibility === 'private' && row.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Workflow này là riêng tư của người khác' });
  }
  res.json({ ...toMeta(row), isMine: row.owner_id === req.user.id, payload: JSON.parse(row.payload) });
});

router.post('/', (req, res) => {
  const { name, visibility, payload } = req.body;
  if (!name || !payload) return res.status(400).json({ error: 'Thiếu name hoặc payload' });
  const vis = visibility === 'team' ? 'team' : 'private';
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO workflows (id, owner_id, name, visibility, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.user.id, name, vis, JSON.stringify(payload));
  enqueueReindex(id); // survives a crash before the synchronous call below reaches indexer.js
  reindexWorkflow(id);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy workflow' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới sửa được workflow này' });

  const { name, visibility, payload } = req.body;
  const nextName = name ?? row.name;
  const nextVisibility = visibility === 'team' || visibility === 'private' ? visibility : row.visibility;
  const nextPayload = payload !== undefined ? JSON.stringify(payload) : row.payload;

  db.prepare(
    "UPDATE workflows SET name = ?, visibility = ?, payload = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nextName, nextVisibility, nextPayload, req.params.id);
  enqueueReindex(req.params.id);
  reindexWorkflow(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT owner_id FROM workflows WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy workflow' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Chỉ chủ sở hữu mới xoá được workflow này' });
  db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
  enqueueReindex(req.params.id);
  reindexWorkflow(req.params.id);
  res.json({ success: true });
});

module.exports = router;
