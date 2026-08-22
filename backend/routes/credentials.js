const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// Merged list for the calling user: their own private credentials + every public one.
// Never returns `data` (secrets) — only what the UI dropdown/list needs.
router.get('/', (req, res) => {
  const rows = db.prepare(
    "SELECT name, type, scope FROM credentials WHERE scope = 'public' OR (scope = 'private' AND owner_id = ?) ORDER BY scope, name"
  ).all(req.user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, type, data, scope } = req.body;
  if (!name || !type || !data || !scope) {
    return res.status(400).json({ error: 'Thiếu name, type, data hoặc scope' });
  }
  if (!['public', 'private'].includes(scope)) {
    return res.status(400).json({ error: 'scope phải là public hoặc private' });
  }
  if (scope === 'public' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới tạo được credential dùng chung (public)' });
  }
  const ownerId = scope === 'private' ? req.user.id : null;

  const existing = scope === 'public'
    ? db.prepare("SELECT id FROM credentials WHERE scope = 'public' AND name = ?").get(name)
    : db.prepare("SELECT id FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?").get(ownerId, name);

  if (existing) {
    db.prepare('UPDATE credentials SET type = ?, data = ? WHERE id = ?')
      .run(type, JSON.stringify(data), existing.id);
  } else {
    db.prepare('INSERT INTO credentials (id, scope, owner_id, name, type, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), scope, ownerId, name, type, JSON.stringify(data));
  }
  res.json({ success: true });
});

// Delete by name+scope (a user's private credential can share a name with a public one).
router.delete('/:name', (req, res) => {
  const scope = req.query.scope === 'public' ? 'public' : 'private';
  if (scope === 'public' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới xoá được credential public' });
  }
  if (scope === 'public') {
    db.prepare("DELETE FROM credentials WHERE scope = 'public' AND name = ?").run(req.params.name);
  } else {
    db.prepare("DELETE FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?")
      .run(req.user.id, req.params.name);
  }
  res.json({ success: true });
});

module.exports = router;
