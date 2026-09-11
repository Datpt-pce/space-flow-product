// Sandbox Host — bwrap-wrapped variant, Platform Core Phase 0.3 vertical-slice spike.
// See specs/space-flow-master-plan/00-platform-core.md Phase 0.3 and
// docs/decisions/0011-bubblewrap-feasibility-spike.md.
//
// SPIKE SCOPE: extends backend/sandbox/host.js (Phase 0.2, plain child_process.spawn — no
// isolation) by launching the same worker.js under `bwrap`, proving real OS-level mount/PID/
// user-namespace isolation end to end, not just the IPC message shape. Only runs where bwrap
// is available (Linux — the node:22-bookworm container used by the local agent; see
// docs/decisions/0011-bubblewrap-feasibility-spike.md for the Docker seccomp caveat this
// depends on). Capability enforcement (which paths get bind-mounted, network policy) is still
// Custom Node Platform Phase 3/4 — this hard-codes one minimal read-only rootfs + one scratch
// dir for the spike only.

const path = require('path');
const { spawn } = require('child_process');
const { LineDecoder, MESSAGE_TYPES } = require('./ipc-protocol');

const WORKER_PATH = path.join(__dirname, 'worker.js');

// repoRoot is bound READ-ONLY so worker.js/ipc-protocol.js/the target executor.js (all
// inside the repo tree) can still be require()'d — the point of this spike is proving
// arbitrary OTHER host paths are unreachable, not that the repo itself is invisible.
function buildBwrapArgs(scratchDir, nodeBin, repoRoot) {
  return [
    '--unshare-user', '--unshare-pid', '--unshare-net', '--die-with-parent',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/usr/local', '/usr/local',
    '--ro-bind', repoRoot, repoRoot,
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', scratchDir, scratchDir,
    '--chdir', scratchDir,
    '--',
    nodeBin, WORKER_PATH,
  ];
}

// scratchDir: the only host path bind-mounted read-write into the sandbox. repoRoot is
// bound read-only (see buildBwrapArgs). Anything outside {repoRoot, /usr, /usr/local,
// scratchDir, /proc, /dev, /tmp} must be unreachable from inside — that's what
// security-corpus/bwrap-isolation.test.js asserts. nodeBin: absolute path to the node
// executable inside the container (process.execPath on the host running this).
function runInSandboxBwrap({ executorPath, inputs, config, capabilityGrants = {}, scratchDir, repoRoot = path.resolve(__dirname, '..', '..'), nodeBin = process.execPath, onLog, onProgress, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const args = buildBwrapArgs(scratchDir, nodeBin, repoRoot);
    const child = spawn('bwrap', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let settled = false;
    let outputs;
    let errorMsg;
    let stderr = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`bwrap sandbox worker timed out after ${timeoutMs}ms`));
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
      if (code !== 0) return reject(new Error(`bwrap sandbox worker exited ${code}: ${stderr}`));
      resolve(outputs);
    });

    child.stdin.write(JSON.stringify({ executorPath, inputs, config, capabilityGrants }));
    child.stdin.end();
  });
}

module.exports = { runInSandboxBwrap, buildBwrapArgs };
