// Initial namespace-isolation security corpus — Platform Core Phase 0.3
// (specs/space-flow-master-plan/00-platform-core.md), Custom Node vertical-slice spike.
//
// Requires `bwrap` on PATH and a Linux kernel where it can create unprivileged namespaces —
// see docs/decisions/0011-bubblewrap-feasibility-spike.md (run this inside the
// node:22-bookworm container with `--security-opt seccomp=unconfined`, exactly like that
// spike; it does not run on native Windows).
//
// Run with: node backend/sandbox/security-corpus/bwrap-isolation.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');
const { runInSandboxBwrap } = require('../host-bwrap');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const executorPath = path.join(REPO_ROOT, 'nodes', 'set', 'execute.js');
const fsEscapeExecutorPath = path.join(__dirname, 'fixtures', 'fs-escape', 'execute.js');
const pidNamespaceExecutorPath = path.join(__dirname, 'fixtures', 'pid-namespace', 'execute.js');

function checkBwrapAvailable() {
  try {
    execSync('bwrap --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!checkBwrapAvailable()) {
    console.log('SKIP — bwrap not on PATH. This corpus only runs on Linux with bubblewrap ' +
      'installed (see docs/decisions/0011-bubblewrap-feasibility-spike.md for how to run it ' +
      'via Docker on Windows).');
    return;
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-bwrap-corpus-'));
  const secretPath = '/root/secret-outside-scratch.txt';
  fs.writeFileSync(secretPath, 'TOP-SECRET-SHOULD-NOT-BE-READABLE');

  let pass = 0;
  let fail = 0;
  const check = (label, fn) => {
    try {
      fn();
      pass++;
      console.log(`PASS — ${label}`);
    } catch (err) {
      fail++;
      console.error(`FAIL — ${label}: ${err.message}`);
    }
  };

  // Control: normal round-trip still works under bwrap + read-only repo bind-mount.
  const inputs = { items: [{ json: { a: 1 } }] };
  const config = { mode: 'manual', assignments: [{ name: 'b', type: 'number', value: 42 }], keepOtherFields: true, stripFields: [] };
  const baselineFn = require(executorPath);
  const baseline = await baselineFn(inputs, config);
  const sandboxed = await runInSandboxBwrap({ executorPath, inputs, config, scratchDir });
  check('normal node round-trip matches in-process baseline under bwrap', () => {
    assert.deepStrictEqual(sandboxed, baseline);
  });

  // Control: legitimate read of a repo file (read-only bind) must still succeed —
  // otherwise the isolation test below would be meaningless (everything fails to read).
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  const repoRead = await runInSandboxBwrap({
    executorPath: fsEscapeExecutorPath,
    inputs: { targetPath: packageJsonPath },
    config: {},
    scratchDir,
  });
  check('reading a file inside the read-only repo bind-mount succeeds (sanity control)', () => {
    assert.strictEqual(repoRead.read, true);
  });

  // The actual security assertion: a path outside every bind-mount must be unreachable.
  const escapeAttempt = await runInSandboxBwrap({
    executorPath: fsEscapeExecutorPath,
    inputs: { targetPath: secretPath },
    config: {},
    scratchDir,
  });
  check('reading a file outside the sandbox bind-mounts is blocked (ENOENT)', () => {
    assert.strictEqual(escapeAttempt.read, false, `expected read to fail, got: ${JSON.stringify(escapeAttempt)}`);
    assert.strictEqual(escapeAttempt.errorCode, 'ENOENT');
  });

  // PID namespace: sandboxed worker should be PID 1 (or very low) in its own namespace.
  const pidResult = await runInSandboxBwrap({ executorPath: pidNamespaceExecutorPath, inputs: {}, config: {}, scratchDir });
  check('PID namespace isolation active (sandboxed worker is PID <= 2 in its own namespace)', () => {
    assert.ok(pidResult.pid <= 2, `expected pid <= 2, got ${pidResult.pid}`);
  });

  fs.rmSync(scratchDir, { recursive: true, force: true });
  fs.rmSync(secretPath, { force: true });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
