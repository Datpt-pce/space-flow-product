const express = require('express');
const path = require('path');
const crypto = require('crypto');
const executor = require('../engine/executor');
const { getManifest } = require('../utils/nodeManifests');
const db = require('../db');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function hasLocalOnlyNode(workflow) {
  return (workflow.nodes || []).some(n => getManifest(n.type)?.runsOn === 'local');
}

// Node types this workflow uses that `user` hasn't been granted (Admin Dashboard permission
// editor — see backend/db/index.js user_node_permissions). Admins always pass (empty array).
function disallowedNodeTypes(workflow, user) {
  if (user.role === 'admin') return [];
  const allowed = new Set(
    db.prepare('SELECT node_type FROM user_node_permissions WHERE user_id = ?').all(user.id).map(r => r.node_type)
  );
  const used = new Set((workflow.nodes || []).map(n => n.type));
  return [...used].filter(t => !allowed.has(t));
}

router.post('/', async (req, res) => {
  const { workflow, startNodeId, resume } = req.body;
  if (!workflow) return res.status(400).json({ error: 'Missing workflow' });

  const disallowed = disallowedNodeTypes(workflow, req.user);
  if (disallowed.length > 0) {
    return res.status(403).json({
      error: `Bạn chưa được cấp quyền dùng node: ${disallowed.join(', ')} — liên hệ Admin để được cấp quyền.`,
    });
  }

  // SPACE_FLOW_MODE=agent (mặc định) chạy mọi node tại chỗ, y hệt hành vi hiện tại. Khi
  // SPACE_FLOW_MODE=server, node local-only (CapCut/ComfyUI-local/Ollama...) không được
  // chạy trực tiếp trên server dùng chung — phải relay sang agent của người bấm Run qua
  // WebSocket (backend/ws/agentServer.js).
  const mode = process.env.SPACE_FLOW_MODE || 'agent';
  const needsAgent = mode === 'server' && hasLocalOnlyNode(workflow);

  let agentServer = null;
  if (needsAgent) {
    agentServer = require('../ws/agentServer');
    if (!agentServer.isAgentOnline(req.user.id)) {
      return res.status(409).json({
        error: 'Workflow này có node chỉ chạy được trên máy local (CapCut/ComfyUI/Ollama...) ' +
          'nhưng agent của bạn hiện không online — mở agent trên máy bạn rồi thử lại.',
      });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Keep the SSE connection alive across long silent stretches (e.g. a single
  // ffmpeg/gifsicle call that runs for several minutes without any context.log/
  // progress() in between). Without this, a fully idle stream through Cloudflare
  // Tunnel (or any reverse proxy) gets dropped as idle, surfacing as a generic
  // "network error" on the frontend even though the run was still in progress —
  // see docs/issues/2026-08-21-sse-heartbeat-cloudflare-idle-timeout.md.
  //
  // Two Node v24.15.0 quirks verified by hand, worth remembering if this block
  // is ever touched again:
  //  1. setInterval, anywhere on this request, silently stops firing once
  //     express.json() has parsed a body — only a chained setTimeout keeps
  //     ticking, hence the recursive scheduleHeartbeat() below.
  //  2. Listening with req.on('close', ...) — not res.on — after that same
  //     body parse has consumed the request stream kills every later
  //     setTimeout/setInterval on the request, heartbeat included, with zero
  //     error. res.on('close', ...) reports the identical disconnect without
  //     the bug.
  let heartbeatTimer = null;
  let heartbeatStopped = false;
  function scheduleHeartbeat() {
    heartbeatTimer = setTimeout(() => {
      if (heartbeatStopped) return;
      if (!res.writableEnded) res.write(': heartbeat\n\n');
      scheduleHeartbeat();
    }, 15000);
  }
  scheduleHeartbeat();
  const stopHeartbeat = () => { heartbeatStopped = true; clearTimeout(heartbeatTimer); };
  res.on('close', stopHeartbeat);

  // Admin Dashboard usage tracking (Phần 3): 1 row per node-execution attempt, logged HERE
  // (not inside executor.js) so it always lands in *this* process's DB under the real,
  // authenticated req.user.id — whether the node actually ran on this server (direct branch
  // below) or was relayed to the caller's own agent (nodeComplete/nodeError events are
  // forwarded back through this same `send`/`onEvent` either way, so one wrap covers both).
  const nodeTypeById = Object.fromEntries((workflow.nodes || []).map(n => [n.id, n.type]));
  const logNodeUsage = db.prepare('INSERT INTO usage_events (id, user_id, kind, ref, status) VALUES (?, ?, ?, ?, ?)');
  const send = (event, data) => {
    // Skip pinned/disabled nodeComplete — those are passthrough, not a real execution attempt
    // (executor.js marks them with `pinned`/`disabled` on the event data).
    if ((event === 'nodeComplete' && !data.pinned && !data.disabled) || event === 'nodeError') {
      const nodeType = nodeTypeById[data.nodeId];
      if (nodeType) logNodeUsage.run(crypto.randomUUID(), req.user.id, 'node', nodeType, event === 'nodeComplete' ? 'success' : 'error');
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (needsAgent) {
      // Pure pass-through: the agent's own executor.run() already emits a terminal
      // done/error event (backend/agent/connection.js mirrors this same route's shape),
      // forwarded to `send` via onEvent before sendRun resolves/rejects — don't re-send it.
      await agentServer.sendRun(req.user.id, { workflow, startNodeId: startNodeId ?? null, resume: !!resume }, send);
    } else {
      await executor.run(workflow, UPLOADS_DIR, send, startNodeId ?? null, !!resume, req.user.id);
      send('done', { success: true });
    }
  } catch (err) {
    // Agent-path errors reported by the agent itself were already forwarded via onEvent
    // above; only send here for the direct-run path or a relay-transport failure (agent
    // dropped mid-run, sendRun rejected before any event ever arrived).
    if (!needsAgent || !err.__forwarded) send('error', { success: false, error: err.message });
  }

  stopHeartbeat();

  res.end();
});

module.exports = router;
