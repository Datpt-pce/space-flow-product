// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4 task checklist):
// "backend/services/googleOAuthClient.js: getAuthorizedClientForUser(userId) đọc credential,
// setCredentials({refresh_token}), auto-refresh, cập nhật cache qua listener on('tokens', ...)".
//
// Deliberately does NOT go through backend/utils/credentials.js's getCredential() — that helper
// is the node-executor credential resolver (private→public fallback, per-user grant checks,
// usage_events logging), a different concern from "read/write THIS user's own single Google
// Sheets OAuth connection". Reads/writes the same `credentials` table directly instead, same as
// backend/routes/credentials.js does — 1 fixed row per user, scope='private',
// name=CREDENTIAL_NAME, so credentials.js's existing (owner_id, name) unique index already
// enforces "at most 1 connection per user" for free.

const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');

const CREDENTIAL_NAME = 'google_sheets_oauth';

class GooglePermissionLostError extends Error {}

function buildClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

function getStoredCredential(userId) {
  const row = db.prepare(
    "SELECT id, data FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?"
  ).get(userId, CREDENTIAL_NAME);
  if (!row) return null;
  return { id: row.id, data: JSON.parse(decrypt(row.data)) };
}

function isConnected(userId) {
  return !!getStoredCredential(userId);
}

// saveRefreshToken: upsert, same shape as backend/routes/credentials.js's POST handler (kept in
// sync with that pattern deliberately — see file header).
function saveRefreshToken(userId, refreshToken) {
  const existing = db.prepare(
    "SELECT id FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?"
  ).get(userId, CREDENTIAL_NAME);
  const data = encrypt(JSON.stringify({ refresh_token: refreshToken, connected_at: new Date().toISOString() }));
  if (existing) {
    db.prepare('UPDATE credentials SET data = ? WHERE id = ?').run(data, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO credentials (id, scope, owner_id, name, type, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'private', userId, CREDENTIAL_NAME, 'google_sheets_oauth', data);
  return id;
}

function disconnect(userId) {
  db.prepare("DELETE FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?")
    .run(userId, CREDENTIAL_NAME);
}

// getAccessTokenForUser(userId) -> access token string, silently refreshed via the stored
// refresh_token. Throws { code: 'NOT_CONNECTED' } if the user never connected, or
// GooglePermissionLostError if Google reports the refresh_token itself is no longer valid
// (revoked share/access) — callers (sheetSyncWorker.js, sheets.js's link-google route) branch on
// this to set sync_status='permission_lost' instead of a generic error.
async function getAccessTokenForUser(userId) {
  const stored = getStoredCredential(userId);
  if (!stored) {
    const err = new Error('Chưa kết nối Google Sheets cho tài khoản này');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const client = buildClient();
  client.setCredentials({ refresh_token: stored.data.refresh_token });
  // Google occasionally rotates the refresh_token on use — persist it if it does, otherwise the
  // NEXT refresh would fail with a now-stale token even though this one still worked.
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) saveRefreshToken(userId, tokens.refresh_token);
  });

  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Google không trả về access token');
    return token;
  } catch (err) {
    const isInvalidGrant = err.message?.includes('invalid_grant') || err.response?.data?.error === 'invalid_grant';
    if (isInvalidGrant) {
      throw new GooglePermissionLostError('Quyền truy cập Google đã bị thu hồi — cần kết nối lại.');
    }
    throw err;
  }
}

module.exports = {
  CREDENTIAL_NAME,
  buildClient,
  isConnected,
  saveRefreshToken,
  disconnect,
  getAccessTokenForUser,
  GooglePermissionLostError,
};
