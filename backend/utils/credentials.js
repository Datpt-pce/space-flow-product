const crypto = require('crypto');
const db = require('../db');

function logUsage(userId, kind, ref, status) {
  if (!userId) return; // executor.run() called outside an authenticated HTTP request (none today)
  db.prepare('INSERT INTO usage_events (id, user_id, kind, ref, status) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, kind, ref, status);
}

// Resolution order: this user's private credential named `name` wins if it exists,
// else fall back to the team-wide public credential of the same name — but only if Admin has
// granted this user access to it (user_credential_permissions; admins always pass). This is
// the single choke point every node's execute.js resolves credentials through, so it's also
// where per-user usage gets logged for the Admin Dashboard (backend/db/index.js usage_events).
function getCredential(name, userId) {
  if (!name) return null;
  if (userId) {
    const priv = db.prepare(
      "SELECT type, data FROM credentials WHERE scope = 'private' AND owner_id = ? AND name = ?"
    ).get(userId, name);
    if (priv) {
      logUsage(userId, 'credential', name, 'success');
      return { type: priv.type, data: JSON.parse(priv.data) };
    }
  }
  const pub = db.prepare(
    "SELECT type, data FROM credentials WHERE scope = 'public' AND name = ?"
  ).get(name);
  if (pub) {
    if (userId) {
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        const granted = db.prepare(
          'SELECT 1 FROM user_credential_permissions WHERE user_id = ? AND credential_name = ?'
        ).get(userId, name);
        if (!granted) {
          logUsage(userId, 'credential', name, 'error');
          throw new Error(`Bạn chưa được cấp quyền dùng credential "${name}" — liên hệ Admin để được cấp quyền.`);
        }
      }
    }
    logUsage(userId, 'credential', name, 'success');
    return { type: pub.type, data: JSON.parse(pub.data) };
  }
  return null;
}

// Generic auth injection, mirrors n8n's credential "authenticate" property:
// header/query/basicAuth/bearer all just mutate the outgoing request shape.
function applyAuth(credential, { headers, qs }) {
  if (!credential) return;
  switch (credential.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${credential.data.token}`;
      break;
    case 'basicAuth':
      headers['Authorization'] =
        'Basic ' + Buffer.from(`${credential.data.user}:${credential.data.pass}`).toString('base64');
      break;
    case 'header':
      headers[credential.data.name] = credential.data.value;
      break;
    case 'query':
      qs[credential.data.name] = credential.data.value;
      break;
  }
}

module.exports = { getCredential, applyAuth };
