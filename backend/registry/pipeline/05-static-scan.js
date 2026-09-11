// Custom Node Platform Phase 6 pipeline step 5/9: static analysis on the package's entry file.
// JS: eslint-plugin-security via ESLint's low-level Linter class (no project config/CLI needed
// — verify(code, flatConfig) takes source text directly). Python: Bandit, shelled out as JSON
// (both pure npm/pip packages, no OS-specific binary, so — unlike Syft/Grype — these run
// identically on native Windows dev and the Docker Linux pipeline host; no degradation path
// needed for the JS side. Bandit itself is still provisioned in Dockerfile.backend/setup:python
// for wherever the pipeline actually runs, and degrades gracefully same as Syft/Grype if
// somehow missing there).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Linter } = require('eslint');
const security = require('eslint-plugin-security');
const { findPythonExe } = require('../../utils/pythonExe');

const id = '05-static-scan';
const name = 'Static analysis (eslint-plugin-security / Bandit)';

// security/detect-object-injection is excluded — even eslint-plugin-security's own docs note
// it has a very high false-positive rate (flags any `obj[x]` where x isn't a literal), which
// would make every non-trivial node fail this step for normal, safe array/object indexing.
const SECURITY_RULES = {
  'security/detect-eval-with-expression': 'error',
  'security/detect-child-process': 'warn',
  'security/detect-non-literal-fs-filename': 'warn',
  'security/detect-non-literal-require': 'warn',
  'security/detect-pseudoRandomBytes': 'warn',
  'security/detect-buffer-noassert': 'error',
  'security/detect-disable-mustache-escape': 'warn',
  'security/detect-no-csrf-before-method-override': 'warn',
  'security/detect-possible-timing-attacks': 'warn',
  'security/detect-unsafe-regex': 'warn',
};

function lintJsFile(filePath) {
  const linter = new Linter();
  const code = fs.readFileSync(filePath, 'utf8');
  const messages = linter.verify(
    code,
    {
      plugins: { security },
      rules: SECURITY_RULES,
      languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    },
    { filename: filePath }
  );
  return messages
    .filter((m) => m.ruleId) // drop parse-error pseudo-messages (ruleId: null) — not this step's concern
    .map((m) => ({
      severity: m.severity === 2 ? 'high' : 'medium',
      title: `${m.ruleId}: ${m.message}`,
      detail: `${path.basename(filePath)}:${m.line}`,
    }));
}

const BANDIT_SEVERITY_MAP = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', UNDEFINED: 'info' };

function banditScanPython(dir) {
  const pythonExe = findPythonExe(dir);
  if (!pythonExe) return { skipped: true };
  try {
    // --exit-zero: Bandit exits non-zero whenever it finds ANY issue (not an execution error) —
    // without this flag every scan with findings would need to be told apart from an actual
    // bandit crash via stdout content alone, which is fragile. -q keeps clean stdout for JSON.
    const raw = execFileSync(pythonExe, ['-m', 'bandit', '-f', 'json', '-q', '-r', dir, '--exit-zero'], { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    const findings = (parsed.results || []).map((r) => ({
      severity: BANDIT_SEVERITY_MAP[r.issue_severity] || 'info',
      title: `${r.test_id}: ${r.issue_text}`,
      detail: `${path.basename(r.filename)}:${r.line_number}`,
    }));
    return { skipped: false, findings };
  } catch (err) {
    return { skipped: true, error: err.message };
  }
}

async function run(ctx) {
  if (!ctx.extractDir || !ctx.manifest) return { pass: false, detail: 'skipped — no extracted package from step 03' };

  const entryPath = path.join(ctx.extractDir, ctx.manifest.runtime.entry);
  if (!fs.existsSync(entryPath)) return { pass: false, detail: `entry file not found: ${ctx.manifest.runtime.entry}` };

  let findings = [];
  let toolUnavailable = null;

  if (ctx.manifest.runtime.type === 'javascript') {
    findings = lintJsFile(entryPath);
  } else if (ctx.manifest.runtime.type === 'python') {
    const result = banditScanPython(ctx.extractDir);
    if (result.skipped) {
      toolUnavailable = { severity: 'medium', title: 'Static analysis unavailable', detail: `bandit not found / failed to run on this pipeline host${result.error ? `: ${result.error}` : ''}` };
    } else {
      findings = result.findings;
    }
  }

  const hasHighOrAbove = findings.some((f) => f.severity === 'high' || f.severity === 'critical');
  return {
    pass: !hasHighOrAbove,
    detail: hasHighOrAbove ? 'high/critical-severity static finding(s)' : `${findings.length} finding(s), none high/critical`,
    findings: toolUnavailable ? [toolUnavailable] : findings,
  };
}

module.exports = { id, name, run };
