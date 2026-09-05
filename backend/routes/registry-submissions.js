// Custom Node Platform Phase 6 (specs/space-flow-master-plan/01-custom-node-platform.md):
// "Submit to Server" — upload a .sfpkg, run it through the 9-step automated pipeline
// (backend/registry/pipeline/), land in AdminReview (pass) or ChangesRequested (fail). No
// signing/publish/admin action anywhere in this file — that's Phase 7. Distinct from
// backend/routes/local-nodes.js's install endpoint: that installs LOCALLY for immediate use
// (Local Private lane, §2), this submits to the registry-wide review queue (Public Signed lane).

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { runPipeline } = require('../registry/pipeline');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Immutable per-version archive storage — distinct from backend/registry-installs/ (Phase 2,
// what a user actually runs locally once installed). A submission's bytes are never overwritten
// once accepted (enforced below via the node_versions unique index + an explicit pre-check).
const SUBMISSIONS_ROOT = path.join(__dirname, '..', 'registry-submissions');

router.post('/', upload.single('package'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Thiếu file .sfpkg (field "package")' });

  const pipelineResult = await runPipeline(req.file.buffer);
  if (!pipelineResult.manifest) {
    // Step 01 itself failed — there's no packageId/version to even key a DB row on.
    return res.status(400).json({ error: 'Package không hợp lệ', steps: pipelineResult.steps });
  }

  const { packageId, version, displayName, category } = pipelineResult.manifest;

  const existing = db.prepare('SELECT id FROM node_versions WHERE package_id = ? AND version = ?').get(packageId, version);
  if (existing) {
    return res.status(409).json({ error: `${packageId}@${version} đã được submit trước đó — phải tăng version để sửa, không được ghi đè` });
  }

  const archiveDir = path.join(SUBMISSIONS_ROOT, packageId);
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${version}.sfpkg`);
  fs.writeFileSync(archivePath, req.file.buffer);

  const status = pipelineResult.overallPass ? 'AdminReview' : 'ChangesRequested';
  const versionId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO node_packages (package_id, owner_id, display_name, category)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(package_id) DO NOTHING
  `).run(packageId, req.user.id, displayName, category);

  db.prepare(`
    INSERT INTO node_versions (id, package_id, version, status, manifest, checksum, archive_path, risk_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, packageId, version, status, JSON.stringify(pipelineResult.manifest), pipelineResult.checksum, archivePath, pipelineResult.riskScore);

  db.prepare(`
    INSERT INTO node_submissions (id, version_id, submitted_by, status, pipeline_steps, risk_score, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(submissionId, versionId, req.user.id, status, JSON.stringify(pipelineResult.steps), pipelineResult.riskScore);

  const insertFinding = db.prepare(`
    INSERT INTO package_security_findings (id, submission_id, step, severity, title, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const f of pipelineResult.findings) {
    insertFinding.run(crypto.randomUUID(), submissionId, f.step, f.severity, f.title, f.detail || null);
  }

  res.json({
    success: true,
    packageId,
    version,
    status,
    riskScore: pipelineResult.riskScore,
    steps: pipelineResult.steps,
    findings: pipelineResult.findings,
  });
});

// Latest submission's full pipeline log for 1 package version — read path for Phase 7's Admin
// Review UI (queue detail view) and for a submitter checking their own submission's outcome.
router.get('/:packageId/:version', (req, res) => {
  const version = db.prepare('SELECT * FROM node_versions WHERE package_id = ? AND version = ?').get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy submission' });

  const submission = db.prepare('SELECT * FROM node_submissions WHERE version_id = ? ORDER BY submitted_at DESC LIMIT 1').get(version.id);
  const findings = submission
    ? db.prepare('SELECT step, severity, title, detail FROM package_security_findings WHERE submission_id = ?').all(submission.id)
    : [];

  res.json({
    packageId: version.package_id,
    version: version.version,
    status: version.status,
    riskScore: version.risk_score,
    manifest: JSON.parse(version.manifest),
    steps: submission ? JSON.parse(submission.pipeline_steps) : [],
    findings,
    submittedAt: submission?.submitted_at || null,
  });
});

module.exports = router;
