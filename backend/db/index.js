const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = __dirname;
const DB_PATH = path.join(DB_DIR, 'space-flow.sqlite');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

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
  for (const [name, cred] of Object.entries(legacy)) {
    insert.run(crypto.randomUUID(), 'public', name, cred.type, JSON.stringify(cred.data));
  }
}

module.exports = db;
