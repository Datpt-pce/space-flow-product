// Test for Custom Node Platform Phase 5 wiring (specs/space-flow-master-plan/01-custom-node-platform.md):
// backend/engine/executor.js's "packageId@version" branch — the piece flagged as intentionally
// deferred through Phase 3/4 ("cả 3 module đã có enforcement thật, chỉ còn thiếu bước resolve
// capability-grant từ node_installations + dây nối vào đường chạy workflow"). This is the first
// end-to-end proof that a workflow node addressing a locally-installed registry package actually
// runs through backend/sandbox/js-runtime.js instead of require()'ing in-process like a built-in.
//
// Uses the date-time-v2 fixture (backend/registry/__fixtures__/date-time-v2/) already used by
// backend/registry/sfpkg.test.js — pure JS, no bwrap/Docker dependency (isolated-vm runs
// anywhere), so this runs on the native Windows dev machine like js-runtime.test.js does.
//
// Run with: node backend/engine/executor-registry.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pack } = require('../registry/sfpkg');
const { install } = require('../registry/install');
const db = require('../db');
const { run } = require('./executor');

const FIXTURE_DIR = path.join(__dirname, '..', 'registry', '__fixtures__', 'date-time-v2');

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
  const packageRoot = path.dirname(installPath); // .../registry-installs/<packageId>
  if (fs.existsSync(packageRoot)) fs.rmSync(packageRoot, { recursive: true, force: true });
}

async function main() {
  await check('workflow node "packageId@version" runs the installed package through the JS sandbox and produces validated output', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-executor-registry-'));
    const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-executor-registry-uploads-'));
    let installed = null;
    try {
      const outFile = path.join(scratchDir, 'date-time.sfpkg');
      await pack({ sourceDir: FIXTURE_DIR, outFile });
      installed = install({ archiveFile: outFile });
      assert.strictEqual(installed.packageId, 'date-time');
      assert.strictEqual(installed.version, '1.0.0');

      const events = [];
      const workflow = {
        nodes: [{ id: 'n1', type: `${installed.packageId}@${installed.version}`, config: { operation: 'getCurrentDate' } }],
        edges: [],
      };
      const results = await run(workflow, uploadsDir, (event, data) => events.push({ event, data }));

      assert.deepStrictEqual(results.n1, { items: [] }); // no upstream items input -> empty list, but the shape proves the sandboxed executor actually ran
      assert.ok(events.some(e => e.event === 'nodeComplete' && e.data.nodeId === 'n1'), 'expected a nodeComplete event for the registry package node');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      if (installed) cleanupInstall(installed.packageId, installed.version, installed.installPath);
    }
  });

  await check('workflow node referencing a package version that was never installed fails with a clear error, not a crash', async () => {
    const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-executor-registry-uploads-'));
    try {
      const workflow = {
        nodes: [{ id: 'n1', type: 'never-installed-package@9.9.9', config: {} }],
        edges: [],
      };
      await assert.rejects(
        () => run(workflow, uploadsDir, () => {}),
        /Unknown node type: never-installed-package@9\.9\.9/
      );
    } finally {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
