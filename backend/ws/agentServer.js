const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('../db');

const HEARTBEAT_TIMEOUT_MS = 30000;
const SWEEP_INTERVAL_MS = 10000;

// userId -> live WebSocket of that user's agent (at most 1, enforced by agents.user_id UNIQUE).
const onlineAgents = new Map();
// runId -> { onEvent, resolve, reject } — bridges a relayed run back to the HTTP SSE response
// that's waiting on it in routes/execute.js.
const pendingRuns = new Map();
// reqId -> { res, headersSent } — bridges a relayed auxiliary HTTP call (see
// middleware/relayToAgent.js) back to the original Express `res` waiting on it.
const pendingProxies = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function markOnline(agentId, userId) {
  db.prepare("UPDATE agents SET status = 'online', last_seen_at = datetime('now') WHERE id = ?").run(agentId);
}

function markOffline(agentId) {
  if (!agentId) return;
  db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(agentId);
}

function attachAgentServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/agent-ws' });

  wss.on('connection', (ws) => {
    let userId = null;
    let agentId = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'register') {
        const row = db.prepare('SELECT * FROM agents WHERE secret_hash = ?').get(hashToken(msg.agentToken || ''));
        if (!row) {
          ws.send(JSON.stringify({ type: 'error', message: 'Agent token không hợp lệ' }));
          ws.close();
          return;
        }
        userId = row.user_id;
        agentId = row.id;
        onlineAgents.set(userId, ws);
        markOnline(agentId, userId);
        ws.send(JSON.stringify({ type: 'registered', agentId }));
        return;
      }

      if (msg.type === 'ping') {
        if (agentId) markOnline(agentId, userId);
        return;
      }

      if (msg.type === 'event') {
        const pending = pendingRuns.get(msg.runId);
        if (!pending) return;
        pending.onEvent(msg.event, msg.data);
        if (msg.event === 'done' || msg.event === 'error') {
          pendingRuns.delete(msg.runId);
          if (msg.event === 'done') pending.resolve();
          // __forwarded: the 'error' event above already reached the browser via onEvent —
          // routes/execute.js must not send a second SSE 'error' frame for this rejection.
          else pending.reject(Object.assign(new Error(msg.data?.error || 'Agent run thất bại'), { __forwarded: true }));
        }
        return;
      }

      // http-proxy-*: relayed auxiliary REST call (browse-folder, capcut restart, resize-upload
      // run...) — see middleware/relayToAgent.js. Same start/chunk/end shape handles a tiny JSON
      // reply, a long SSE stream, and a binary body (base64-encoded per chunk) uniformly.
      if (msg.type === 'http-proxy-response-start') {
        const pending = pendingProxies.get(msg.reqId);
        if (!pending) return;
        pending.res.status(msg.status);
        if (msg.contentType) pending.res.set('Content-Type', msg.contentType);
        pending.headersSent = true;
        return;
      }

      if (msg.type === 'http-proxy-response-chunk') {
        const pending = pendingProxies.get(msg.reqId);
        if (!pending) return;
        pending.res.write(Buffer.from(msg.chunkBase64, 'base64'));
        return;
      }

      if (msg.type === 'http-proxy-response-end') {
        const pending = pendingProxies.get(msg.reqId);
        if (!pending) return;
        pending.res.end();
        pendingProxies.delete(msg.reqId);
        return;
      }

      if (msg.type === 'http-proxy-error') {
        const pending = pendingProxies.get(msg.reqId);
        if (!pending) return;
        if (!pending.headersSent) pending.res.status(502).json({ error: 'Lỗi từ agent: ' + msg.message });
        else pending.res.end();
        pendingProxies.delete(msg.reqId);
        return;
      }
    });

    ws.on('close', () => {
      if (userId && onlineAgents.get(userId) === ws) onlineAgents.delete(userId);
      markOffline(agentId);
      // Agent dropped mid-run (crash/network) without ever sending a terminal
      // done/error event — reject so the waiting HTTP SSE response doesn't hang forever.
      for (const [runId, pending] of pendingRuns) {
        if (pending.ws === ws) {
          pendingRuns.delete(runId);
          pending.reject(new Error('Agent mất kết nối giữa lúc đang chạy'));
        }
      }
      // Same idea for in-flight relayed auxiliary calls.
      for (const [reqId, pending] of pendingProxies) {
        if (pending.ws === ws) {
          pendingProxies.delete(reqId);
          if (!pending.headersSent) pending.res.status(502).json({ error: 'Agent mất kết nối trong lúc xử lý yêu cầu' });
          else pending.res.end();
        }
      }
    });
  });

  // Heartbeat sweep: an agent that stops pinging (crashed/network drop, no clean close
  // frame) is marked offline instead of showing "online" forever.
  setInterval(() => {
    const stale = db.prepare(
      "SELECT id, user_id FROM agents WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))"
    ).all(`-${Math.floor(HEARTBEAT_TIMEOUT_MS / 1000)} seconds`);
    for (const row of stale) {
      markOffline(row.id);
      if (onlineAgents.get(row.user_id)?.readyState !== 1 /* OPEN */) onlineAgents.delete(row.user_id);
    }
  }, SWEEP_INTERVAL_MS).unref();

  return wss;
}

function isAgentOnline(userId) {
  return onlineAgents.has(userId);
}

// Relays a run to `userId`'s connected agent and resolves once the agent reports
// done/error — onEvent(event, data) fires for every event frame in between, mirroring
// the callback shape executor.run() itself uses (see backend/engine/executor.js `send`).
function sendRun(userId, runPayload, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = onlineAgents.get(userId);
    if (!ws) return reject(new Error('Agent của bạn hiện không online'));
    const runId = crypto.randomUUID();
    pendingRuns.set(runId, { onEvent, resolve, reject, ws });
    ws.send(JSON.stringify({ type: 'run', runId, ...runPayload }));
  });
}

// Relays an auxiliary HTTP call (browse-folder, capcut restart, resize-upload run...) to
// `userId`'s connected agent and streams the real response straight into `res` as it arrives —
// see middleware/relayToAgent.js for the caller side and connection.js for the agent side.
function sendHttpProxy(userId, req, res) {
  const ws = onlineAgents.get(userId);
  if (!ws) return Promise.reject(new Error('Agent của bạn hiện không online'));
  const reqId = crypto.randomUUID();
  pendingProxies.set(reqId, { res, headersSent: false, ws });
  ws.send(JSON.stringify({ type: 'http-proxy-request', reqId, ...req }));
  return Promise.resolve(); // fire-and-forget — res is completed asynchronously by the message handlers above
}

module.exports = { attachAgentServer, isAgentOnline, sendRun, sendHttpProxy };
