var t=Object.defineProperty;var e=(E,T)=>t(E,"name",{value:T,configurable:!0});const SHEET_REVISION_RETENTION=20;function ensureSheetSchema(E){E.exec(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'team')) DEFAULT 'private',
      schema_version INTEGER NOT NULL DEFAULT 1,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sheet_revisions (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_revisions_sheet ON sheet_revisions(sheet_id, created_at);

    CREATE TABLE IF NOT EXISTS sheet_external_links (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'google_sheets',
      spreadsheet_id TEXT NOT NULL,
      remote_sheet_id TEXT,
      tab_range_map TEXT NOT NULL DEFAULT '{}',
      owner_credential_ref TEXT REFERENCES credentials(id) ON DELETE SET NULL,
      mode TEXT NOT NULL CHECK (mode IN ('import_once', 'linked_readonly', 'two_way')) DEFAULT 'import_once',
      refresh_interval_seconds INTEGER NOT NULL DEFAULT 60,
      last_sync_at TEXT,
      remote_snapshot_hash TEXT,
      local_revision_id TEXT REFERENCES sheet_revisions(id) ON DELETE SET NULL,
      sync_status TEXT NOT NULL CHECK (sync_status IN ('synced', 'pending', 'conflict', 'offline', 'permission_lost')) DEFAULT 'pending',
      last_error TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_external_links_sheet ON sheet_external_links(sheet_id);

    CREATE TABLE IF NOT EXISTS sheet_port_bindings (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      tab_id TEXT NOT NULL,
      range_a1 TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
      workflow_node_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_port_bindings_sheet ON sheet_port_bindings(sheet_id);
  `)}e(ensureSheetSchema,"ensureSheetSchema");function pruneSheetRevisions(E,T){E.prepare(`
    DELETE FROM sheet_revisions
    WHERE sheet_id = ? AND rowid NOT IN (
      SELECT rowid FROM sheet_revisions WHERE sheet_id = ? ORDER BY rowid DESC LIMIT ?
    )
  `).run(T,T,20)}e(pruneSheetRevisions,"pruneSheetRevisions"),module.exports={ensureSheetSchema,pruneSheetRevisions,SHEET_REVISION_RETENTION:20};
