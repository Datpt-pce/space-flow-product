// Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md): agentServer.js had NO
// test at all before this — real, production-critical WebSocket relay code (plan's own risk
// callout: "đụng code production đang chạy thật, tách riêng"), only ever exercised through actual
// SPACE_FLOW_MODE=server usage. Written specifically because this file's `pendingRuns` ->
// `pendingJobs` generalization + new sendJob()/type:'video-job' needed proof the EXISTING
// sendRun()/type:'run' behavior stayed byte-for-byte identical, not just a code read.
//
// Spins up a real http server + attachAgentServer() + a real `ws` client acting as a fake agent
// (registering with a real agents/users DB row) — no mocked WebSocket, the actual wire protocol.
//
// Run with: node backend/ws/agentServer.test.js

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const WebSocket = require('ws');
const db = require('../db');

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Connects a fake agent and resolves once the server has actually registered it (isAgentOnline
// true) — a plain 'open' event fires before the register round-trip completes, which would race
// sendRun/sendJob below.
function connectFakeAgent(port, agentToken, isAgentOnline, userId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'register', agentToken })));
    ws.on('error', reject);
    const poll = setInterval(() => {
      if (isAgentOnline(userId)) {
        clearInterval(poll);
        resolve(ws);
      }
    }, 20);
    setTimeout(() => { clearInterval(poll); reject(new Error('agent never came online within 3s')); }, 3000);
  });
}

