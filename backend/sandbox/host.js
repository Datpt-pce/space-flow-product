// Sandbox Host — Platform Core Phase 0.2 spike skeleton.
// See specs/space-flow-master-plan/00-platform-core.md Phase 0.2 and
// docs/decisions/0008-custom-node-sandbox-architecture.md.
//
// SPIKE SCOPE: spawns backend/sandbox/worker.js as a plain child process and speaks the
// IPC protocol in ipc-protocol.js. This proves the IPC round-trip and gives Custom Node
// Platform Phase 3 (specs/space-flow-master-plan/01-custom-node-platform.md) a concrete
// process-spawn + stdin/stdout-JSON-line contract to wrap with real OS-level isolation
// (bwrap — see docs/decisions/0011-bubblewrap-feasibility-spike.md) and capability
// enforcement. This file does NOT sandbox anything yet — the child process runs with the
// same privileges as its parent.

const path = require('path');
const { spawn } = require('child_process');
const { LineDecoder, MESSAGE_TYPES } = require('./ipc-protocol');

const WORKER_PATH = path.join(__dirname, 'worker.js');

function runInSandbox({ executorPath, inputs, config, capabilityGrants = {}, onLog, onProgress, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });

    let settled = false;
    let outputs;
    let errorMsg;
    let stderr = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Sandbox worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const decoder = new LineDecoder((msg) => {
      if (msg.type === MESSAGE_TYPES.LOG) onLog && onLog(msg);
      else if (msg.type === MESSAGE_TYPES.PROGRESS) onProgress && onProgress(msg);
      else if (msg.type === MESSAGE_TYPES.OUTPUTS) outputs = msg.outputs;
      else if (msg.type === MESSAGE_TYPES.ERROR) errorMsg = msg.message;
    });

    child.stdout.on('data', (chunk) => decoder.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (errorMsg) return reject(new Error(errorMsg));
      if (code !== 0) return reject(new Error(`Sandbox worker exited ${code}: ${stderr}`));
      resolve(outputs);
    });

    child.stdin.write(JSON.stringify({ executorPath, inputs, config, capabilityGrants }));
    child.stdin.end();
  });
}

module.exports = { runInSandbox };
