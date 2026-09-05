const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = __dirname;
const DB_PATH = path.join(DB_DIR, 'space-flow.sqlite');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Graph Library Phase 8 (specs/space-flow-master-plan/02-graph-library.md) added a periodic
// background writer (backend/graph/reindexQueue.js's setInterval loop) to this same file — without
// a busy_timeout, 2 separate connections (this server process + any other process opening this
// same .sqlite file, e.g. a test file requiring backend/db directly) writing at the same instant
// hit "database is locked" immediately instead of waiting. 5s is long enough to ride out a brief
// write, short enough that a genuinely stuck lock still surfaces as an error, not a silent hang.
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Which node types / public credentials a non-admin user may use (Admin dashboard permission
  -- editor). Empty = nothing allowed — a user only gets access once Admin grants it explicitly.
  -- Keyed by credential NAME (not id) to match how credentials are already resolved/addressed
  -- everywhere else in this codebase (getCredential(name,userId), the config "credentialName"
  -- field, GET/POST/DELETE /api/credentials) — no extra id lookup needed at enforcement time.
  CREATE TABLE IF NOT EXISTS user_node_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL,
    PRIMARY KEY (user_id, node_type)
  );

  CREATE TABLE IF NOT EXISTS user_credential_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_name TEXT NOT NULL,
    PRIMARY KEY (user_id, credential_name)
  );

  -- Per-user, per-node/credential usage counters for the Admin dashboard (Phần 3).
  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('node', 'credential')),
    ref TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'team')) DEFAULT 'private',
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('public', 'private')),
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- SQLite treats each NULL as distinct in a normal UNIQUE constraint, which would let
  -- public credentials (owner_id IS NULL) duplicate by name — use partial indexes instead
  -- so "1 name per scope" (and "1 name per user for private") is actually enforced.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_public_name
    ON credentials(name) WHERE scope = 'public';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_private_owner_name
    ON credentials(owner_id, name) WHERE scope = 'private';

  -- App/Link catalog for resize-upload-v2 (name to UNC/Drive folder + thumbnail folder map).
  -- Not a secret, so kept out of the credentials table -- 1 shared public catalog (Admin-edited)
  -- plus at most 1 private override per user, resolved private-then-public like getCredential().
  CREATE TABLE IF NOT EXISTS resize_link_catalogs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('public', 'private')),
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_resize_link_catalogs_public
    ON resize_link_catalogs(scope) WHERE scope = 'public';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_resize_link_catalogs_private_owner
    ON resize_link_catalogs(owner_id) WHERE scope = 'private';

  -- Custom Node Platform Phase 2 (specs/space-flow-master-plan/01-custom-node-platform.md):
  -- tracks .sfpkg versions installed locally on this machine (backend/registry-installs/
  -- <package_id>/<version>/), separate from the built-in nodes/ directory. Registry-wide
  -- tables (node_packages, node_versions, submissions/review pipeline) are Phase 6 scope —
  -- not created here to avoid empty tables with no real consumer yet (see
  -- docs/decisions/0012-schema-migration-convention.md's same reasoning).
  CREATE TABLE IF NOT EXISTS node_installations (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    version TEXT NOT NULL,
    install_path TEXT NOT NULL,
    checksum TEXT NOT NULL,
    installed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_node_installations_package_version
    ON node_installations(package_id, version);

  -- Custom Node Platform Phase 6 (specs/space-flow-master-plan/01-custom-node-platform.md):
  -- Registry Data Model. Only the 4 tables with a real Phase 6 writer are created now — same
  -- "no empty table without a real consumer" reasoning as node_installations above and
  -- docs/decisions/0012-schema-migration-convention.md. node_reviews (human admin
  -- approve/reject/request-changes actions) and capability_grants (server-approved capability
  -- set per version) both stay Phase 7/8 scope: nothing in Phase 6 writes to either yet — there
  -- is no admin action, and the "Local Private" trust lane (§2) already gets capabilities
  -- straight from the manifest with no server-approval step at all.
  --
  -- node_packages: registry-wide identity for a packageId, independent of any 1 version.
  CREATE TABLE IF NOT EXISTS node_packages (
    package_id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- node_versions: 1 row per packageId+version ever submitted. Bytes/manifest/checksum are
  -- immutable once created (enforced in backend/routes/registry-submissions.js, not here) —
  -- "sửa sau submit phải tạo version mới" (§2 state machine). status mirrors the LATEST
  -- pipeline outcome; risk_score set by pipeline step 9.
  CREATE TABLE IF NOT EXISTS node_versions (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES node_packages(package_id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Submitted', 'AutomatedReview', 'ChangesRequested', 'AdminReview', 'Published', 'Deprecated', 'Revoked')),
    manifest TEXT NOT NULL,
    checksum TEXT NOT NULL,
    archive_path TEXT NOT NULL,
    risk_score TEXT CHECK (risk_score IN ('low', 'medium', 'high')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_node_versions_package_version
    ON node_versions(package_id, version);

  -- node_submissions: 1 row per pipeline RUN for a version (normally 1:1 with node_versions —
  -- resubmitting the same version's bytes is rejected — but kept separate from node_versions so
  -- a version's full pipeline history/log stays intact even if an admin ever re-triggers the
  -- pipeline later, without needing a new version bump for that).
  CREATE TABLE IF NOT EXISTS node_submissions (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES node_versions(id) ON DELETE CASCADE,
    submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('AutomatedReview', 'ChangesRequested', 'AdminReview')),
    pipeline_steps TEXT NOT NULL,
    risk_score TEXT CHECK (risk_score IN ('low', 'medium', 'high')),
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_node_submissions_version ON node_submissions(version_id);

  -- package_security_findings: itemized findings from pipeline steps 4/5 (vuln/license scan,
  -- static analysis) — kept separate from node_submissions.pipeline_steps (which only holds the
  -- pass/fail summary) so a future Admin Review UI (Phase 7) can render a findings table without
  -- parsing that JSON blob.
  CREATE TABLE IF NOT EXISTS package_security_findings (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES node_submissions(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    title TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_package_security_findings_submission ON package_security_findings(submission_id);

  -- Custom Node Platform Phase 7 (specs/space-flow-master-plan/01-custom-node-platform.md):
  -- Signing & Admin Review. node_signatures: 1 row per Published version — the Ed25519
  -- signature (backend/registry/signing.js) an admin's approve action produced, plus which key
  -- signed it (key_fingerprint, not the key itself) so a future key rotation can tell which
  -- historical versions were signed by which now-possibly-retired key.
  CREATE TABLE IF NOT EXISTS node_signatures (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES node_versions(id) ON DELETE CASCADE,
    signature TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'ed25519',
    signed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    signed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_node_signatures_version ON node_signatures(version_id);

  -- package_rollouts: publish channel + rollout percentage per Published version. 1 row created
  -- at approve time (channel defaults 'stable', rollout_percent 100 — no gradual-rollout UI yet,
  -- see 0029's Follow-Up) — kept as its own table rather than columns on node_versions because
  -- Phase 8 (lifecycle controls) will update this independently of node_versions.status.
  CREATE TABLE IF NOT EXISTS package_rollouts (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES node_versions(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('beta', 'stable')) DEFAULT 'stable',
    rollout_percent INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_package_rollouts_version ON package_rollouts(version_id);

  -- Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
  -- Lifecycle Controls. node_lifecycle_events: 1 row per admin deprecate/revoke/rollback action —
  -- the audit trail of WHO changed a Published version's status and WHY (note), and also what
  -- backend/routes/local-nodes.js surfaces to a user with that version installed ("thông báo user
  -- bị ảnh hưởng" — pull-based via the existing My Nodes list, not a separate notification inbox
  -- this app has no infrastructure for).
  CREATE TABLE IF NOT EXISTS node_lifecycle_events (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES node_versions(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('deprecate', 'revoke', 'rollback')),
    note TEXT,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_node_lifecycle_events_version ON node_lifecycle_events(version_id);

  -- Graph Library Phase 1 (specs/space-flow-master-plan/02-graph-library.md): relationship
  -- index consumed by the future Graph view. Always a derived projection rebuilt from each
  -- module's own tables (backend/graph/indexer.js) — never a source of truth itself
  -- (master-plan.md §2.2 "Graph là projection/index, không phải nguồn dữ liệu gốc").
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT,
    owner_id TEXT,
    meta TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

  -- Graph Library Phase 7 (specs/space-flow-master-plan/02-graph-library.md): a saved graph view
  -- (filter/color-groups/force-settings/camera/pinned positions) for either the Global Graph
  -- (scope = 'global') or 1 Local Graph rooted at an entity (scope = that entity id, e.g.
  -- 'workflow:<id>'). Column shape deliberately copies the workflows table (§3 phản biện #3) so
  -- migrating into a real Document Service later is a row move, not a schema redesign.
  CREATE TABLE IF NOT EXISTS saved_graph_views (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '{}',
    groups_json TEXT NOT NULL DEFAULT '[]',
    forces_json TEXT NOT NULL DEFAULT '{}',
    camera_json TEXT NOT NULL DEFAULT '{}',
    pinned_positions_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_saved_graph_views_owner_scope ON saved_graph_views(owner_id, scope);

  -- Graph Library Phase 8 (specs/space-flow-master-plan/02-graph-library.md): durability backstop
  -- for the graph index. routes/workflows.js still calls reindexWorkflow() synchronously in the
  -- request path (measured fast enough — see 02-graph-library.md §0 — so no reason to make the
  -- user wait longer for a queue round-trip); this table exists purely so a crash BETWEEN the
  -- workflow write and that synchronous call still leaves a trail a periodic consumer can finish.
  CREATE TABLE IF NOT EXISTS relationship_reindex_queue (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reindex_queue_unprocessed ON relationship_reindex_queue(processed_at);
`);

// Safe column-add for a table that may already exist live (unlike CREATE TABLE IF NOT EXISTS,
// which is a no-op on an existing table regardless of column differences).
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
// DEFAULT 'active' only backfills pre-existing rows (accounts created before this feature
// shipped) so nobody already using the app gets locked out. New accounts from now on are
// inserted with an explicit 'pending'/'active' value (routes/auth.js) — this default never
// applies to them. Valid values: 'pending' | 'active' | 'rejected' — validated in app code,
// not a CHECK constraint (ALTER TABLE ADD COLUMN + CHECK is unnecessarily fragile for 3 fixed
// strings).
ensureColumn('users', 'status', `status TEXT NOT NULL DEFAULT 'active'`);

// Custom Node Platform Phase 5/6 follow-up (specs/space-flow-master-plan/01-custom-node-
// platform.md): explicit per-install approval for capabilities.filesystem: "user-approved-path"
// packages — JSON array of absolute host paths, empty by default (default-deny; see
// backend/registry/install.js's getApprovedPaths/setApprovedPaths).
ensureColumn('node_installations', 'approved_paths', `approved_paths TEXT NOT NULL DEFAULT '[]'`);

// Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
// per-install "I understand this version was revoked and want to run it anyway" acknowledgment
// (see backend/registry/revocation-check.js) — 0 by default (block-by-default for a Revoked
// version with network capability), reset back to 0 on every fresh revoke
// (backend/routes/registry-admin.js) so acknowledging one revoke episode never silently
// carries over to a later one.
ensureColumn('node_installations', 'revocation_acknowledged', `revocation_acknowledged INTEGER NOT NULL DEFAULT 0`);

// One-time migration: import the legacy flat credentials/store.json (pre-DB) as public
// credentials, so nobody loses an in-use credential when this feature ships. Only runs
// when the table is still empty — never overwrites credentials created via the app.
const crypto = require('crypto');
const LEGACY_STORE_PATH = path.join(__dirname, '..', 'credentials', 'store.json');
const credentialCount = db.prepare('SELECT COUNT(*) c FROM credentials').get().c;
if (credentialCount === 0 && fs.existsSync(LEGACY_STORE_PATH)) {
  const legacy = JSON.parse(fs.readFileSync(LEGACY_STORE_PATH, 'utf8'));
  const insert = db.prepare(
    'INSERT INTO credentials (id, scope, owner_id, name, type, data) VALUES (?, ?, NULL, ?, ?, ?)'
  );
  const { encrypt } = require('../utils/encryption');
  for (const [name, cred] of Object.entries(legacy)) {
    insert.run(crypto.randomUUID(), 'public', name, cred.type, encrypt(JSON.stringify(cred.data)));
  }
}

// One-time migration: import the legacy flat nodes/resize-upload/custom_links.json (App/Link
// catalog, shared by resize-upload and resize-upload-v2) as the public resize_link_catalogs row,
// so a dev/agent machine that already has this file doesn't see an empty catalog after this
// feature ships — see specs/resize-upload-v2-central-credentials.md. Only runs when the table is
// still empty. On the central server in production this file normally doesn't exist (the old data
// lived on individual agent machines, unreachable from here) — a no-op there, by design.
const LEGACY_LINKS_PATH = path.join(__dirname, '..', '..', 'nodes', 'resize-upload', 'custom_links.json');
const linkCatalogCount = db.prepare('SELECT COUNT(*) c FROM resize_link_catalogs').get().c;
if (linkCatalogCount === 0 && fs.existsSync(LEGACY_LINKS_PATH)) {
  const legacyLinks = JSON.parse(fs.readFileSync(LEGACY_LINKS_PATH, 'utf8'));
  db.prepare('INSERT INTO resize_link_catalogs (id, scope, owner_id, data) VALUES (?, ?, NULL, ?)')
    .run(crypto.randomUUID(), 'public', JSON.stringify(legacyLinks));
}

// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): kept as its own module
// (backend/video/schema.js) rather than inlined here, unlike every Custom Node Platform table
// above — a large new feature area gets its own schema file from the start.
require('../video/schema').ensureVideoSchema(db);

// Sheet Phase 1 (specs/space-flow-master-plan/03-spreadsheet.md): same "own schema file"
// compartmentalization as Video Editor above.
require('../sheet/schema').ensureSheetSchema(db);

module.exports = db;
