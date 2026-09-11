// Registry package dependency installation — Custom Node Platform Phase 5/6 follow-up
// (specs/space-flow-master-plan/01-custom-node-platform.md, see
// docs/issues/2026-08-28-sfpkg-npm-dependency-not-installed.md). install() previously only
// extracted the .sfpkg archive — nothing materialized a package's declared npm/pip dependencies
// into the install directory, so any package beyond pure built-in Node.js/stdlib Python failed
// to run once installed. installDependencies() closes that gap for both tracks:
//  - JS: package.json -> node_modules. esbuild's normal --platform=node resolution (see
//    backend/sandbox/js-runtime.js's bundleExecutor) already walks up from the entry file's own
//    directory, so nothing else needs to change once node_modules exists next to it.
//  - Python: requirements.txt -> .pydeps/. Not on sys.path by default — wired into PYTHONPATH by
//    backend/sandbox/py-runtime.js's runPythonSandboxed (pythonPath option), which sits inside
//    the already-bwrap-bound install directory so no extra mount is needed.
//
// Called from install() (real installs, backend/registry/install.js) and from Test Console's
// draft-test endpoint (backend/routes/local-nodes.js) so a draft under active development
// behaves the same as an installed package.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findPythonExe } = require('../utils/pythonExe');

function runCapture(cmd, args, opts) {
  try {
    // shell:true is required on Windows to spawn .cmd/.bat files at all (Node blocks direct
    // spawnSync of them since the CVE-2024-27980 fix — plain execFileSync('npm.cmd', ...)
    // fails with EINVAL). Safe here because every arg passed through this module is a fixed
    // literal (npm/pip flags), never user-controlled input.
    execFileSync(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
}

// node_modules already present is treated as "already installed" — a cheap re-run guard for
// Test Console (hit on every Run Test click), not a lockfile-diff cache. A user who edits
// package.json's dependencies mid-draft must delete node_modules themselves to pick up the
// change; acceptable for a local dev-only build step, not the real install() path (which always
// starts from a fresh extracted directory).
function installJsDependencies(targetDir) {
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;
  if (fs.existsSync(path.join(targetDir, 'node_modules'))) return;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`package.json is not valid JSON: ${err.message}`);
  }
  if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) return;

  // --ignore-scripts: Custom Node Platform Phase 9 hardening (specs/space-flow-master-plan/
  // 01-custom-node-platform.md, Definition of Done §6 "dependency poisoning có test") — without
  // this, npm runs preinstall/install/postinstall lifecycle scripts from EVERY dependency's own
  // package.json directly on the host, with full host privileges, before the sandboxed runtime
  // (bwrap/isolated-vm) ever starts. A malicious transitive dependency's postinstall is the
  // textbook supply-chain attack this closes — see dependencies.test.js's "dependency poisoning"
  // case for the regression proving a postinstall script no longer runs.
  runCapture('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: targetDir });
}

function pyVendorDir(targetDir) {
  return path.join(targetDir, '.pydeps');
}

function installPyDependencies(targetDir) {
  const reqPath = path.join(targetDir, 'requirements.txt');
  if (!fs.existsSync(reqPath)) return;
  if (!fs.readFileSync(reqPath, 'utf8').trim()) return;
  const vendorDir = pyVendorDir(targetDir);
  if (fs.existsSync(vendorDir)) return;

  const pythonExe = findPythonExe(targetDir);
  if (!pythonExe) throw new Error('requirements.txt present but no Python interpreter found on PATH');
  // --only-binary=:all: — same Phase 9 hardening reasoning as npm's --ignore-scripts above: a
  // source distribution's setup.py runs arbitrary code on the host at install time (pip's
  // equivalent of an npm postinstall script). Forcing wheel-only installs means a dependency with
  // no prebuilt wheel for this platform fails cleanly instead of executing setup.py — a real
  // availability tradeoff for packages that only ship source, accepted deliberately here.
  runCapture(pythonExe, [
    '-m', 'pip', 'install',
    '--disable-pip-version-check', '--no-input',
    '--only-binary=:all:',
    '-r', reqPath,
    '--target', vendorDir,
  ], { cwd: targetDir });
}

// installDependencies(targetDir) — materializes a package's declared npm/pip deps in-place.
// Throws with the underlying npm/pip stderr on failure; caller decides rollback policy.
function installDependencies(targetDir) {
  installJsDependencies(targetDir);
  installPyDependencies(targetDir);
}

module.exports = { installDependencies, pyVendorDir };
