const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { verifyGoogleIdToken } = require('../services/googleAuth');
const { COOKIE_NAME, createSession, revokeSession, setSessionCookie, clearSessionCookie } = require('../services/sessions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url, role: user.role, status: user.status };
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Thiếu idToken' });

  let profile;
  try {
    profile = await verifyGoogleIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Google token không hợp lệ: ' + err.message });
  }

  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub);
  if (!user) {
    const isAdminEmail = getAdminEmails().includes(profile.email.toLowerCase());
    const role = isAdminEmail ? 'admin' : 'member';
    // New members wait for Admin approval before they can do anything (Node/credential
    // permissions default to none too — see user_node_permissions/user_credential_permissions).
    // The bootstrap admin(s) from ADMIN_EMAILS skip the queue, or nobody could ever approve.
    const status = isAdminEmail ? 'active' : 'pending';
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, google_sub, email, name, avatar_url, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, profile.sub, profile.email, profile.name, profile.avatarUrl, role, status);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  if (user.status !== 'active') {
    return res.status(403).json({
      error: user.status === 'rejected'
        ? 'Tài khoản của bạn không được cấp quyền truy cập.'
        : 'Tài khoản của bạn đang chờ Admin duyệt.',
    });
  }

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ user: toPublicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  revokeSession(token);
  clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
