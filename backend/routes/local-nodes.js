// Custom Node Platform Phase 5 (specs/space-flow-master-plan/01-custom-node-platform.md):
// Local Node Builder / Test Console / My Nodes backend — CRUD for a user's own LocalDraft
// packages, Test Console execution against the Sandbox Host, and LocalDraft -> LocalInstalled
// (pack + install, see backend/registry/{sfpkg,install}.js). No admin/server review anywhere in
// this file — that's Phase 6/7 (Submitted -> AutomatedReview -> AdminReview -> Published).
//
// Drafts live on disk only (backend/registry/local-drafts/<userId>/<packageId>/node.json +
// entry file), no DB table — same "don't create an empty table with no real consumer yet"
// reasoning as docs/decisions/0012-schema-migration-convention.md, and mirrors how built-in
// nodes/<type>/node.json is filesystem-only too. Scoped per-user (req.user.id) since a draft is
// personal work-in-progress, unlike an installed package (machine-wide once installed, same as
// any built-in node).

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pack } = require('../registry/sfpkg');
const { install, listInstallations, getInstallation, setApprovedPaths, acknowledgeRevocation } = require('../registry/install');
const { installDependencies } = require('../registry/dependencies');
const { runRegistryPackage } = require('../engine/executor');
const db = require('../db');

const router = express.Router();
const DRAFTS_ROOT = path.join(__dirname, '..', 'registry', 'local-drafts');

// Same pattern as manifest-schema.json's packageId — enforced here too because packageId gets
// used directly as a filesystem directory name below (path traversal guard, not just schema nicety).
const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function draftDir(userId, packageId) {
  return path.join(DRAFTS_ROOT, userId, packageId);
}

function entryFilename(manifest) {
  return manifest?.runtime?.type === 'python' ? 'executor.py' : 'execute.js';
}

function readDraft(userId, packageId) {
  const dir = draftDir(userId, packageId);
  const manifestPath = path.join(dir, 'node.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryPath = path.join(dir, entryFilename(manifest));
  const source = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
  return { manifest, source };
}

// Deliberately NOT schema-validated here — Node Builder is a multi-tab form (General/Ports/
// Config/Runtime/Permissions/Tests/Docs) a user saves progress on mid-edit, well before every
// Manifest v2 required field is filled in. Full validation happens once, at the pack() step
// below (LocalDraft -> LocalInstalled), which is also the point the plan's state machine (§2)
// actually requires it.
function writeDraft(userId, packageId, manifest, source) {
  const dir = draftDir(userId, packageId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'node.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, entryFilename(manifest)), source ?? '');
}

// My Nodes: Local Drafts + Installed, in one call.
router.get('/', (req, res) => {
  const userDraftsRoot = path.join(DRAFTS_ROOT, req.user.id);
  const drafts = fs.existsSync(userDraftsRoot)
    ? fs.readdirSync(userDraftsRoot)
      .map(packageId => readDraft(req.user.id, packageId))
      .filter(Boolean)
      .map(d => d.manifest)
    : [];

  // Custom Node Platform Phase 8: lifecycle status of a Published version can change (Deprecate/
  // Revoke/Rollback, backend/routes/registry-admin.js) independently of what got installed onto
  // this machine — join it in here so an already-installed package's My Nodes row reflects the
  // CURRENT status, not whatever it was at install time. Pull-based "notify affected users": no
  // separate notification inbox, just always-current state on the list a user already checks.
  const installed = listInstallations().map(row => {
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(row.install_path, 'node.json'), 'utf8')); } catch { /* install dir removed on disk since */ }

    const versionRow = db.prepare('SELECT id, status FROM node_versions WHERE package_id = ? AND version = ?').get(row.package_id, row.version);
    let lifecycleNote = null;
    if (versionRow && (versionRow.status === 'Deprecated' || versionRow.status === 'Revoked')) {
      const event = db.prepare('SELECT note FROM node_lifecycle_events WHERE version_id = ? ORDER BY created_at DESC LIMIT 1').get(versionRow.id);
      lifecycleNote = event?.note || null;
    }

    return { ...row, manifest, versionStatus: versionRow?.status || null, lifecycleNote };
  });

  res.json({ drafts, installed });
});

router.get('/drafts/:packageId', (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const draft = readDraft(req.user.id, req.params.packageId);
  if (!draft) return res.status(404).json({ error: 'Không tìm thấy draft' });
  res.json(draft);
});

router.post('/drafts', (req, res) => {
  const { manifest, source } = req.body;
  const packageId = manifest?.packageId;
  if (!packageId || !PACKAGE_ID_RE.test(packageId)) {
    return res.status(400).json({ error: 'manifest.packageId thiếu hoặc sai định dạng (kebab-case, 2-64 ký tự)' });
  }
  if (fs.existsSync(draftDir(req.user.id, packageId))) {
    return res.status(409).json({ error: `Draft "${packageId}" đã tồn tại` });
  }
  writeDraft(req.user.id, packageId, manifest, source);
  res.json({ success: true, packageId });
});

