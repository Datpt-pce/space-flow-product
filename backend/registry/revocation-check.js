// Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
// runtime revocation gate — checked every time a registry package resolves for execution
// (backend/engine/executor.js's runRegistryPackage), independent of whatever a workflow
// node.type string alone would otherwise resolve to via backend/registry-installs/.
//
// Policy (plan §5 Phase 8): a Revoked version with NO declared network capability keeps
// running — there's nowhere for revocation-worthy harm (data exfiltration, callback to an
// attacker) to go without network access, and blocking it would just break existing
// workflows for no safety gain. Only a Revoked version that DOES declare network capability is
// blocked, unless a user has explicitly acknowledged the risk once via
// PUT /api/local-nodes/installed/:packageId/:version/acknowledge-revocation (persisted in
// node_installations.revocation_acknowledged, reset on every fresh revoke — see
// backend/routes/registry-admin.js). A package that was never submitted to the registry at all
// (pure Local Private draft/install, no node_versions row) is never affected by this check.
//
// Deprecated is NOT handled here — it's a soft signal only (surfaced as a status badge in My
// Nodes / Registry tab), never blocks execution.

const db = require('../db');

class RevokedPackageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RevokedPackageError';
    this.code = 'PACKAGE_REVOKED';
  }
}

function getVersionStatus(packageId, version) {
  const row = db.prepare('SELECT status FROM node_versions WHERE package_id = ? AND version = ?').get(packageId, version);
  return row ? row.status : null;
}

function hasNetworkCapability(manifest) {
  return Array.isArray(manifest?.capabilities?.network) && manifest.capabilities.network.length > 0;
}

// assertNotBlocked(packageId, version, manifest) — throws RevokedPackageError if this exact
// version is Revoked, declares network capability, and nobody has acknowledged running it
// anyway yet. No-op (returns) in every other case.
function assertNotBlocked(packageId, version, manifest) {
  const status = getVersionStatus(packageId, version);
  if (status !== 'Revoked') return;
  if (!hasNetworkCapability(manifest)) return;

  const installation = db.prepare('SELECT revocation_acknowledged FROM node_installations WHERE package_id = ? AND version = ?').get(packageId, version);
  if (installation?.revocation_acknowledged) return;

  throw new RevokedPackageError(
    `Package "${packageId}@${version}" đã bị revoke và có network capability — bị chặn chạy cho tới khi xác nhận "Chạy tiếp" ở My Nodes.`
  );
}

module.exports = { assertNotBlocked, RevokedPackageError, getVersionStatus, hasNetworkCapability };
