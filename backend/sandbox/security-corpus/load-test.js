// Custom Node Platform Phase 9 (specs/space-flow-master-plan/01-custom-node-platform.md): "Load
// test nhẹ: N node song song qua Sandbox Host, đo overhead so với in-process cũ." Measures the
// actual isolated-vm overhead for N concurrent executions of the SAME built-in node ('set')
// both in-process (today's real execution path for every built-in) and through the JS Sandbox
// Host track (bundleExecutor + a fresh isolate per run, exactly like backend/engine/executor.js's
// runRegistryPackage does for a real registry package) — a real measurement, not a guess.
//
// This only covers the JS track (isolated-vm) — it runs anywhere including native Windows dev.
// The Python track's overhead (bwrap namespace setup) needs measuring separately on Linux (bwrap
// doesn't run on Windows at all, see host-bwrap.js's own comment) — noted as a follow-up, not
// invented here without being able to actually run it.
//
// This is a measurement report with only a generous sanity ceiling, not a tight pass/fail gate:
// hardware in CI varies run to run, and the plan's own acceptance criteria asks for "a documented
// accepted threshold, measured for real" — not a brittle exact-number assertion that would flake
// on a slower runner. The ceiling here exists only to catch a catastrophic regression (e.g. an
// isolate leak making each run progressively slower), not to enforce a specific target overhead.
//
// Run with: node backend/sandbox/security-corpus/load-test.js

const path = require('path');
const { bundleExecutor, runInIsolate } = require('../js-runtime');

const NODES_DIR = path.join(__dirname, '..', '..', '..', 'nodes');
const CONCURRENCY = 20;

const inputs = { items: [{ json: { a: 1 } }, { json: { a: 2 } }] };
const config = { mode: 'manual', assignments: [{ name: 'b', type: 'number', value: 42 }], keepOtherFields: true, stripFields: [] };

async function timeIt(label, fn) {
  const start = Date.now();
  await fn();
  const elapsed = Date.now() - start;
  console.log(`${label}: ${elapsed}ms`);
  return elapsed;
}

async function main() {
  const executorPath = path.join(NODES_DIR, 'set', 'execute.js');
  const baselineFn = require(executorPath);

  const inProcessMs = await timeIt(`in-process: ${CONCURRENCY} concurrent runs`, () =>
    Promise.all(Array.from({ length: CONCURRENCY }, () => baselineFn(inputs, config))));

  // Bundle once outside the timed section — a real registry package install is bundled once and
  // reused across every workflow run, not re-bundled per execution (bundleExecutor's esbuild
  // subprocess cost is a one-time install-time/first-run cost, not a per-run one).
  const bundleSource = bundleExecutor(executorPath);
  const sandboxedMs = await timeIt(`Sandbox Host (isolated-vm): ${CONCURRENCY} concurrent runs`, () =>
    Promise.all(Array.from({ length: CONCURRENCY }, () => runInIsolate({ bundleSource, inputs, config }))));

  const overhead = sandboxedMs / Math.max(inProcessMs, 1);
  console.log(`\nOverhead: ${overhead.toFixed(1)}x (Sandbox Host / in-process, ${CONCURRENCY} concurrent runs of "set")`);

  // Sanity ceiling only — see file header. 50x an in-process no-op is still single-digit
  // milliseconds of real wall-clock time; this is here to catch a leak/regression, not to
  // enforce a tight performance target.
  const CEILING = 50;
  if (overhead > CEILING) {
    console.error(`FAIL — overhead ${overhead.toFixed(1)}x exceeds the ${CEILING}x sanity ceiling`);
    process.exitCode = 1;
  } else {
    console.log(`PASS — overhead within the ${CEILING}x sanity ceiling`);
  }
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
