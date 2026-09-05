// Custom Node Platform Phase 9 (specs/space-flow-master-plan/01-custom-node-platform.md):
// malicious package corpus — "oversized output". validateOutput()'s limits.maxOutputMB
// enforcement (added in Phase 4, see the function's own comment) had no dedicated test since —
// this proves a package that returns a payload past its own declared limit is actually rejected,
// and that a well-behaved package under the limit is not, instead of trusting the comment alone.
//
// Run with: node backend/engine/runner.test.js

const assert = require('assert');
const { validateOutput } = require('./runner');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function main() {
  check('output under limits.maxOutputMB passes with no warnings', () => {
    const manifest = { outputs: [{ id: 'items' }], limits: { maxOutputMB: 1 } };
    const { warnings } = validateOutput({ items: [{ ok: true }] }, manifest);
    assert.deepStrictEqual(warnings, []);
  });

  check('output exceeding limits.maxOutputMB throws, naming the actual and limit size', () => {
    const manifest = { outputs: [{ id: 'items' }], limits: { maxOutputMB: 0.001 } }; // ~1KB
    const oversized = { items: [{ blob: 'x'.repeat(2 * 1024 * 1024) }] }; // ~2MB of payload
    assert.throws(
      () => validateOutput(oversized, manifest),
      /Output size .*MB exceeds this node's limits\.maxOutputMB \(0\.001MB\)/,
    );
  });

  check('no limits.maxOutputMB declared (built-in v1 manifest) never throws regardless of size', () => {
    const manifest = { outputs: [{ id: 'items' }] }; // no `limits` field at all — built-in nodes
    const huge = { items: [{ blob: 'x'.repeat(5 * 1024 * 1024) }] };
    assert.doesNotThrow(() => validateOutput(huge, manifest));
  });

  check('missing declared output port produces a warning, not a throw', () => {
    const manifest = { outputs: [{ id: 'items' }, { id: 'error' }] };
    const { warnings } = validateOutput({ items: [] }, manifest);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('"error"'));
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
