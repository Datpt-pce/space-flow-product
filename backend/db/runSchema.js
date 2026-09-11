const crypto = require('crypto');
const sql = `
CREATE TABLE IF NOT EXISTS flow_runs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT,
 input_hash TEXT NOT NULL, intent TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','unknown','cancelled')),
 lease_owner TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 cancel_requested INTEGER NOT NULL DEFAULT 0, request_id TEXT, correlation_id TEXT,
 UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_flow_runs_queue ON flow_runs(state,created_at);
CREATE TABLE IF NOT EXISTS run_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
 event TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id,seq);
CREATE TABLE IF NOT EXISTS node_runs (
 run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE, node_id TEXT NOT NULL,
 effect_class TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, checkpoint TEXT,
 PRIMARY KEY(run_id,node_id)
);
CREATE TABLE IF NOT EXISTS workflow_schedules (
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, trigger_id TEXT NOT NULL,
 intent TEXT NOT NULL, interval_ms INTEGER NOT NULL, next_fire_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(owner_id,trigger_id)
);
`;
function ensureRunSchema(db) {
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const prior = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get('002-durable-runs');
  if (prior) { if (prior.checksum !== checksum) throw new Error('Migration checksum mismatch: 002-durable-runs'); return; }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    if (!db.prepare('PRAGMA table_info(workflows)').all().some(c => c.name === 'revision')) db.exec('ALTER TABLE workflows ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    db.prepare('INSERT INTO schema_migrations (id,checksum) VALUES (?,?)').run('002-durable-runs', checksum);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { ensureRunSchema };
