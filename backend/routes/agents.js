const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublicAgent(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    ownerId: row.user_id,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
  };
}

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    const rows = db.prepare(`
      SELECT a.*, u.email AS owner_email FROM agents a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC
    `).all();
    return res.json(rows.map(toPublicAgent));
  }
  const row = db.prepare(`
    SELECT a.*, u.email AS owner_email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?
  `).get(req.user.id);
  res.json(row ? [toPublicAgent(row)] : []);
});

// Pairing: mints a one-time agentToken for the caller. The raw token is only ever
// returned here — the DB only keeps its hash (same pattern as services/sessions.js) —
// paste it into backend/config/agent.json on the machine that will run as this agent.
router.post('/', (req, res) => {
  const existing = db.prepare('SELECT id FROM agents WHERE user_id = ?').get(req.user.id);
  if (existing) {
    return res.status(409).json({ error: 'Bạn đã có agent — xoá agent cũ trước khi đăng ký agent mới' });
  }
  const agentToken = crypto.randomBytes(32).toString('hex');
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO agents (id, user_id, secret_hash, name, status) VALUES (?, ?, ?, ?, 'offline')"
  ).run(id, req.user.id, hashToken(agentToken), req.body?.name || null);
  res.json({ id, agentToken });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT user_id FROM agents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy agent' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ chủ sở hữu hoặc Admin mới xoá được agent này' });
  }
  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
