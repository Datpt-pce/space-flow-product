// Operator-controlled metadata retention. Keep run intent/idempotency tombstones and unknown outcomes.
function retention(db, { now = Date.now(), apply = false } = {}) {
  const operations = [
    ['expiredSessions', "DELETE FROM sessions WHERE datetime(expires_at) < datetime(?)", new Date(now).toISOString()],
    ['oldUsage', "DELETE FROM usage_events WHERE datetime(created_at) < datetime(?)", new Date(now - 90 * 86400000).toISOString()],
    ['oldRunProgress', "DELETE FROM run_events WHERE created_at < ? AND event NOT IN ('done','error','reconciled') AND run_id IN (SELECT id FROM flow_runs WHERE state IN ('succeeded','failed','cancelled'))", now - 30 * 86400000],
  ];
  const result = {};
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, sql, value] of operations) result[name] = db.prepare(sql).run(value).changes;
    db.exec(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, ...result };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { retention };
