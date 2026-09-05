// Custom Node Platform Phase 6 pipeline step 6/9: contract test. No format for
// "tests/contract.test.*" existed anywhere before this — §2 of the plan lists tests/ as a
// package member but never specifies its shape. Defined here as data, not code: an optional
// tests/contract.json shipped inside the package, a JSON array of {inputs, config, expected}
// cases, each run through the SAME runRegistryPackage() a real workflow node uses (no separate
// execution path to keep in sync) and deep-equal-checked against `expected`. A package with no
// contract.json isn't failed for it (plenty of legitimate nodes have nothing meaningful to
// assert beyond "it runs", which step 7/8 already cover) — it's an info-level finding instead,
// visible to Phase 7's Admin Review UI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { runRegistryPackage } = require('../../engine/executor');

const id = '06-contract-test';
const name = 'Contract test (tests/contract.json)';

async function run(ctx) {
  if (!ctx.extractDir || !ctx.manifest) return { pass: false, detail: 'skipped — no extracted package from step 03' };

  const contractPath = path.join(ctx.extractDir, 'tests', 'contract.json');
  if (!fs.existsSync(contractPath)) {
    return {
      pass: true,
      detail: 'no tests/contract.json provided',
      findings: [{ severity: 'info', title: 'No contract test provided', detail: 'package ships no tests/contract.json — behavior not verified against author-declared expectations' }],
    };
  }

  let cases;
  try {
    cases = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (err) {
    return { pass: false, detail: `tests/contract.json is not valid JSON: ${err.message}` };
  }
  if (!Array.isArray(cases) || cases.length === 0) {
    return { pass: false, detail: 'tests/contract.json must be a non-empty array of {inputs, config, expected}' };
  }

  const failures = [];
  for (const [i, testCase] of cases.entries()) {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pipeline-contract-'));
    try {
      const context = { scratchDir: () => scratchDir, log: () => {} };
      const output = await runRegistryPackage(ctx.manifest, ctx.extractDir, testCase.inputs || {}, testCase.config || {}, context);
      assert.deepStrictEqual(output, testCase.expected);
    } catch (err) {
      failures.push(`case ${i}: ${err.message}`);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  return {
    pass: failures.length === 0,
    detail: failures.length === 0 ? `${cases.length} contract test case(s) passed` : failures.join(' | '),
  };
}

module.exports = { id, name, run };
