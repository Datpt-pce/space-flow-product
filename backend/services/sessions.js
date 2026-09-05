const crypto = require('crypto');
const db = require('../db');

const COOKIE_NAME = 'sf_session';
const CSRF_COOKIE_NAME = 'sf_csrf';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

// Returns the user row for a valid, non-expired session token, or null.
function getUserForToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) || null;
}

function revokeSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: new Date(expiresAt),
    path: '/',
  });
  // Double-submit CSRF token: KHÔNG httpOnly để frontend đọc được và tự gắn vào header
  // X-CSRF-Token (frontend/src/lib/api.js) — kiểm tra ở backend/middleware/csrf.js.
  res.cookie(CSRF_COOKIE_NAME, crypto.randomBytes(32).toString('hex'), {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

module.exports = {
  COOKIE_NAME,
  CSRF_COOKIE_NAME,
  createSession,
  getUserForToken,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
};
