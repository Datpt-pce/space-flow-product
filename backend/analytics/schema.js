const sql = `
CREATE TABLE IF NOT EXISTS analytics_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO analytics_settings VALUES ('enabled','1');
CREATE TABLE IF NOT EXISTS analytics_events (
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
 at INTEGER NOT NULL, received_at INTEGER NOT NULL, feature TEXT NOT NULL, name TEXT NOT NULL,
 session_id TEXT NOT NULL, node_type TEXT, props TEXT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS analytics_events_time ON analytics_events(at);
CREATE TABLE IF NOT EXISTS analytics_daily (
 day TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 feature TEXT NOT NULL, actions TEXT NOT NULL DEFAULT '{}', spans TEXT NOT NULL DEFAULT '{}',
 sessions TEXT NOT NULL DEFAULT '[]', last_at INTEGER NOT NULL, PRIMARY KEY(day,owner_id,feature)
);
CREATE TABLE IF NOT EXISTS analytics_jobs (
 kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER,
 updated_at INTEGER NOT NULL, location TEXT NOT NULL DEFAULT 'unknown',
 PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS analytics_jobs_time ON analytics_jobs(created_at);
CREATE TABLE IF NOT EXISTS analytics_output_usage (
 kind TEXT NOT NULL, output_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 first_at INTEGER NOT NULL, PRIMARY KEY(kind,output_id,owner_id)
);
CREATE TABLE IF NOT EXISTS analytics_attempts (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL, node_type TEXT NOT NULL, attempt INTEGER NOT NULL,
 location TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
 duration_ms REAL, state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_attempts_time ON analytics_attempts(started_at);
CREATE TABLE IF NOT EXISTS analytics_resources (
 id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL, instance_id TEXT NOT NULL, at INTEGER NOT NULL, sample TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_resources_time ON analytics_resources(at);
CREATE TABLE IF NOT EXISTS analytics_resource_daily (
 day TEXT NOT NULL, scope TEXT NOT NULL, instance_id TEXT NOT NULL,
 owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 samples INTEGER NOT NULL, elapsed_ms REAL NOT NULL, cpu_seconds REAL NOT NULL,
 rss_peak REAL NOT NULL, tree_cpu_seconds REAL NOT NULL, tree_samples INTEGER NOT NULL,
 last_at INTEGER NOT NULL, disk_free REAL, database_bytes REAL, PRIMARY KEY(day,scope,instance_id)
);
CREATE TABLE IF NOT EXISTS analytics_coverage (
 minute INTEGER PRIMARY KEY, version TEXT NOT NULL
);
`;

function ensureAnalyticsSchema(db) {
  db.exec(sql);
  // Narrow projections: no payload decryption or copies of inputs, outputs or receipts.
  // Trigger writes participate in the business transaction, including rollback/replay.
  const enabled = "(SELECT value FROM analytics_settings WHERE key='enabled')='1'";
  const time = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
  for (const [table, kind, state, created, updated] of [
    ['flow_runs', 'workflow', 'state', 'NEW.created_at', 'NEW.updated_at'],
    ['video_render_jobs', 'render', 'status', "CAST(strftime('%s',NEW.created_at) AS INTEGER)*1000", time],
    ['video_batch_deliveries', 'delivery', 'state', "CAST(strftime('%s',NEW.created_at) AS INTEGER)*1000", time],
  ]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    const terminal = `NEW.${state} IN ('succeeded','failed','unknown','cancelled','done','error')`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS analytics_${kind}_insert AFTER INSERT ON ${table} WHEN ${enabled}
    BEGIN INSERT OR IGNORE INTO analytics_jobs(kind,id,owner_id,state,created_at,started_at,ended_at,updated_at)
      VALUES ('${kind}',NEW.id,NEW.owner_id,NEW.${state},${created},CASE WHEN NEW.${state}='running' THEN ${updated} END,
        CASE WHEN ${terminal} THEN ${updated} END,${updated}); END;
    CREATE TRIGGER IF NOT EXISTS analytics_${kind}_state AFTER UPDATE OF ${state} ON ${table}
      WHEN OLD.${state} IS NOT NEW.${state} AND ${enabled}
    BEGIN UPDATE analytics_jobs SET state=NEW.${state}, updated_at=${updated},
      started_at=CASE WHEN NEW.${state}='running' THEN COALESCE(started_at,${updated}) ELSE started_at END,
      ended_at=CASE WHEN ${terminal} THEN ${updated} ELSE NULL END
      WHERE kind='${kind}' AND id=NEW.id; END;`);
  }
}
module.exports = { ensureAnalyticsSchema };
