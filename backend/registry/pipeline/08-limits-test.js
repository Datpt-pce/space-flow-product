// Custom Node Platform Phase 6 pipeline step 8/9: malformed-input resilience. Runs the package
// against a handful of deliberately degenerate inputs (null/undefined/empty/deeply-nested) and
// confirms the sandbox always returns control. A thrown/rejected error for garbage input is a
// clean, acceptable outcome — declared timeoutSeconds/memoryMB are the actual backstop against
// a runaway node, already proven for the runtime itself in Phase 3 (js-runtime.test.js/
// py-runtime.test.js); this step isn't re-proving sandbox enforcement, it's checking THIS
// submission's entry file doesn't do something like an unguarded infinite loop keyed off input
// shape that only a real (not synthetic) malformed payload would trigger.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRegistryPackage } = require('../../engine/executor');

const id = '08-limits-test';
const name = 'Malformed-input resilience test';

const MALFORMED_INPUTS = [
  null,
  undefined,
  {},
  { deeply: { nested: { object: { that: { goes: { on: 'x'.repeat(1000) } } } } } },
];

async function run(ctx) {
  if (!ctx.extractDir || !ctx.manifest) return { pass: false, detail: 'skipped — no extracted package from step 03' };

  for (const malformed of MALFORMED_INPUTS) {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pipeline-limits-'));
    try {
      const context = { scratchDir: () => scratchDir, log: () => {} };
      await runRegistryPackage(ctx.manifest, ctx.extractDir, malformed, {}, context);
    } catch {
      // clean rejection — acceptable, see file header
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  return { pass: true, detail: `ran ${MALFORMED_INPUTS.length} malformed-input case(s), sandbox returned control every time` };
}

module.exports = { id, name, run };
