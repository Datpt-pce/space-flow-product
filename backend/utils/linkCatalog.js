const crypto = require('crypto');
const db = require('../db');

// App/Link catalog for resize-upload-v2 — mirrors the private-then-public resolution order of
// getCredential() (backend/utils/credentials.js), but keyed by scope only (at most 1 public row,
// at most 1 private row per user — no `name` needed, unlike credentials).
function getLinkCatalog(userId) {
  if (userId) {
    const priv = db.prepare(
      "SELECT data FROM resize_link_catalogs WHERE scope = 'private' AND owner_id = ?"
    ).get(userId);
    if (priv) return JSON.parse(priv.data);
  }
  const pub = db.prepare("SELECT data FROM resize_link_catalogs WHERE scope = 'public'").get();
  return pub ? JSON.parse(pub.data) : {};
}

function getOwnLinkCatalog(userId) {
  if (!userId) return null;
  const priv = db.prepare(
    "SELECT data FROM resize_link_catalogs WHERE scope = 'private' AND owner_id = ?"
  ).get(userId);
  return priv ? JSON.parse(priv.data) : null;
}

function getPublicLinkCatalog() {
  const pub = db.prepare("SELECT data FROM resize_link_catalogs WHERE scope = 'public'").get();
  return pub ? JSON.parse(pub.data) : {};
}

function saveLinkCatalog(scope, userId, data) {
  const json = JSON.stringify(data);
  if (scope === 'public') {
    const existing = db.prepare("SELECT id FROM resize_link_catalogs WHERE scope = 'public'").get();
    if (existing) {
      db.prepare("UPDATE resize_link_catalogs SET data = ?, updated_at = datetime('now') WHERE id = ?")
        .run(json, existing.id);
    } else {
      db.prepare('INSERT INTO resize_link_catalogs (id, scope, owner_id, data) VALUES (?, ?, NULL, ?)')
        .run(crypto.randomUUID(), 'public', json);
    }
  } else {
    const existing = db.prepare(
      "SELECT id FROM resize_link_catalogs WHERE scope = 'private' AND owner_id = ?"
    ).get(userId);
    if (existing) {
      db.prepare("UPDATE resize_link_catalogs SET data = ?, updated_at = datetime('now') WHERE id = ?")
        .run(json, existing.id);
    } else {
      db.prepare('INSERT INTO resize_link_catalogs (id, scope, owner_id, data) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), 'private', userId, json);
    }
  }
}

function deleteLinkCatalog(userId) {
  db.prepare("DELETE FROM resize_link_catalogs WHERE scope = 'private' AND owner_id = ?").run(userId);
}

module.exports = { getLinkCatalog, getOwnLinkCatalog, getPublicLinkCatalog, saveLinkCatalog, deleteLinkCatalog };
