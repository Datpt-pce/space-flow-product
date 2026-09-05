// Test for Custom Node Platform Phase 5/6 follow-up (specs/space-flow-master-plan/
// 01-custom-node-platform.md): backend/registry/install.js's getApprovedPaths/setApprovedPaths —
// the DB-level half of real approvedPaths for capabilities.filesystem: "user-approved-path"
// packages (the HTTP route in backend/routes/local-nodes.js and the actual bwrap --bind wiring
// in backend/sandbox/py-runtime.js are exercised elsewhere; bwrap only runs on Linux, so this
// file sticks to what's testable on native Windows dev too).
//
// Run with: node backend/registry/install.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pack } = require('./sfpkg');
const { install, getApprovedPaths, setApprovedPaths } = require('./install');
const db = require('../db');

const FIXTURE_DIR = path.join(__dirname, '__fixtures__', 'date-time-v2');

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

function cleanupInstall(packageId, version, installPath) {
  db.prepare('DELETE FROM node_installations WHERE package_id = ? AND version = ?').run(packageId, version);
  const packageRoot = path.dirname(installPath);
  if (fs.existsSync(packageRoot)) fs.rmSync(packageRoot, { recursive: true, force: true });
}

async function main() {
  await check('getApprovedPaths() defaults to empty for a freshly installed package', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-install-test-'));
    let installed = null;
    try {
      const outFile = path.join(scratchDir, 'date-time.sfpkg');
      await pack({ sourceDir: FIXTURE_DIR, outFile });
      installed = install({ archiveFile: outFile });
      assert.deepStrictEqual(getApprovedPaths(installed.packageId, installed.version), []);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      if (installed) cleanupInstall(installed.packageId, installed.version, installed.installPath);
    }
  });

  await check('setApprovedPaths() persists and getApprovedPaths() reads it back', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-install-test-'));
    let installed = null;
    try {
      const outFile = path.join(scratchDir, 'date-time.sfpkg');
      await pack({ sourceDir: FIXTURE_DIR, outFile });
      installed = install({ archiveFile: outFile });

      const approved = [scratchDir];
      setApprovedPaths(installed.packageId, installed.version, approved);
      assert.deepStrictEqual(getApprovedPaths(installed.packageId, installed.version), approved);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      if (installed) cleanupInstall(installed.packageId, installed.version, installed.installPath);
    }
  });

  await check('setApprovedPaths() throws for an installation that does not exist', async () => {
    assert.throws(() => setApprovedPaths('nonexistent-package', '1.0.0', ['/tmp']), /No installation found/);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
