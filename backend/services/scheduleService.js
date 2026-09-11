const { encrypt, decrypt } = require('../utils/encryption');
const { parseWorkflow, authorize, invalid, validId } = require('../contracts/workflow');

function createScheduleService(db, runs, now = Date.now) {
  let timer = null;
  function activate(triggerId, workflow, seconds, user) {
    if (!validId(triggerId) || !Number.isFinite(seconds) || seconds < 1 || seconds > 86400 * 30) throw invalid('Invalid schedule interval or trigger');
    parseWorkflow(workflow); authorize(workflow, user, db);
    if (!workflow.nodes.some(node => node.id === triggerId)) throw invalid('Schedule trigger not in workflow');
    db.prepare(`INSERT INTO workflow_schedules(owner_id,trigger_id,intent,interval_ms,next_fire_at,active) VALUES (?,?,?,?,?,1)
      ON CONFLICT(owner_id,trigger_id) DO UPDATE SET intent=excluded.intent,interval_ms=excluded.interval_ms,next_fire_at=excluded.next_fire_at,active=1`)
      .run(user.id, triggerId, encrypt(JSON.stringify({ workflow })), seconds * 1000, now() + seconds * 1000);
  }
  function deactivate(triggerId, owner) { db.prepare('UPDATE workflow_schedules SET active=0 WHERE owner_id=? AND trigger_id=?').run(owner, triggerId); }
  function isActive(triggerId, owner) { return !!db.prepare('SELECT 1 FROM workflow_schedules WHERE owner_id=? AND trigger_id=? AND active=1').get(owner, triggerId); }
  function tick() {
    const due = db.prepare('SELECT * FROM workflow_schedules WHERE active=1 AND next_fire_at<=? ORDER BY next_fire_at LIMIT 50').all(now());
    for (const row of due) {
      try {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.owner_id);
        // Persisted fire timestamp is the dispatch idempotency key. A crash after submit but
        // before advancing the schedule reuses the SAME logical run on restart.
        const key = require('crypto').createHash('sha256').update(`${row.owner_id}:${row.trigger_id}:${row.next_fire_at}`).digest('hex');
        runs.submit(JSON.parse(decrypt(row.intent)), user, { idempotencyKey: `schedule:${key}` });
        db.prepare('UPDATE workflow_schedules SET next_fire_at=? WHERE owner_id=? AND trigger_id=? AND next_fire_at=?')
          .run(now() + row.interval_ms, row.owner_id, row.trigger_id, row.next_fire_at);
      } catch (error) {
        if ([400, 403, 404].includes(error.status)) deactivate(row.trigger_id, row.owner_id);
        console.error(JSON.stringify({ level: 'warn', action: 'schedule.dispatch_failed', code: error.code || 'SCHEDULE_ERROR', owner_id: row.owner_id }));
      }
    }
  }
  function start() { if (!timer) { tick(); timer = setInterval(tick, 1000); timer.unref(); } }
  function stop() { clearInterval(timer); timer = null; }
  return { activate, deactivate, isActive, tick, start, stop };
}
module.exports = { createScheduleService };
