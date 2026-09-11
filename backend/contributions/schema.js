const crypto = require('crypto');
const sql = `
CREATE TABLE IF NOT EXISTS contribution_records (
 kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS contribution_records_updated ON contribution_records(kind,updated_at);
`;
function ensureContributionSchema(db) {
  const id = '004-contribution-records';
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const prior = db.prepare('SELECT checksum FROM schema_migrations WHERE id=?').get(id);
  if (prior) {
    if (prior.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${id}`);
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations(id,checksum) VALUES (?,?)').run(id, checksum);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { ensureContributionSchema };
