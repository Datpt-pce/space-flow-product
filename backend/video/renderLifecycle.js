const crypto = require('node:crypto');

// Persist leases and cancellation independently of the worker's process memory.
// Every attempt is fenced by a token and writes to its own output directory.
function createRenderLifecycle(db, now = Date.now) {
  const leaseMs = 45000;
  function recoverExpired() {
    return db.prepare(`UPDATE video_render_jobs SET
      status = CASE WHEN cancel_requested = 1 THEN 'cancelled' WHEN attempt_count >= max_attempts THEN 'error' ELSE 'queued' END,
      phase = 'recovery', attempt_token = NULL, lease_until = NULL,
      error_message = CASE WHEN attempt_count >= max_attempts THEN 'Render bị gián đoạn quá số lần tự khôi phục.' ELSE NULL END,
      updated_at = datetime('now')
      WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= ?)`).run(now()).changes;
  }
  function claim(id) {
    const token = crypto.randomUUID();
    const changed = db.prepare(`UPDATE video_render_jobs SET status = 'running', phase = 'assigned',
      attempt_count = attempt_count + 1, attempt_token = ?, lease_until = ?, progress_pct = 0,
      error_message = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued' AND cancel_requested = 0 AND attempt_count < max_attempts
      AND NOT EXISTS (SELECT 1 FROM video_render_jobs busy WHERE busy.owner_id = video_render_jobs.owner_id AND busy.status = 'running' AND busy.lease_until > ?)`)
      .run(token, now() + leaseMs, id, now()).changes;
    return changed ? token : null;
  }
  function assertCurrent(id, token) {
    const row = db.prepare('SELECT status, attempt_token, cancel_requested FROM video_render_jobs WHERE id = ?').get(id);
    if (!row || row.attempt_token !== token || row.status !== 'running') throw Object.assign(new Error('Render attempt đã hết hiệu lực.'), { staleAttempt: true });
    if (row.cancel_requested) throw Object.assign(new Error('Đã huỷ render.'), { cancelled: true });
  }
  function heartbeat(id, token) {
    return db.prepare("UPDATE video_render_jobs SET lease_until = ?, updated_at = datetime('now') WHERE id = ? AND attempt_token = ? AND status = 'running'").run(now() + leaseMs, id, token).changes;
  }
  function cancel(id) {
    db.prepare(`UPDATE video_render_jobs SET cancel_requested = 1,
      status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
      updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'running')`).run(id);
  }
  return { recoverExpired, claim, assertCurrent, heartbeat, cancel };
}
module.exports = { createRenderLifecycle };