async function main() {
  const { attachAgentServer, isAgentOnline, sendRun, sendJob, cancelJob } = require('./agentServer');

  const userId = crypto.randomUUID();
  const agentToken = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(userId, `agentserver-test-sub-${userId}`, `agentserver-test-${userId}@space-flow.local`, 'Agent Test User', 'member');
  db.prepare('INSERT INTO agents (id, user_id, secret_hash, name) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, hashToken(agentToken), 'test-agent');

  const httpServer = http.createServer();
  attachAgentServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  let fakeAgent;
  try {
    fakeAgent = await connectFakeAgent(port, agentToken, isAgentOnline, userId);

    await check('sendRun()/type:\'run\' (back-compat wrapper): fake agent gets a real "run" message, event stream + resolution round-trip unchanged', async () => {
      fakeAgent.removeAllListeners('message');
      fakeAgent.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== 'run') return;
        assert.deepStrictEqual(msg.workflow, { nodes: [], edges: [] });
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'nodeComplete', data: { nodeId: 'n1' } }));
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'done', data: { success: true } }));
      });

      const events = [];
      await sendRun(userId, { workflow: { nodes: [], edges: [] }, startNodeId: null, resume: false }, (event, data) => events.push({ event, data }));
      assert.deepStrictEqual(events, [
        { event: 'nodeComplete', data: { nodeId: 'n1' } },
        { event: 'done', data: { success: true } },
      ]);
    });

    await check('sendJob() with type:\'video-job\': fake agent gets it correlated by runId, progress + done events flow back, promise resolves', async () => {
      fakeAgent.removeAllListeners('message');
      fakeAgent.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== 'video-job') return;
        assert.strictEqual(msg.kind, 'proxy');
        assert.deepStrictEqual(msg.payload, { path: '/fake/source.mp4' });
        assert.ok(msg.runId, 'expected a runId correlation field even for a non-run job type');
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'progress', data: { percent: 50 } }));
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'done', data: { success: true, result: { outPath: '/fake/proxy.mp4' } } }));
      });

      const events = [];
      await sendJob(userId, { type: 'video-job', kind: 'proxy', payload: { path: '/fake/source.mp4' } }, (event, data) => events.push({ event, data }));
      assert.deepStrictEqual(events, [
        { event: 'progress', data: { percent: 50 } },
        { event: 'done', data: { success: true, result: { outPath: '/fake/proxy.mp4' } } },
      ]);
    });

    await check('sendJob() with a presetRunId (Phase 4: video-render.js uses its own DB job id as the wire runId): the id round-trips unchanged', async () => {
      fakeAgent.removeAllListeners('message');
      const presetRunId = crypto.randomUUID();
      fakeAgent.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== 'video-job') return;
        assert.strictEqual(msg.runId, presetRunId, 'expected the caller-supplied id, not a fresh random one');
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'done', data: { success: true } }));
      });
      await sendJob(userId, { type: 'video-job', kind: 'render', payload: {} }, () => {}, presetRunId);
    });

    await check('output-chunk event (Phase 4 render-output streaming) forwards through onEvent like any other event name, with no special-casing needed in agentServer.js', async () => {
      fakeAgent.removeAllListeners('message');
      fakeAgent.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== 'video-job') return;
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'output-chunk', data: { chunkBase64: 'aGVsbG8=' } }));
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'output-chunk', data: { chunkBase64: 'd29ybGQ=' } }));
        fakeAgent.send(JSON.stringify({ type: 'event', runId: msg.runId, event: 'done', data: { success: true } }));
      });
      const chunks = [];
      await sendJob(userId, { type: 'video-job', kind: 'render', payload: {} }, (event, data) => {
        if (event === 'output-chunk') chunks.push(data.chunkBase64);
      });
      assert.deepStrictEqual(chunks, ['aGVsbG8=', 'd29ybGQ=']);
    });

    await check('foreign socket cannot complete another owner\'s render even with its runId', async () => {
      const foreign = new WebSocket(`ws://127.0.0.1:${port}/agent-ws`);
      await new Promise((resolve, reject) => { foreign.once('open', resolve); foreign.once('error', reject); });
      try {
        fakeAgent.removeAllListeners('message');
        fakeAgent.once('message', raw => {
          const job = JSON.parse(raw);
          foreign.send(JSON.stringify({ type: 'event', runId: job.runId, event: 'done', data: { result: 'foreign' } }));
          setTimeout(() => fakeAgent.send(JSON.stringify({ type: 'event', runId: job.runId, event: 'done', data: { result: 'owner' } })), 100);
        });
        const results = [];
        await sendJob(userId, { type: 'video-job', kind: 'render', payload: {} }, (_event, data) => results.push(data.result));
        assert.deepStrictEqual(results, ['owner']);
      } finally { foreign.close(); }
    });

    await check('output write callback failure rejects the job and cancels its worker without crashing the server', async () => {
      fakeAgent.removeAllListeners('message');
      let cancel;
      const cancelled = new Promise(resolve => { cancel = resolve; });
      fakeAgent.on('message', raw => {
        const job = JSON.parse(raw);
        if (job.type === 'cancel-job') cancel(job);
        else if (job.type === 'video-job') fakeAgent.send(JSON.stringify({ type: 'event', runId: job.runId, event: 'output-chunk', data: { chunkBase64: 'YQ==' } }));
      });
      await assert.rejects(() => sendJob(userId, { type: 'video-job', kind: 'render', payload: {} }, () => { throw new Error('Disk full'); }), /Disk full/);
      assert.equal((await cancelled).type, 'cancel-job');
    });

    await check('cancelJob(userId, runId): delivers a real type:\'cancel-job\' message with that runId to the agent', async () => {
      const runId = crypto.randomUUID();
      const received = await new Promise((resolve) => {
        fakeAgent.removeAllListeners('message');
        fakeAgent.once('message', (raw) => resolve(JSON.parse(raw)));
        const sent = cancelJob(userId, runId);
        assert.strictEqual(sent, true);
      });
      assert.deepStrictEqual(received, { type: 'cancel-job', runId });
    });

    await check('cancelJob(userId, runId) returns false (not a throw) when the agent is offline — nothing to cancel', async () => {
      const sent = cancelJob(crypto.randomUUID(), crypto.randomUUID());
      assert.strictEqual(sent, false);
    });

    await check('agent disconnecting mid-job rejects the pending promise instead of hanging forever', async () => {
      fakeAgent.removeAllListeners('message');
      // Never reply — simulate a crash by closing the socket right after the job arrives.
      fakeAgent.once('message', () => fakeAgent.close());

      await assert.rejects(
        () => sendJob(userId, { type: 'video-job', kind: 'proxy', payload: {} }, () => {}),
        /mất kết nối/,
      );
      // Reconnect for isAgentOnline-dependent cleanup below to still make sense, and so a 4th
      // check could be added later without needing its own fresh connection boilerplate.
      fakeAgent = await connectFakeAgent(port, agentToken, isAgentOnline, userId);
    });
  } finally {
    if (fakeAgent) fakeAgent.close();
    await new Promise((resolve) => httpServer.close(resolve));
    db.prepare('DELETE FROM agents WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
