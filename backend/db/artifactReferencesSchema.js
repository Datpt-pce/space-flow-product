const crypto = require('crypto');
const sql = `
CREATE TABLE IF NOT EXISTS workflow_artifacts (
 workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), PRIMARY KEY(workflow_id,artifact_id)
);
CREATE TABLE IF NOT EXISTS run_artifacts (
 run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), PRIMARY KEY(run_id,artifact_id)
);
`;
function ensureArtifactReferencesSchema(db) {
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const prior = db.prepare('SELECT checksum FROM schema_migrations WHERE id=?').get('003-artifact-references');
  if (prior) { if (prior.checksum !== checksum) throw new Error('Migration checksum mismatch: 003-artifact-references'); return; }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations(id,checksum) VALUES(?,?)').run('003-artifact-references', checksum);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { ensureArtifactReferencesSchema };
