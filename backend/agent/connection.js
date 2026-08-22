const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const executor = require('../engine/executor');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'agent.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 15000;

// Shared secret for this process's own loopback HTTP calls (middleware/relayToAgent.js relayed
// requests, replayed here against our own Express app) — generated once, kept in memory only,
// never sent over the WS wire. Lets `internalOrAuth` (middleware/auth.js) trust these calls
// without a browser session cookie, while every real request still goes through requireAuth.
const INTERNAL_RELAY_TOKEN = crypto.randomBytes(24).toString('hex');

function readAgentToken() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    // Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes a leading BOM, which
    // JSON.parse() does not strip on its own — drop it so agent.json written by that
    // script still parses.
    const BOM_CHAR = String.fromCharCode(0xfeff);
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const withoutBom = raw.startsWith(BOM_CHAR) ? raw.slice(1) : raw;
    return JSON.parse(withoutBom).agentToken || null;
  } catch {
    return null;
  }
}

function connect(port) {
  const centralUrl = process.env.CENTRAL_SERVER_URL;
  const agentToken = readAgentToken();
  if (!centralUrl || !agentToken) {
    console.log('[agent] CENTRAL_SERVER_URL hoặc backend/config/agent.json chưa cấu hình — bỏ qua kết nối relay (node local vẫn chạy được khi gọi trực tiếp qua trình duyệt local).');
    return;
  }

  const wsUrl = centralUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/agent-ws';
  const ws = new WebSocket(wsUrl);
  let heartbeatTimer = null;

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'register', agentToken }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'registered') {
      console.log(`[agent] Đã kết nối tới server trung tâm (agentId=${msg.agentId}).`);
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, HEARTBEAT_INTERVAL_MS);
      return;
    }

    if (msg.type === 'error') {
      console.error('[agent] Server từ chối kết nối:', msg.message);
      ws.close();
      return;
    }

    if (msg.type === 'run') {
      const { runId, workflow, startNodeId, resume } = msg;
      const send = (event, data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'event', runId, event, data }));
      };
      try {
        await executor.run(workflow, UPLOADS_DIR, send, startNodeId ?? null, !!resume);
        send('done', { success: true });
      } catch (err) {
        send('error', { success: false, error: err.message });
      }
      return;
    }

    // http-proxy-request: an auxiliary REST call relayed from the server (browse-folder, capcut
    // restart, resize-upload run...) — replay it against our OWN Express app via loopback fetch
    // so every existing route handler (express.json(), res.sendFile(), SSE res.write() chains)
    // runs completely unmodified, then stream the real response back the same way it arrived.
    if (msg.type === 'http-proxy-request') {
      const { reqId, method, path: urlPath, body } = msg;
      (async () => {
        let response;
        try {
          response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-sf-internal-token': INTERNAL_RELAY_TOKEN },
            body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
          });
        } catch (err) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'http-proxy-error', reqId, message: err.message }));
          return;
        }
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: 'http-proxy-response-start', reqId, status: response.status,
          contentType: response.headers.get('content-type'),
        }));
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'http-proxy-response-chunk', reqId, chunkBase64: Buffer.from(value).toString('base64') }));
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'http-proxy-response-end', reqId }));
      })();
    }
  });

  ws.on('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(() => connect(port), RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[agent] Lỗi kết nối tới server trung tâm:', err.message);
  });
}

module.exports = { connect, INTERNAL_RELAY_TOKEN };
