const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const executor = require('../engine/executor');
const { runVideoJob, cancelRenderJob } = require('./videoJobs');

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

const OUTPUT_CHUNK_SIZE = 256 * 1024;

// streamFileBack(filePath, send) -> Promise<void> — reads a finished render output in
// OUTPUT_CHUNK_SIZE pieces and emits each as an 'output-chunk' event (base64, same convention
// middleware/relayToAgent.js's binary-body chunking already established) BEFORE the terminal
// 'done' — backend/routes/video-render.js's onEvent handler reassembles them into its own
// uploads-dir file as they arrive. A real stream (not fs.readFileSync) on purpose: a render
// output can be well beyond a quick thumbnail/proxy in size, unlike every other video-job kind.
async function streamFileBack(filePath, send) {
  const stream = fs.createReadStream(filePath, { highWaterMark: OUTPUT_CHUNK_SIZE });
  for await (const chunk of stream) {
    await send('output-chunk', { chunkBase64: chunk.toString('base64') });
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

    // video-job: Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md) —
    // same `type:'event'`/runId event-correlation shape as `run` above (backend/ws/agentServer.js
    // generalized sendRun() into sendJob() precisely so this needed no new wire concept), kind
    // dispatch (probe/thumbnail/proxy/render) handled by backend/agent/videoJobs.js.
    if (msg.type === 'video-job') {
      const { runId, kind, payload } = msg;
      const send = (event, data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'event', runId, event, data }));
      };
      // Phase 4: the central server gave no `outputPath` for a render — this agent invents its
      // own temp path (videoJobs.js's runVideoJob) since the server has no directory that's
      // meaningful on THIS (possibly different) machine. Streaming the finished file back in
      // chunks (reusing the generic 'event' relay — see agentServer.js's own comment) is the fix
      // for the architecture bug backend/routes/video-assets.js's header comment flagged: an
      // agent-written outPath was previously just assumed to already sit on the SERVER's disk,
      // which is only ever true in SPACE_FLOW_MODE=agent (single process) — never for a real
      // remote agent.
      const shouldStreamOutputBack = (kind === 'render' && !payload.outputPath)
        || (['thumbnail', 'proxy'].includes(kind) && !payload.outPath);
      try {
        const result = await runVideoJob(kind, payload, (percent) => send('progress', { percent }), runId);
        if (shouldStreamOutputBack) {
          try {
            await streamFileBack(result.outputPath || result.outPath, (event, data) => new Promise((resolve, reject) => {
              if (ws.readyState !== WebSocket.OPEN) return reject(new Error('Agent disconnected during output transfer'));
              ws.send(JSON.stringify({ type: 'event', runId, event, data }), err => err ? reject(err) : resolve());
            }));
          } finally {
            fs.unlink(result.outputPath || result.outPath, () => {});
          }
        }
        send('done', { success: true, result });
      } catch (err) {
        send('error', { success: false, error: err.message, cancelled: !!err.cancelled });
      }
      return;
    }

    if (msg.type === 'cancel-job') {
      cancelRenderJob(msg.runId);
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
module.exports.streamFileBack = streamFileBack; // exported for backend/agent/connection.test.js only