router.put('/drafts/:packageId', (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const { manifest, source } = req.body;
  if (!manifest || manifest.packageId !== req.params.packageId) {
    return res.status(400).json({ error: 'manifest.packageId phải khớp với URL' });
  }
  if (!fs.existsSync(draftDir(req.user.id, req.params.packageId))) {
    return res.status(404).json({ error: 'Không tìm thấy draft' });
  }
  writeDraft(req.user.id, req.params.packageId, manifest, source);
  res.json({ success: true });
});

router.delete('/drafts/:packageId', (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const dir = draftDir(req.user.id, req.params.packageId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Không tìm thấy draft' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ success: true });
});

// Test Console: run a draft's own entry file through the same Sandbox Host runtime a real
// packageId@version workflow node uses (backend/engine/executor.js's runRegistryPackage) —
// straight off the draft directory, no install()/node_installations round-trip needed first.
// Missing limits are filled with a small local default (drafts aren't required to have filled in
// the Runtime tab's limits yet) — this is Test Console-only leniency, never applied to an
// installed package's real run (executor.js's own registry branch requires the schema's real
// required limits, no fallback).
router.post('/drafts/:packageId/test', async (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const draft = readDraft(req.user.id, req.params.packageId);
  if (!draft) return res.status(404).json({ error: 'Không tìm thấy draft' });
  if (!draft.manifest.runtime?.type || !draft.manifest.runtime?.entry) {
    return res.status(400).json({ error: 'Chưa khai báo runtime.type/runtime.entry ở tab Runtime' });
  }

  const { inputs = {}, config = {} } = req.body;
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-console-'));
  const logs = [];
  const context = {
    scratchDir: () => scratchDir,
    log: (msg) => logs.push(msg),
  };

  const startedAt = Date.now();
  try {
    installDependencies(draftDir(req.user.id, req.params.packageId));
    const manifestForRun = { ...draft.manifest, limits: { timeoutSeconds: 30, memoryMB: 256, maxOutputMB: 16, ...draft.manifest.limits } };
    const output = await runRegistryPackage(manifestForRun, draftDir(req.user.id, req.params.packageId), inputs, config, context);
    res.json({ ok: true, output, logs, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    res.json({ ok: false, error: err.message, logs, elapsedMs: Date.now() - startedAt });
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

// LocalDraft -> LocalInstalled (§2 state machine): pack the draft directory into a .sfpkg
// (backend/registry/sfpkg.js's pack() — validates the full Manifest v2 schema, unlike draft save
// above) then install it (backend/registry/install.js) exactly like any other package. The
// draft itself is left in place afterward so the user can keep iterating toward a new version.
router.post('/drafts/:packageId/install', async (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const dir = draftDir(req.user.id, req.params.packageId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Không tìm thấy draft' });

  const outFile = path.join(os.tmpdir(), `sfpkg-${crypto.randomUUID()}.sfpkg`);
  try {
    await pack({ sourceDir: dir, outFile });
    const result = install({ archiveFile: outFile, installedBy: req.user.id });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    fs.rmSync(outFile, { force: true });
  }
});

// Custom Node Platform Phase 5/6 follow-up: real approvedPaths for capabilities.filesystem:
// "user-approved-path" packages (see backend/engine/executor.js's runRegistryPackage). Approval
// is per install (packageId+version), set explicitly here — never inferred from a node's config
// value — and persisted in node_installations.approved_paths (backend/registry/install.js).
// Each path must already exist as a real directory: this is meant to be paired with the
// frontend's native folder picker (store.js's pickFolder()), not typed free-hand, so a
// nonexistent path here is either a stale approval or a mistake, not a "not created yet" case
// (unlike a node's own scratch/output dir, which legitimately doesn't exist until the node runs).
router.put('/installed/:packageId/:version/approved-paths', (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const { packageId, version } = req.params;
  if (!getInstallation(packageId, version)) return res.status(404).json({ error: 'Không tìm thấy package đã cài' });

  const { paths } = req.body;
  if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string')) {
    return res.status(400).json({ error: 'paths phải là mảng string' });
  }
  for (const p of paths) {
    if (!path.isAbsolute(p)) return res.status(400).json({ error: `Đường dẫn phải là absolute path: ${p}` });
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      return res.status(400).json({ error: `Thư mục không tồn tại: ${p}` });
    }
  }

  try {
    setApprovedPaths(packageId, version, paths);
    res.json({ success: true, paths });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Custom Node Platform Phase 8: the "Run anyway" 1-lần acknowledgment for a Revoked version
// with network capability (backend/registry/revocation-check.js's assertNotBlocked). Any
// authenticated user can acknowledge (same team-wide trust model as the rest of this router,
// not admin-gated — it's the OWN machine-wide installation they're choosing to keep running).
router.post('/installed/:packageId/:version/acknowledge-revocation', (req, res) => {
  if (!PACKAGE_ID_RE.test(req.params.packageId)) return res.status(400).json({ error: 'packageId không hợp lệ' });
  const { packageId, version } = req.params;
  if (!getInstallation(packageId, version)) return res.status(404).json({ error: 'Không tìm thấy package đã cài' });
  try {
    acknowledgeRevocation(packageId, version);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
