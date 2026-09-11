// Custom Node Platform Phase 6 pipeline step 9/9: aggregate every prior step's pass/fail +
// findings into a single low/medium/high risk score for Phase 7's Admin Review queue to sort/
// filter by. Deliberately conservative: any finding at all (even a benign "SBOM unavailable"
// note) keeps a submission out of 'low' — Phase 6 never auto-publishes anything (every outcome
// still lands in AdminReview or ChangesRequested, a human always looks at it), so erring toward
// a higher score here just means the queue sorts it earlier for review, not that it's blocked.
//
// Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
// permission-escalation re-review — hard-coded here, not left as policy a submitter could route
// around. Compares this submission's capabilities against the MOST RECENTLY submitted version of
// the same packageId (any status — a version that was previously ChangesRequested still counted
// as "what the last submission asked for"). At the time this step runs, node_versions has no row
// for the CURRENT submission yet (backend/routes/registry-submissions.js only inserts one after
// the whole pipeline finishes) — so this query can never see itself as its own "previous" version.
// A new dangerous capability that wasn't there before forces riskScore 'high' unconditionally,
// same as a critical finding, regardless of how clean everything else is.

const db = require('../../db');

const id = '09-risk-score';
const name = 'Risk score';

function dangerousCapabilitySet(manifest) {
  const capabilities = manifest?.capabilities || {};
  const set = new Set();
  if (capabilities.process) set.add('process');
  if (capabilities.gpu) set.add('gpu');
  if (Array.isArray(capabilities.network) && capabilities.network.length > 0) set.add('network');
  if (capabilities.filesystem === 'user-approved-path') set.add('filesystem');
  return set;
}

function detectEscalation(manifest) {
  const packageId = manifest?.packageId;
  if (!packageId) return { newCapabilities: [] };

  const previous = db.prepare(`
    SELECT manifest FROM node_versions WHERE package_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(packageId);
  if (!previous) return { newCapabilities: [] }; // first-ever submission for this packageId — nothing to escalate from

  const previousManifest = JSON.parse(previous.manifest);
  const previousCapabilities = dangerousCapabilitySet(previousManifest);
  const currentCapabilities = dangerousCapabilitySet(manifest);
  const newCapabilities = [...currentCapabilities].filter((c) => !previousCapabilities.has(c));
  return { newCapabilities };
}

async function run(ctx) {
  const failedSteps = ctx.results.filter((r) => !r.pass).length;
  const hasCriticalFinding = ctx.findings.some((f) => f.severity === 'critical');
  const dangerousCapabilities = dangerousCapabilitySet(ctx.manifest);
  const { newCapabilities } = detectEscalation(ctx.manifest);
  const hasEscalation = newCapabilities.length > 0;

  let riskScore;
  if (failedSteps > 0 || hasCriticalFinding || hasEscalation) {
    riskScore = 'high';
  } else if (ctx.findings.length > 0 || dangerousCapabilities.size >= 2) {
    riskScore = 'medium';
  } else {
    riskScore = 'low';
  }

  const findings = hasEscalation
    ? [{
      severity: 'high',
      title: 'Permission escalation phát hiện',
      detail: `Version này thêm capability mới so với lần submit gần nhất chưa từng có: ${newCapabilities.join(', ')} — bắt buộc AdminReview đầy đủ.`,
    }]
    : [];

  return {
    pass: true,
    detail: `risk score: ${riskScore} (${failedSteps} failed step(s), ${ctx.findings.length} finding(s), ${dangerousCapabilities.size} sensitive capabilit${dangerousCapabilities.size === 1 ? 'y' : 'ies'}${hasEscalation ? `, permission escalation: ${newCapabilities.join(', ')}` : ''})`,
    riskScore,
    findings,
  };
}

module.exports = { id, name, run };
