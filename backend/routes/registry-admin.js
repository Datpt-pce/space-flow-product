// Custom Node Platform Phase 7 (specs/space-flow-master-plan/01-custom-node-platform.md):
// Admin Review — the human decision point Phase 6's pipeline always defers to
// (AutomatedReview never auto-publishes). Exactly the 2 admin actions the plan's state machine
// (§2) defines: approve (sign + Published) and request-changes (back to ChangesRequested with a
// note) — there is no separate "Reject" terminal state in that state machine, so this file
// doesn't invent one. Phase 8 (below) adds the post-publish lifecycle actions (deprecate/revoke/
// rollback) that operate on an already-Published version instead.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../db');
const { signArchive } = require('../registry/signing');

const router = express.Router();

// Queue: every version awaiting a human decision (AdminReview/ChangesRequested) PLUS every
// version already Published/Deprecated/Revoked — Custom Node Platform Phase 8 reuses this same
// list for lifecycle actions (deprecate/revoke/rollback below) rather than adding a 2nd endpoint,
// since the frontend's queue view already renders a per-row status badge generically. Submitted/
// AutomatedReview are excluded: those are always momentary in-flight pipeline states no admin
// ever acts on directly. Not scoped by owner_id — any admin can review any submission, matching
// requireAdmin's existing all-or-nothing model elsewhere in this codebase (backend/routes/users.js).
router.get('/queue', (req, res) => {
  const rows = db.prepare(`
    SELECT nv.id, nv.package_id, nv.version, nv.status, nv.risk_score, nv.created_at,
           np.display_name, np.category, np.owner_id,
           u.name AS owner_name, u.email AS owner_email
    FROM node_versions nv
    JOIN node_packages np ON np.package_id = nv.package_id
    LEFT JOIN users u ON u.id = np.owner_id
    WHERE nv.status IN ('AdminReview', 'ChangesRequested', 'Published', 'Deprecated', 'Revoked')
    ORDER BY nv.created_at ASC
  `).all();
  res.json(rows);
});

router.get('/:packageId/:version', (req, res) => {
  const version = db.prepare('SELECT * FROM node_versions WHERE package_id = ? AND version = ?').get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy version' });

  const pkg = db.prepare('SELECT * FROM node_packages WHERE package_id = ?').get(version.package_id);
  const submission = db.prepare('SELECT * FROM node_submissions WHERE version_id = ? ORDER BY submitted_at DESC LIMIT 1').get(version.id);
  const findings = submission
    ? db.prepare('SELECT step, severity, title, detail FROM package_security_findings WHERE submission_id = ?').all(submission.id)
    : [];
  const signature = db.prepare('SELECT key_fingerprint, signed_at FROM node_signatures WHERE version_id = ?').get(version.id);
  const lifecycleEvents = db.prepare(`
    SELECT nle.action, nle.note, nle.created_at, u.name AS actor_name, u.email AS actor_email
    FROM node_lifecycle_events nle
    LEFT JOIN users u ON u.id = nle.actor_id
    WHERE nle.version_id = ?
    ORDER BY nle.created_at DESC
  `).all(version.id);

  res.json({
    packageId: version.package_id,
    version: version.version,
    displayName: pkg?.display_name,
    category: pkg?.category,
    ownerId: pkg?.owner_id,
    status: version.status,
    riskScore: version.risk_score,
    manifest: JSON.parse(version.manifest),
    steps: submission ? JSON.parse(submission.pipeline_steps) : [],
    findings,
    submittedAt: submission?.submitted_at || null,
    signature: signature || null,
    lifecycleEvents,
  });
});

