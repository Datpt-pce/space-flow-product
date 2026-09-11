const crypto = require('crypto');

const sql = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), path TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'upload',
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_id, state);
`;

function ensureReadinessSchema(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const prior = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get('001-readiness-artifacts');
  if (prior && prior.checksum !== checksum) throw new Error('Migration checksum mismatch: 001-readiness-artifacts');
  if (prior) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)').run('001-readiness-artifacts', checksum);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { ensureReadinessSchema };
