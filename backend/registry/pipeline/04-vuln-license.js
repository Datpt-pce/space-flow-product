// Custom Node Platform Phase 6 pipeline step 4/9: CVE scan (Grype, against step 3's extracted
// dependencies) + license allowlist. The license check is pure JS (reads each installed npm
// dependency's own package.json "license" field) and always runs regardless of tool
// availability; the CVE scan needs Grype and degrades the same way step 3 degrades without
// Syft — see that file's comment for why "unavailable" is a finding, not a hard failure.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const id = '04-vuln-license';
const name = 'Vulnerability scan (Grype) + license allowlist';

// Common permissive licenses used across the JS/Python ecosystem — anything outside this list
// is flagged for a human to look at (Phase 7 Admin Review), not auto-rejected: a strict-copyleft
// or nonstandard license isn't necessarily disqualifying, it just needs eyes on it.
const LICENSE_ALLOWLIST = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense']);

const GRYPE_SEVERITY_MAP = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low', Negligible: 'info', Unknown: 'info' };

function hasBinary(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkJsLicenses(extractDir) {
  const findings = [];
  const nodeModules = path.join(extractDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) return findings;
  for (const depName of fs.readdirSync(nodeModules)) {
    if (depName.startsWith('.')) continue;
    const pkgPath = path.join(nodeModules, depName, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    let license;
    try {
      license = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).license;
    } catch {
      continue;
    }
    const licenseId = typeof license === 'string' ? license : license?.type;
    if (!licenseId || !LICENSE_ALLOWLIST.has(licenseId)) {
      findings.push({ severity: 'medium', title: `Dependency "${depName}" has a non-allowlisted license`, detail: `license: ${licenseId || '(missing)'}` });
    }
  }
  return findings;
}

async function run(ctx) {
  if (!ctx.extractDir) return { pass: false, detail: 'skipped — no extracted package from step 03' };

  const licenseFindings = checkJsLicenses(ctx.extractDir);

  if (!ctx.hasDependencies) {
    return { pass: true, detail: 'no third-party dependencies declared — CVE scan not applicable', findings: licenseFindings };
  }

  if (!ctx.sbom) {
    // Dependencies ARE declared but step 03 couldn't produce an SBOM for them (Syft
    // unavailable there) — nothing for Grype to scan, distinct from "not applicable" above.
    return {
      pass: true,
      detail: 'no SBOM from step 03 (syft unavailable) — CVE scan skipped',
      findings: [...licenseFindings, { severity: 'medium', title: 'CVE scan unavailable', detail: 'no SBOM to scan (syft unavailable in step 03); dependency vulnerabilities not checked for this submission' }],
    };
  }

  if (!hasBinary('grype')) {
    return {
      pass: true,
      detail: 'grype not found on this pipeline host — CVE scan skipped (see Dockerfile.backend)',
      findings: [...licenseFindings, { severity: 'medium', title: 'CVE scan unavailable', detail: 'grype binary not found; dependency vulnerabilities not checked for this submission' }],
    };
  }

  let vulnFindings = [];
  try {
    const raw = execFileSync('grype', ['dir:' + ctx.extractDir, '-o', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    vulnFindings = (parsed.matches || []).map((m) => ({
      severity: GRYPE_SEVERITY_MAP[m.vulnerability?.severity] || 'info',
      title: `${m.vulnerability?.id || 'unknown CVE'} in ${m.artifact?.name}@${m.artifact?.version}`,
      detail: m.vulnerability?.description || '',
    }));
  } catch (err) {
    return { pass: false, detail: `grype scan failed: ${err.message}`, findings: licenseFindings };
  }

  const hasCritical = vulnFindings.some((f) => f.severity === 'critical');
  return {
    pass: !hasCritical,
    detail: hasCritical
      ? 'critical-severity CVE found in a dependency'
      : `${vulnFindings.length} CVE(s) found, none critical`,
    findings: [...licenseFindings, ...vulnFindings],
  };
}

module.exports = { id, name, run };
