const express = require('express');
const db = require('../db');

const router = express.Router();

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url, role: user.role, status: user.status, createdAt: user.created_at };
}

router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json(users.map(toPublicUser));
});

// All-time usage counts per user, grouped by node type and by credential (Admin Dashboard —
// see backend/db/index.js usage_events, populated in routes/execute.js + utils/credentials.js).
// Registered before '/:id/...' so this literal path isn't swallowed by the param route.
router.get('/usage-stats', (req, res) => {
  const nodes = db.prepare(
    "SELECT user_id AS userId, ref AS nodeType, status, COUNT(*) AS count FROM usage_events WHERE kind = 'node' GROUP BY user_id, ref, status"
  ).all();
  const credentials = db.prepare(
    "SELECT user_id AS userId, ref AS credentialName, COUNT(*) AS count FROM usage_events WHERE kind = 'credential' GROUP BY user_id, ref"
  ).all();
  res.json({ nodes, credentials });
});

router.patch('/:id', (req, res) => {
  const { role, status } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

  const nextRole = role !== undefined ? role : user.role;
  const nextStatus = status !== undefined ? status : user.status;
  if (!['admin', 'member'].includes(nextRole)) {
    return res.status(400).json({ error: 'role phải là admin hoặc member' });
  }
  if (!['pending', 'active', 'rejected'].includes(nextStatus)) {
    return res.status(400).json({ error: 'status phải là pending, active hoặc rejected' });
  }
  db.prepare('UPDATE users SET role = ?, status = ? WHERE id = ?').run(nextRole, nextStatus, req.params.id);
  res.json(toPublicUser({ ...user, role: nextRole, status: nextStatus }));
});

// Node types + public credential names this user is allowed to use (empty = nothing — see
// backend/db/index.js user_node_permissions/user_credential_permissions). Admins bypass this
// entirely at enforcement time (routes/nodes.js, routes/execute.js, utils/credentials.js) so
// their own permission rows are irrelevant, but the editor still reads/writes them uniformly.
router.get('/:id/permissions', (req, res) => {
  const nodeTypes = db.prepare('SELECT node_type FROM user_node_permissions WHERE user_id = ?')
    .all(req.params.id).map(r => r.node_type);
  const credentialNames = db.prepare('SELECT credential_name FROM user_credential_permissions WHERE user_id = ?')
    .all(req.params.id).map(r => r.credential_name);
  res.json({ nodeTypes, credentialNames });
});

router.put('/:id/permissions', (req, res) => {
  const { nodeTypes = [], credentialNames = [] } = req.body;
  const userId = req.params.id;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_node_permissions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_credential_permissions WHERE user_id = ?').run(userId);
    const insertNode = db.prepare('INSERT INTO user_node_permissions (user_id, node_type) VALUES (?, ?)');
    for (const nodeType of nodeTypes) insertNode.run(userId, nodeType);
    const insertCred = db.prepare('INSERT INTO user_credential_permissions (user_id, credential_name) VALUES (?, ?)');
    for (const name of credentialNames) insertCred.run(userId, name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ success: true });
});

module.exports = router;
