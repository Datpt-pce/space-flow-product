// Regression test for Custom Node Platform Phase 3 JS track
// (specs/space-flow-master-plan/01-custom-node-platform.md). Converts 3 built-in nodes (set,
// filter, date-time — the exact 3 named in the plan) to bundled form and runs them through
// js-runtime.js's isolated-vm sandbox, asserting output matches the in-process baseline
// exactly. Also verifies timeout enforcement actually terminates a runaway isolate instead of
// hanging.
//
// Run with: node backend/sandbox/js-runtime.test.js

const path = require('path');
const assert = require('assert');
const { bundleExecutor, runInIsolate } = require('./js-runtime');

const NODES_DIR = path.join(__dirname, '..', '..', 'nodes');

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

async function regressionCase(nodeType, inputs, config) {
  const executorPath = path.join(NODES_DIR, nodeType, 'execute.js');
  const baselineFn = require(executorPath);
  const baseline = await baselineFn(inputs, config);

  const bundleSource = bundleExecutor(executorPath);
  const sandboxed = await runInIsolate({ bundleSource, inputs, config });

  assert.deepStrictEqual(sandboxed, baseline, `${nodeType}: sandboxed output must match in-process baseline`);
}

async function main() {
  await check('set: sandboxed output matches in-process baseline', () => regressionCase(
    'set',
    { items: [{ json: { a: 1 } }, { json: { a: 2 } }] },
    { mode: 'manual', assignments: [{ name: 'b', type: 'number', value: 42 }], keepOtherFields: true, stripFields: [] }
  ));

  await check('filter: sandboxed output matches in-process baseline', () => regressionCase(
    'filter',
    { items: [{ json: { a: 1 } }, { json: { a: 5 } }, { json: { a: 10 } }] },
    { conditions: [{ field: 'a', operator: 'greaterThan', value: 3 }], combinator: 'and' }
  ));

  // date-time uses the real current time for getCurrentDate — use a deterministic operation
  // instead (addToDate) so the baseline/sandboxed comparison isn't racing the clock.
  await check('date-time: sandboxed output matches in-process baseline', () => regressionCase(
    'date-time',
    { items: [{ json: { start: '2026-01-01T00:00:00.000Z' } }] },
    { operation: 'addToDate', dateField: 'start', magnitude: 5, timeUnit: 'days', outputFieldName: 'result' }
  ));

  await check('timeout: a runaway isolate is terminated, not hung', async () => {
    const bundleSource = `var ${require('./js-runtime').GLOBAL_EXPORT_NAME} = function() { while (true) {} };`;
    const start = Date.now();
    try {
      await runInIsolate({ bundleSource, inputs: {}, config: {}, timeoutMs: 500 });
      throw new Error('expected a timeout error to be thrown');
    } catch (err) {
      const elapsed = Date.now() - start;
      assert.ok(/[Ss]cript execution timed out|timeout/i.test(err.message), `expected a timeout-shaped error, got: ${err.message}`);
      assert.ok(elapsed < 5000, `expected termination well under 5s, took ${elapsed}ms`);
    }
  });

  // Custom Node Platform Phase 9 (specs/space-flow-master-plan/01-custom-node-platform.md):
  // malicious package corpus — "fork bomb (Python + worker_threads JS)". esbuild's `--platform=
  // node` treats Node built-ins (worker_threads, child_process...) as external by default, so
  // bundleExecutor() actually SUCCEEDS — it emits a `require()` shim that only works if a real
  // `require` exists in the running context. A bare isolated-vm context has no Node module
  // system at all (js-runtime.js's own top comment), so that shim throws "Dynamic require ... is
  // not supported" the moment the bundle is evaluated inside the isolate — before
  // execute()'s fork-bomb body ever gets a chance to run. This locks that guarantee in as a
  // regression instead of leaving it as an unverified comment.
  await check('fork bomb (worker_threads/child_process): require() has no Node module system to resolve against inside the isolate, so it throws before the loop starts', async () => {
    const forkBombPath = path.join(__dirname, 'security-corpus', 'fixtures', 'js-fork-bomb', 'execute.js');
    const bundleSource = require('./js-runtime').bundleExecutor(forkBombPath);
    await assert.rejects(
      () => runInIsolate({ bundleSource, inputs: {}, config: {}, timeoutMs: 2000 }),
      /Dynamic require|not supported|not defined/,
    );
  });

  await check('memory limit: an isolate that exceeds memoryLimitMB is terminated', async () => {
    const bundleSource = `var ${require('./js-runtime').GLOBAL_EXPORT_NAME} = function() {
      const chunks = [];
      while (true) { chunks.push(new Array(1e6).fill(0)); }
    };`;
    try {
      await runInIsolate({ bundleSource, inputs: {}, config: {}, memoryLimitMB: 16, timeoutMs: 10000 });
      throw new Error('expected a memory-limit error to be thrown');
    } catch (err) {
      assert.ok(/memory|isolate is disposed|out of memory/i.test(err.message), `expected a memory-shaped error, got: ${err.message}`);
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
