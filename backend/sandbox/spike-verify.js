// Phase 0.2 spike acceptance check — run with: node backend/sandbox/spike-verify.js
// Confirms the IPC round-trip (host.js -> worker.js) produces output identical to calling
// the same built-in executor in-process, per the acceptance criteria in
// specs/space-flow-master-plan/00-platform-core.md Phase 0.2.

const path = require('path');
const assert = require('assert');
const { runInSandbox } = require('./host');

const executorPath = path.join(__dirname, '..', '..', 'nodes', 'set', 'execute.js');

const inputs = { items: [{ json: { a: 1 } }, { json: { a: 2 } }] };
const config = {
  mode: 'manual',
  assignments: [{ name: 'b', type: 'number', value: 42 }],
  keepOtherFields: true,
  stripFields: [],
};

async function main() {
  const baselineFn = require(executorPath);
  const baseline = await baselineFn(inputs, config);

  const sandboxed = await runInSandbox({
    executorPath,
    inputs,
    config,
    capabilityGrants: {},
    onLog: (msg) => console.log('[worker log]', msg.message),
  });

  assert.deepStrictEqual(sandboxed, baseline, 'sandboxed output must match in-process baseline');
  console.log('PASS — sandboxed output matches in-process baseline:');
  console.log(JSON.stringify(sandboxed, null, 2));
}

main().catch((err) => {
  console.error('FAIL —', err.message);
  process.exitCode = 1;
});
