// Custom Node Platform Phase 7 (specs/space-flow-master-plan/01-custom-node-platform.md):
// Public Registry — browse/download ONLY versions an admin has approved+signed (status
// Published). No admin gate on this router (any authenticated user of this instance can browse/
// install, matching the existing team-wide trust model already used for Local Node Builder), but
// every read here is scoped to Published rows only — an AdminReview/ChangesRequested version is
// never visible through this router regardless of who's asking.

const express = require('express');
const fs = require('fs');
const db = require('../db');
const { getPublicKeyInfo } = require('../registry/signing');
const { installFromPublished } = require('../registry/install');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT nv.package_id, nv.version, nv.risk_score, nv.created_at,
           np.display_name, np.category,
           pr.channel, pr.rollout_percent
    FROM node_versions nv
    JOIN node_packages np ON np.package_id = nv.package_id
    LEFT JOIN package_rollouts pr ON pr.version_id = nv.id
    WHERE nv.status = 'Published'
    ORDER BY nv.created_at DESC
  `).all();
  res.json(rows);
});

// Metadata + signature + checksum + the public key that signed it — everything an "install from
// registry" client needs to independently verify before ever trusting the archive bytes it then
// fetches from the sibling /archive route below.
router.get('/:packageId/:version', (req, res) => {
  const version = db.prepare(`SELECT * FROM node_versions WHERE package_id = ? AND version = ? AND status = 'Published'`)
    .get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy version đã publish' });

  const signature = db.prepare('SELECT signature, key_fingerprint, algorithm, signed_at FROM node_signatures WHERE version_id = ?').get(version.id);
  const publicKey = getPublicKeyInfo();

  res.json({
    packageId: version.package_id,
    version: version.version,
    manifest: JSON.parse(version.manifest),
    checksum: version.checksum,
    signature: signature?.signature,
    keyFingerprint: signature?.key_fingerprint,
    algorithm: signature?.algorithm,
    publicKeyPem: publicKey.pem,
  });
});

router.get('/:packageId/:version/archive', (req, res) => {
  const version = db.prepare(`SELECT * FROM node_versions WHERE package_id = ? AND version = ? AND status = 'Published'`)
    .get(req.params.packageId, req.params.version);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy version đã publish' });
  if (!fs.existsSync(version.archive_path)) return res.status(404).json({ error: 'Archive không còn trên đĩa' });

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${version.package_id}-${version.version}.sfpkg"`);
  res.send(fs.readFileSync(version.archive_path));
});

// Install a Published version onto THIS machine — signature/checksum re-verified inside
// installFromPublished() (backend/registry/install.js), independent of whatever "Published"
// status this same DB row already claims.
router.post('/:packageId/:version/install', (req, res) => {
  try {
    const result = installFromPublished({ packageId: req.params.packageId, version: req.params.version, installedBy: req.user.id });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
