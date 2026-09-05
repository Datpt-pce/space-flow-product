// Custom Node Platform Phase 6 pipeline step 3/9: extract the archive (needed by every step
// after this one) + materialize dependencies (reusing backend/registry/dependencies.js, same
// code path install() uses) + generate an SBOM via Syft when the package actually declares any
// third-party dependency.
//
// Syft/Grype (Go binaries, not npm/pip) are provisioned in Dockerfile.backend for wherever this
// pipeline actually runs server-side — NOT installed on a dev machine by this code. If the
// binary isn't on PATH, this step degrades to a "skipped, tool unavailable" finding instead of
// failing the whole submission outright: an infra gap here is a real, honestly-reported risk
// factor (see 09-risk-score.js), not grounds to make every submission un-reviewable wherever
// ops hasn't finished provisioning the pipeline host.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { installDependencies } = require('../dependencies');

const id = '03-sbom';
const name = 'Extract + dependency install + SBOM (Syft)';

function hasBinary(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function declaresDependencies(extractDir) {
  const pkgJsonPath = path.join(extractDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) return true;
    } catch { /* treated as no declared deps below */ }
  }
  const reqPath = path.join(extractDir, 'requirements.txt');
  if (fs.existsSync(reqPath) && fs.readFileSync(reqPath, 'utf8').trim()) return true;
  return false;
}

async function run(ctx) {
  if (!ctx.manifest) return { pass: false, detail: 'skipped — no valid manifest from step 01' };

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pipeline-'));
  const zip = new AdmZip(ctx.archiveBuffer);
  zip.extractAllTo(extractDir, true);

  try {
    installDependencies(extractDir);
  } catch (err) {
    return { pass: false, detail: `dependency installation failed: ${err.message}`, extractDir };
  }

  if (!declaresDependencies(extractDir)) {
    return { pass: true, detail: 'no third-party dependencies declared — nothing to bill of materials', extractDir, hasDependencies: false };
  }

  if (!hasBinary('syft')) {
    return {
      pass: true,
      detail: 'syft not found on this pipeline host — SBOM generation skipped (see Dockerfile.backend)',
      extractDir,
      hasDependencies: true,
      findings: [{ severity: 'medium', title: 'SBOM unavailable', detail: 'syft binary not found; dependency inventory not generated for this submission' }],
    };
  }

  try {
    const sbom = execFileSync('syft', [extractDir, '-o', 'cyclonedx-json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return { pass: true, detail: 'SBOM generated', extractDir, hasDependencies: true, sbom };
  } catch (err) {
    return { pass: false, detail: `syft failed: ${err.message}`, extractDir, hasDependencies: true };
  }
}

module.exports = { id, name, run };
