var i=Object.defineProperty;var n=(e,r)=>i(e,"name",{value:r,configurable:!0});const crypto=require("node:crypto");function createRenderLifecycle(e,r=Date.now){function u(){return e.prepare(`UPDATE video_render_jobs SET
      status = CASE WHEN cancel_requested = 1 THEN 'cancelled' WHEN attempt_count >= max_attempts THEN 'error' ELSE 'queued' END,
      phase = 'recovery', attempt_token = NULL, lease_until = NULL,
      error_message = CASE WHEN attempt_count >= max_attempts THEN 'Render b\u1ECB gi\xE1n \u0111o\u1EA1n qu\xE1 s\u1ED1 l\u1EA7n t\u1EF1 kh\xF4i ph\u1EE5c.' ELSE NULL END,
      updated_at = datetime('now')
      WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= ?)`).run(r()).changes}n(u,"recoverExpired");function o(t){const a=crypto.randomUUID();return e.prepare(`UPDATE video_render_jobs SET status = 'running', phase = 'assigned',
      attempt_count = attempt_count + 1, attempt_token = ?, lease_until = ?, progress_pct = 0,
      error_message = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued' AND cancel_requested = 0 AND attempt_count < max_attempts
      AND NOT EXISTS (SELECT 1 FROM video_render_jobs busy WHERE busy.owner_id = video_render_jobs.owner_id AND busy.status = 'running' AND busy.lease_until > ?)`).run(a,r()+45e3,t,r()).changes?a:null}n(o,"claim");function c(t,a){const s=e.prepare("SELECT status, attempt_token, cancel_requested FROM video_render_jobs WHERE id = ?").get(t);if(!s||s.attempt_token!==a||s.status!=="running")throw Object.assign(new Error("Render attempt \u0111\xE3 h\u1EBFt hi\u1EC7u l\u1EF1c."),{staleAttempt:!0});if(s.cancel_requested)throw Object.assign(new Error("\u0110\xE3 hu\u1EF7 render."),{cancelled:!0})}n(c,"assertCurrent");function d(t,a){return e.prepare("UPDATE video_render_jobs SET lease_until = ?, updated_at = datetime('now') WHERE id = ? AND attempt_token = ? AND status = 'running'").run(r()+45e3,t,a).changes}n(d,"heartbeat");function E(t){e.prepare(`UPDATE video_render_jobs SET cancel_requested = 1,
      status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
      updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'running')`).run(t)}return n(E,"cancel"),{recoverExpired:u,claim:o,assertCurrent:c,heartbeat:d,cancel:E}}n(createRenderLifecycle,"createRenderLifecycle"),module.exports={createRenderLifecycle};
