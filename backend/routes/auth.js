const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { verifyGoogleIdToken } = require('../services/googleAuth');
const { COOKIE_NAME, createSession, revokeSession, setSessionCookie, clearSessionCookie } = require('../services/sessions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau.' },
});

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

// Dev-only bypass cho Google login khi chay local. Mac dinh TAT (404) - chi bat khi .env co
// DEV_LOGIN_ENABLED=true. .env khong duoc dong bo qua lenh "product"/"SERVER" (CLAUDE.md SS9/SS11,
// script archive tu git tree - .env gitignored), nen bat co nay o may dev khong lam lo ra
// product/server. Tao/dung lai 1 user admin co dinh, set session cookie giong het luong Google that.
router.get('/dev-login', loginLimiter, (req, res) => {
  if (process.env.DEV_LOGIN_ENABLED !== 'true') return res.status(404).end();

  const email = 'dev@space-flow.local';
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, google_sub, email, name, role, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, 'dev-login-sub', email, 'Local Dev', 'admin', 'active');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.redirect('/');
});

router.post('/google', loginLimiter, async (req, res) => {
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
