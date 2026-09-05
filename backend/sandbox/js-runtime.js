// Sandbox Host JS runtime — Custom Node Platform Phase 3
// (specs/space-flow-master-plan/01-custom-node-platform.md), JS track.
//
// Runs a PRE-BUNDLED executor (see bundleExecutor()) inside a fresh isolated-vm isolate with a
// memory limit — the "lớp cô lập bổ sung" (additional isolation layer) the plan calls for on
// top of the process/bwrap isolation backend/sandbox/host-bwrap.js already provides. This is
// explicitly NOT a hard security boundary by itself (see
// docs/decisions/0011-bubblewrap-feasibility-spike.md and 01-custom-node-platform.md §3's
// warning about isolated-vm's own known type-confusion history) — OS-level process/namespace
// isolation remains the primary boundary; this adds V8-level memory/timeout enforcement and
// removes ambient access to `require`/`process`/`fs` inside the isolate itself.
//
// WHY BUNDLING IS REQUIRED (not optional): a bare isolated-vm isolate has no Node module
// system at all — no require(), no process, no fs. An executor's own `require('../../backend/
// utils/items')` (or an npm dependency like `luxon`) would throw immediately. bundleExecutor()
// uses esbuild to inline every reachable dependency into one self-contained script BEFORE it
// ever reaches the isolate — by the time code runs here, there is nothing left to require.
//
// CONTEXT SCOPE NOTE: the 3 nodes converted for this Phase (set, filter, date-time) all have
// signature `execute(inputs, config)` — none of them use a 3rd `context` argument. This
// runtime therefore does not yet bridge context.log/scratchDir/http/secret across the isolate
// boundary — that bidirectional Reference bridge is real work with no test subject needing it
// yet, and is explicitly Custom Node Platform Phase 4 scope ("Capability-Mediated Context SDK
// v2"), not invented speculatively here.

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ivm = require('isolated-vm');

const GLOBAL_EXPORT_NAME = '__sfpkg_export';

// Bundles a CommonJS executor entry (and everything it require()s, following relative paths
// and npm packages) into a single IIFE script with no external requires left, assigning the
// executor's `module.exports` value to a global named GLOBAL_EXPORT_NAME. `path` is aliased to
// path-browserify (pure string manipulation, no real filesystem access — see
// backend/utils/items.js's path.basename() usage, the concrete case this was built for) so
// executors that only do pure path-string work don't need a real Node `path` module inside
// the isolate. Any OTHER Node built-in (fs, child_process, os, net...) is deliberately left
// unresolvable — an executor that touches one of those directly (bypassing context) will fail
// to bundle, which is the intended signal: it cannot run in this isolation lane as-is.
function bundleExecutor(executorPath) {
  const outFile = path.join(os.tmpdir(), `sfpkg-bundle-${crypto.randomUUID()}.js`);
  const esbuildBin = require.resolve('esbuild/bin/esbuild');
  execFileSync(process.execPath, [
    esbuildBin,
    executorPath,
    '--bundle',
    '--format=iife',
    `--global-name=${GLOBAL_EXPORT_NAME}`,
    '--platform=node',
    '--alias:path=path-browserify',
    '--log-level=error',
    `--outfile=${outFile}`,
  ], { windowsHide: true, stdio: 'pipe', cwd: path.join(__dirname, '..') }); // cwd=backend/ so the path-browserify alias resolves against backend/node_modules

  const source = fs.readFileSync(outFile, 'utf8');
  fs.unlinkSync(outFile);
  return source;
}

// runInIsolate({ bundleSource, inputs, config, memoryLimitMB, timeoutMs }) -> Promise<outputs>
async function runInIsolate({ bundleSource, inputs, config, memoryLimitMB = 128, timeoutMs = 30000 }) {
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMB });
  try {
    const context = await isolate.createContext();
    await context.global.set('global', context.global.derefInto());

    const script = await isolate.compileScript(bundleSource);
    await script.run(context);

    const fnRef = await context.global.get(GLOBAL_EXPORT_NAME, { reference: true });
    if (fnRef.typeof !== 'function') {
      throw new Error(`Bundle did not export a function as ${GLOBAL_EXPORT_NAME} — check the executor's module.exports shape.`);
    }

    return await fnRef.apply(undefined, [inputs, config], {
      arguments: { copy: true },
      result: { promise: true, copy: true },
      timeout: timeoutMs,
    });
  } finally {
    if (!isolate.isDisposed) isolate.dispose();
  }
}

module.exports = { bundleExecutor, runInIsolate, GLOBAL_EXPORT_NAME };
