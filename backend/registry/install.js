// Local versioned install layout — Custom Node Platform Phase 2
// (specs/space-flow-master-plan/01-custom-node-platform.md). Installs a verified .sfpkg into
// backend/registry-installs/<packageId>/<version>/, separate from the built-in nodes/
// directory (which keeps resolving node.type unversioned, per
// docs/decisions/0008-custom-node-sandbox-architecture.md finding #2 — this install layout is
// what makes packageId@version resolution possible for registry packages, without touching
// built-in node resolution at all).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const db = require('../db');
const { verify } = require('./sfpkg');
const { installDependencies } = require('./dependencies');
const { verifyArchive, getPublicKeyInfo } = require('./signing');

const INSTALLS_ROOT = path.join(__dirname, '..', 'registry-installs');

function installDir(packageId, version) {
  return path.join(INSTALLS_ROOT, packageId, version);
}

// install({ archiveFile, installedBy }) -> { packageId, version, installPath, checksum }
// Re-verifies the archive (never trusts a prior verify() call from elsewhere) before
// extracting — extraction only proceeds once verify() has confirmed no path-traversal/symlink
// entries and a schema-valid manifest.
function install({ archiveFile, installedBy = null }) {
  const bytes = fs.readFileSync(archiveFile);
  const result = verify({ buffer: bytes });
  if (!result.valid) {
    throw new Error(`Refusing to install invalid package: ${result.errors.join('; ')}`);
  }

  const { packageId, version } = result.manifest;
  const targetDir = installDir(packageId, version);
  fs.mkdirSync(targetDir, { recursive: true });

  const zip = new AdmZip(bytes);
  zip.extractAllTo(targetDir, true);

  try {
    installDependencies(targetDir);
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Dependency installation failed for ${packageId}@${version}: ${err.message}`);
  }

  db.prepare(`
    INSERT INTO node_installations (id, package_id, version, install_path, checksum, installed_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(package_id, version) DO UPDATE SET
      install_path = excluded.install_path,
      checksum = excluded.checksum,
      installed_by = excluded.installed_by,
      installed_at = datetime('now')
  `).run(crypto.randomUUID(), packageId, version, targetDir, result.checksum, installedBy);

  return { packageId, version, installPath: targetDir, checksum: result.checksum };
}

// installFromPublished({ packageId, version, installedBy }) — Custom Node Platform Phase 7:
// installs a Published (admin-approved+signed) registry version, independently re-verifying
// signature + checksum against ONLY what a genuinely separate machine could have downloaded
// (archive bytes, the stored signature, the CURRENT public key) — never trusting the DB's
// "status = Published" alone as proof of authenticity. Delegates the actual extraction to
// install() above, which re-verifies the archive/manifest schema itself too (zip-slip/symlink
// checks all still apply on top of the signature check here, not instead of it).
//
// Real cross-machine transport (an agent on a teammate's machine downloading from a hosted
// central server) is NOT implemented here — this function IS the verification boundary the plan
// asks for (Phase 7 acceptance criteria: tamper 1 byte → verify fail), exercised in-process
// against the same DB this server already has. See docs/decisions/0029's Follow-Up.
function installFromPublished({ packageId, version, installedBy = null }) {
  const versionRow = db.prepare(`SELECT * FROM node_versions WHERE package_id = ? AND version = ? AND status = 'Published'`).get(packageId, version);
  if (!versionRow) throw new Error(`Không tìm thấy version đã publish: ${packageId}@${version}`);

  const sigRow = db.prepare('SELECT signature, key_fingerprint FROM node_signatures WHERE version_id = ?').get(versionRow.id);
  if (!sigRow) throw new Error(`Version đã Published nhưng không có signature — dữ liệu không nhất quán: ${packageId}@${version}`);

  if (!fs.existsSync(versionRow.archive_path)) throw new Error(`Archive không còn trên đĩa: ${packageId}@${version}`);
  const archiveBuffer = fs.readFileSync(versionRow.archive_path);

  const { pem: publicKeyPem, fingerprint: currentFingerprint } = getPublicKeyInfo();
  if (sigRow.key_fingerprint !== currentFingerprint) {
    // No trusted-key rotation list yet (plan's "trusted public keys có version" — Phase 8+
    // follow-up) — a single active key is all this Phase supports, so a fingerprint mismatch
    // can only mean either tampering or an out-of-band key rotation this install path doesn't
    // know how to trust yet. Refusing either way is the safe default.
    throw new Error(`Signature ký bởi key "${sigRow.key_fingerprint}", khác key hiện tại "${currentFingerprint}" — từ chối cài`);
  }
  if (!verifyArchive(archiveBuffer, sigRow.signature, publicKeyPem)) {
    throw new Error(`Chữ ký không hợp lệ cho ${packageId}@${version} — archive có thể đã bị chỉnh sửa, từ chối cài`);
  }

  const actualChecksum = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
  if (actualChecksum !== versionRow.checksum) {
    throw new Error(`Checksum không khớp cho ${packageId}@${version} — từ chối cài`);
  }

  const tmpFile = path.join(os.tmpdir(), `sf-registry-install-${crypto.randomUUID()}.sfpkg`);
  fs.writeFileSync(tmpFile, archiveBuffer);
  try {
    return install({ archiveFile: tmpFile, installedBy });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function getInstallation(packageId, version) {
  return db.prepare('SELECT * FROM node_installations WHERE package_id = ? AND version = ?').get(packageId, version);
}

function listInstallations() {
  return db.prepare('SELECT * FROM node_installations ORDER BY installed_at DESC').all();
}

// Custom Node Platform Phase 5/6 follow-up: approved host filesystem paths for a package
// declaring capabilities.filesystem: "user-approved-path" (see backend/registry/manifest-
// schema.json). Approval is per install (package_id+version), set explicitly by a user via
// PUT /api/local-nodes/installed/:packageId/:version/approved-paths (backend/routes/
// local-nodes.js) — never inferred or defaulted, so a package that declares this capability but
// nobody has approved anything for gets the same "clear filesystem error" behavior
// backend/engine/executor.js's runRegistryPackage already documents.
function getApprovedPaths(packageId, version) {
  const row = getInstallation(packageId, version);
  if (!row || !row.approved_paths) return [];
  try {
    const parsed = JSON.parse(row.approved_paths);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setApprovedPaths(packageId, version, paths) {
  const result = db.prepare('UPDATE node_installations SET approved_paths = ? WHERE package_id = ? AND version = ?')
    .run(JSON.stringify(paths), packageId, version);
  if (result.changes === 0) throw new Error(`No installation found for ${packageId}@${version}`);
}

// acknowledgeRevocation(packageId, version) — Custom Node Platform Phase 8: the "Run anyway" 1
// lần user action backend/registry/revocation-check.js requires before a Revoked version with
// network capability is allowed to execute again. Reset back to 0 by
// backend/routes/registry-admin.js on every fresh revoke, so this never carries over past the
// revoke episode a user actually saw the warning for.
function acknowledgeRevocation(packageId, version) {
  const result = db.prepare('UPDATE node_installations SET revocation_acknowledged = 1 WHERE package_id = ? AND version = ?')
    .run(packageId, version);
  if (result.changes === 0) throw new Error(`No installation found for ${packageId}@${version}`);
}

module.exports = { install, installFromPublished, getInstallation, listInstallations, installDir, getApprovedPaths, setApprovedPaths, acknowledgeRevocation };
