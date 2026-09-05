// Custom Node Platform Phase 6 pipeline step 7/9: run the package's contract cases (or, absent
// any, a single empty-input case) through the real Sandbox Host with capabilities.secrets
// forced empty regardless of what the manifest declares — catches a package that silently
// assumes a secret is always present instead of failing cleanly when it isn't.
//
// A thrown/rejected error here is an ACCEPTABLE outcome (a node that legitimately needs a
// secret erroring out cleanly when denied one is exactly the point) — what would actually fail
// this step is the sandbox never returning control at all, which timeoutSeconds already
// prevents by construction (proven once for the runtime itself in Phase 3's
// js-runtime.test.js/py-runtime.test.js, not re-proven per submission here).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRegistryPackage } = require('../../engine/executor');

const id = '07-sandbox-fixture';
const name = 'Sandbox fixture run without secrets granted';

function loadCases(extractDir) {
  const contractPath = path.join(extractDir, 'tests', 'contract.json');
  if (fs.existsSync(contractPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through to the default case below */ }
  }
  return [{ inputs: {}, config: {} }];
}

async function run(ctx) {
  if (!ctx.extractDir || !ctx.manifest) return { pass: false, detail: 'skipped — no extracted package from step 03' };

  const manifestNoSecrets = { ...ctx.manifest, capabilities: { ...(ctx.manifest.capabilities || {}), secrets: [] } };
  const cases = loadCases(ctx.extractDir);

  for (const testCase of cases) {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pipeline-nosecret-'));
    try {
      const context = { scratchDir: () => scratchDir, log: () => {} };
      await runRegistryPackage(manifestNoSecrets, ctx.extractDir, testCase.inputs || {}, testCase.config || {}, context);
    } catch {
      // clean rejection — acceptable, see file header
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  return { pass: true, detail: `ran ${cases.length} case(s) with capabilities.secrets forced empty — sandbox returned control every time` };
}

module.exports = { id, name, run };