router.post('/:packageId/:version/approve', (req, res) => {
  const version = db.prepare('SELECT * FROM node_versions WHERE package_id = ? AND version = ?').get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy version' });
  if (version.status !== 'AdminReview') {
    return res.status(409).json({ error: `Chỉ approve được version đang ở trạng thái AdminReview (hiện tại: ${version.status})` });
  }

  const archiveBuffer = fs.readFileSync(version.archive_path);
  const { signature, fingerprint } = signArchive(archiveBuffer);

  const { channel = 'stable', rolloutPercent = 100 } = req.body || {};
  if (!['beta', 'stable'].includes(channel)) return res.status(400).json({ error: 'channel phải là "beta" hoặc "stable"' });
  if (typeof rolloutPercent !== 'number' || rolloutPercent < 0 || rolloutPercent > 100) {
    return res.status(400).json({ error: 'rolloutPercent phải là số 0-100' });
  }

  db.prepare(`INSERT INTO node_signatures (id, version_id, signature, key_fingerprint, signed_by) VALUES (?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), version.id, signature, fingerprint, req.user.id);

  db.prepare(`
    INSERT INTO package_rollouts (id, version_id, channel, rollout_percent)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(version_id) DO UPDATE SET channel = excluded.channel, rollout_percent = excluded.rollout_percent, updated_at = datetime('now')
  `).run(crypto.randomUUID(), version.id, channel, rolloutPercent);

  db.prepare(`UPDATE node_versions SET status = 'Published', updated_at = datetime('now') WHERE id = ?`).run(version.id);

  res.json({ success: true, status: 'Published', keyFingerprint: fingerprint, channel, rolloutPercent });
});

router.post('/:packageId/:version/request-changes', (req, res) => {
  const version = db.prepare('SELECT * FROM node_versions WHERE package_id = ? AND version = ?').get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy version' });
  if (version.status !== 'AdminReview') {
    return res.status(409).json({ error: `Chỉ request-changes được version đang ở trạng thái AdminReview (hiện tại: ${version.status})` });
  }

  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Cần ghi lý do (note) khi yêu cầu sửa' });

  const submission = db.prepare('SELECT id FROM node_submissions WHERE version_id = ? ORDER BY submitted_at DESC LIMIT 1').get(version.id);
  if (submission) {
    db.prepare(`INSERT INTO package_security_findings (id, submission_id, step, severity, title, detail) VALUES (?, ?, 'admin-review', 'info', 'Admin yêu cầu sửa', ?)`)
      .run(crypto.randomUUID(), submission.id, note);
  }

  db.prepare(`UPDATE node_versions SET status = 'ChangesRequested', updated_at = datetime('now') WHERE id = ?`).run(version.id);

  res.json({ success: true, status: 'ChangesRequested' });
});

// Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
// Lifecycle Controls — deprecate/revoke/rollback, each logged to node_lifecycle_events so
// backend/routes/local-nodes.js can surface WHY to a user who has this version installed.
function loadVersionForLifecycle(req, res, allowedStatuses) {
  const version = db.prepare('SELECT * FROM node_versions WHERE package_id = ? AND version = ?').get(req.params.packageId, req.params.version);
  if (!version) {
    res.status(404).json({ error: 'Không tìm thấy version' });
    return null;
  }
  if (!allowedStatuses.includes(version.status)) {
    res.status(409).json({ error: `Chỉ thực hiện được khi version đang ở trạng thái ${allowedStatuses.join('/')} (hiện tại: ${version.status})` });
    return null;
  }
  return version;
}

function logLifecycleEvent(versionId, action, note, actorId) {
  db.prepare(`INSERT INTO node_lifecycle_events (id, version_id, action, note, actor_id) VALUES (?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), versionId, action, note || null, actorId);
}

// Deprecate: soft signal only — a Deprecated version still installs and runs exactly like
// Published (backend/registry/revocation-check.js never blocks on Deprecated), it just shows a
// "deprecated" badge + note wherever it's displayed. Use this to steer users off an old version
// without breaking anyone already relying on it.
router.post('/:packageId/:version/deprecate', (req, res) => {
  const version = loadVersionForLifecycle(req, res, ['Published']);
  if (!version) return;

  const note = (req.body?.note || '').trim() || null;
  db.prepare(`UPDATE node_versions SET status = 'Deprecated', updated_at = datetime('now') WHERE id = ?`).run(version.id);
  logLifecycleEvent(version.id, 'deprecate', note, req.user.id);

  res.json({ success: true, status: 'Deprecated' });
});

// Revoke: hard signal, enforced at runtime by backend/registry/revocation-check.js. A note is
// required (same pattern as request-changes) — a revoke always needs a reason a user with this
// installed can actually read. Resets revocation_acknowledged for every existing installation of
// this exact version so a past "run anyway" from an EARLIER revoke episode never silently carries
// over to this new one.
router.post('/:packageId/:version/revoke', (req, res) => {
  const version = loadVersionForLifecycle(req, res, ['Published', 'Deprecated']);
  if (!version) return;

  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Cần ghi lý do (note) khi revoke' });

  db.prepare(`UPDATE node_versions SET status = 'Revoked', updated_at = datetime('now') WHERE id = ?`).run(version.id);
  db.prepare(`UPDATE node_installations SET revocation_acknowledged = 0 WHERE package_id = ? AND version = ?`).run(version.package_id, version.version);
  logLifecycleEvent(version.id, 'revoke', note, req.user.id);

  res.json({ success: true, status: 'Revoked' });
});

// Rollback: undo a deprecate/revoke — the version goes back to Published exactly as if the
// lifecycle action had never happened (no "current version per package" pointer exists in this
// registry's data model — every version is independently browsable/installable — so rollback
// here means reverting THIS version's own status, not redirecting installs to a different one).
router.post('/:packageId/:version/rollback', (req, res) => {
  const version = loadVersionForLifecycle(req, res, ['Deprecated', 'Revoked']);
  if (!version) return;

  const note = (req.body?.note || '').trim() || null;
  db.prepare(`UPDATE node_versions SET status = 'Published', updated_at = datetime('now') WHERE id = ?`).run(version.id);
  db.prepare(`UPDATE node_installations SET revocation_acknowledged = 0 WHERE package_id = ? AND version = ?`).run(version.package_id, version.version);
  logLifecycleEvent(version.id, 'rollback', note, req.user.id);

  res.json({ success: true, status: 'Published' });
});

module.exports = router;
