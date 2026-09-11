const express = require('express');
const os = require('os');
const db = require('../db');
const router = express.Router();
router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/environment', (req, res) => {
  res.json({ name: process.env.SF_INSTANCE_NAME || (process.env.SF_REVIEW_INSTANCE ? 'Control Center local' : os.hostname()),
    mode: process.env.SF_REVIEW_INSTANCE ? 'controller' : process.env.SPACE_FLOW_MODE || 'agent',
    platform: process.platform, nodeVersion: process.version, isolated: !!process.env.SF_REVIEW_INSTANCE });
});
router.get('/runs', (req, res) => {
  const state = req.query.state || '';
  if (state && !['queued', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'].includes(state)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  const rows = db.prepare(`SELECT r.id,r.state,r.created_at AS createdAt,r.updated_at AS updatedAt,
    r.cancel_requested AS cancelRequested,u.name AS ownerName,u.email AS ownerEmail
    FROM flow_runs r JOIN users u ON u.id=r.owner_id ${state ? 'WHERE r.state=?' : ''}
    ORDER BY r.created_at DESC,r.id DESC LIMIT 100`).all(...(state ? [state] : []));
  res.json(rows);
});
router.post('/runs/:id/cancel', (req, res) => {
  const row = db.prepare('SELECT owner_id,state FROM flow_runs WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy lượt chạy.' });
  if (!['queued', 'running'].includes(row.state)) return res.status(409).json({ error: 'Lượt chạy đã kết thúc; hãy làm mới danh sách.' });
  const result = require('../services/workflowRunner').runs.cancel(req.params.id, row.owner_id);
  console.log(JSON.stringify({ action: 'admin.run.cancel', actor: req.user.id, runId: req.params.id, at: new Date().toISOString() }));
  res.json({ id: result.id, state: result.state, cancelRequested: !!result.cancel_requested });
});
module.exports = router;
