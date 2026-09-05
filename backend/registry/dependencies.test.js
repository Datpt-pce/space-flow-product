// Test for Custom Node Platform Phase 5/6 follow-up (specs/space-flow-master-plan/
// 01-custom-node-platform.md, docs/issues/2026-08-28-sfpkg-npm-dependency-not-installed.md):
// backend/registry/dependencies.js's installDependencies(), wired into install() (backend/
// registry/install.js). Proves the actual bug is fixed — a .sfpkg with a real npm dependency
// (not just built-in Node.js) runs after install(), which it previously could not.
//
// Uses a `file:./local-greeter-src` dependency (backend/registry/__fixtures__/npm-dep-v1/) so
// `npm install` needs no network access and stays deterministic in CI.
//
// Run with: node backend/registry/dependencies.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { pack } = require('./sfpkg');
const { install } = require('./install');
const db = require('../db');
const { run } = require('../engine/executor');

const FIXTURE_DIR = path.join(__dirname, '__fixtures__', 'npm-dep-v1');
const POISONED_FIXTURE_DIR = path.join(__dirname, '__fixtures__', 'npm-dep-poisoned-v1');

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
  await check('install() runs npm install for a package.json dependency, and the installed package can require() it', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-deps-test-'));
    const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-deps-test-uploads-'));
    let installed = null;
    try {
      const outFile = path.join(scratchDir, 'npm-dep.sfpkg');
      await pack({ sourceDir: FIXTURE_DIR, outFile });
      installed = install({ archiveFile: outFile });

      assert.ok(
        fs.existsSync(path.join(installed.installPath, 'node_modules', 'local-greeter')),
        'expected node_modules/local-greeter to exist after install()'
      );

      const workflow = {
        nodes: [{ id: 'n1', type: `${installed.packageId}@${installed.version}`, config: {} }],
        edges: [],
      };
      const results = await run(workflow, uploadsDir, () => {});
      assert.deepStrictEqual(results.n1, { items: [{ message: 'hello-from-local-dep' }] });
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      if (installed) cleanupInstall(installed.packageId, installed.version, installed.installPath);
    }
  });

  // Custom Node Platform Phase 9 (specs/space-flow-master-plan/01-custom-node-platform.md):
  // "dependency poisoning" hardening — found while writing Phase 9's corpus, not a pre-existing
  // gap this test merely documents: installJsDependencies() ran plain `npm install` with no
  // --ignore-scripts, so ANY dependency's postinstall script executed directly on the host, with
  // full host privileges, before the sandboxed runtime (bwrap/isolated-vm) ever starts — the
  // textbook supply-chain attack. Fixed in backend/registry/dependencies.js; this proves it stays
  // fixed by installing a dependency whose postinstall writes a marker file and asserting that
  // marker never appears, while the dependency itself still installs and works normally.
  await check('installDependencies() does not run a dependency\'s postinstall script (--ignore-scripts), but the dependency itself still installs and works', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-deps-poison-test-'));
    const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-deps-poison-test-uploads-'));
    let installed = null;
    try {
      const outFile = path.join(scratchDir, 'npm-dep-poisoned.sfpkg');
      await pack({ sourceDir: POISONED_FIXTURE_DIR, outFile });
      installed = install({ archiveFile: outFile });

      const depDir = path.join(installed.installPath, 'node_modules', 'local-evil-dep');
      assert.ok(fs.existsSync(depDir), 'expected the dependency itself to still install');
      assert.ok(
        !fs.existsSync(path.join(depDir, 'postinstall-ran.txt')),
        'postinstall script ran — --ignore-scripts is not actually being applied'
      );

      const workflow = {
        nodes: [{ id: 'n1', type: `${installed.packageId}@${installed.version}`, config: {} }],
        edges: [],
      };
      const results = await run(workflow, uploadsDir, () => {});
      assert.deepStrictEqual(results.n1, { items: [{ json: { message: 'hello from local-evil-dep' } }] });
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      if (installed) cleanupInstall(installed.packageId, installed.version, installed.installPath);
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
