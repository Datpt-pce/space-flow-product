// Custom Node Platform Phase 6 (specs/space-flow-master-plan/01-custom-node-platform.md):
// runs a submitted .sfpkg through all 9 pipeline steps in order, always to completion — a step
// failing does NOT short-circuit the remaining steps (Phase 7's Admin Review needs the full log
// for every submission, including ones that failed early), it just means that step and any step
// downstream of a missing prerequisite (no manifest, no extracted dir) reports itself as failed/
// skipped rather than crashing the pipeline. Each step module exports { id, name, run(ctx) },
// where run() returns { pass, detail?, findings?, manifest?, checksum?, extractDir?, sbom?,
// riskScore? } — any of the optional keys get merged into ctx for later steps to read.

const fs = require('fs');

const steps = [
  require('./01-archive'),
  require('./02-schema'),
  require('./03-sbom'),
  require('./04-vuln-license'),
  require('./05-static-scan'),
  require('./06-contract-test'),
  require('./07-sandbox-fixture'),
  require('./08-limits-test'),
  require('./09-risk-score'),
];

async function runPipeline(archiveBuffer) {
  const ctx = { archiveBuffer, manifest: null, checksum: null, extractDir: null, sbom: null, hasDependencies: false, results: [], findings: [] };

  try {
    for (const step of steps) {
      let outcome;
      try {
        outcome = await step.run(ctx);
      } catch (err) {
        outcome = { pass: false, detail: `step threw: ${err.message}` };
      }
      ctx.results.push({ step: step.id, name: step.name, pass: outcome.pass, detail: outcome.detail || null });
      if (outcome.findings) ctx.findings.push(...outcome.findings.map((f) => ({ step: step.id, ...f })));
      if (outcome.manifest) ctx.manifest = outcome.manifest;
      if (outcome.checksum) ctx.checksum = outcome.checksum;
      if (outcome.extractDir) ctx.extractDir = outcome.extractDir;
      if (outcome.sbom) ctx.sbom = outcome.sbom;
      if (outcome.hasDependencies !== undefined) ctx.hasDependencies = outcome.hasDependencies;
      if (outcome.riskScore) ctx.riskScore = outcome.riskScore;
    }
  } finally {
    if (ctx.extractDir) fs.rmSync(ctx.extractDir, { recursive: true, force: true });
  }

  return {
    manifest: ctx.manifest,
    checksum: ctx.checksum,
    steps: ctx.results,
    findings: ctx.findings,
    riskScore: ctx.riskScore || 'high', // defensive default — should always be set by step 09
    overallPass: ctx.results.every((r) => r.pass),
  };
}

module.exports = { runPipeline };
