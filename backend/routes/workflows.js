const express = require('express');
const workflows = require('../services/workflows');
const router = express.Router();
function meta(row, owner) {
  return { id: row.id, name: row.name, visibility: row.visibility, ownerId: row.owner_id,
    ownerName: row.owner_name, isMine: row.owner_id === owner, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
router.get('/', (req, res) => {
  const result = workflows.list(req.user.id, req.query);
  if (Array.isArray(result)) return res.json(result.map(row => meta(row, req.user.id)));
  res.json({ items: result.rows.map(row => meta(row, req.user.id)), nextCursor: result.nextCursor });
});
router.get('/:id', (req, res) => {
  const row = workflows.get(req.params.id, req.user.id);
  res.setHeader('ETag', `"${row.revision}"`);
  res.json({ ...meta(row, req.user.id), payload: JSON.parse(row.payload) });
});
router.post('/', (req, res) => {
  const row = workflows.create(req.body, req.user.id);
  res.setHeader('ETag', `"${row.revision}"`); res.json({ id: row.id, revision: row.revision });
});
router.put('/:id', (req, res) => {
  const row = workflows.update(req.params.id, req.body, req.user.id, req.headers['if-match']);
  res.setHeader('ETag', `"${row.revision}"`); res.json({ success: true, revision: row.revision });
});
router.delete('/:id', (req, res) => { workflows.remove(req.params.id, req.user.id, req.headers['if-match']); res.json({ success: true }); });
module.exports = router;
