// Sheet Phase 1 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 1 task checklist):
// document model for `sheet`, independent of any UI, following the same "own schema file"
// compartmentalization backend/video/schema.js already established for a large new feature area
// (unlike Custom Node Platform's tables, which live inline in backend/db/index.js).
//
// sheets: mirrors `workflows`'s shape (id/owner_id/name/visibility/timestamps), but `snapshot`
// wraps the engine payload in an envelope ({schemaVersion, engine, engineVersion, workbook}) per
// 03-spreadsheet.md §3 phản biện #6 — so migrating to a real Document Service later, or swapping
// the underlying engine (Univer today), never requires a destructive migration of existing rows.
// Unlike video_projects there is no command log here — Univer's own undo/redo lives client-side
// (Facade API), and the server only ever needs the latest full snapshot to autosave/restore, not
// a replayable history of every edit.
//
// sheet_revisions: point-in-time copies of `sheets.snapshot`, kept for recovery/audit. Retention
// policy (§4 Phase 1 checklist "chốt policy giữ tối đa N revision gần nhất"): keep the most recent
// SHEET_REVISION_RETENTION per sheet, pruning older ones on every insert — same order of magnitude
// as video's SNAPSHOT_INTERVAL (20), chosen because a workbook snapshot is a full JSON blob (can
// be MB-sized per §4 Phase 1 "Rủi ro riêng"), so unbounded retention risks unbounded DB growth for
// a feature (point-in-time recovery) that rarely needs more than a handful of recent checkpoints.
//
// sheet_external_links: 1 row per Google Sheets link (Phase 3/4/6 consumer — created now so the
// column shape doesn't have to be guessed later from those phases' task checklists in isolation).
// owner_credential_ref points at the `credentials` table by id (not embedding the token here) —
// §3 phản biện #7 flags secret-at-rest for OAuth tokens as an open cross-cutting question, so this
// column is deliberately just a reference, not a place a Sheet-specific encryption scheme could
// accidentally get invented.
//
// sheet_port_bindings: kept as its OWN table rather than nested in the snapshot JSON blob — §3
// phản biện #4: Flow needs to query "which workflow does this sheet feed" without parsing another
// module's snapshot blob (master-plan.md §4 "không để module đọc trực tiếp bảng DB nội bộ của
// module khác" — the inverse direction, Flow reading Sheet, still goes through a queryable table/
// route, not a blob). Phase 1 only creates the table; the CRUD routes are Phase 2 scope (§4).

const SHEET_REVISION_RETENTION = 20;

function ensureSheetSchema(db) {
  db.exec(`
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
  `);
}

// pruneSheetRevisions(sheetId): delete every revision beyond the SHEET_REVISION_RETENTION most
// recent for this sheet. Called after every revision insert (backend/routes/sheets.js) rather
// than on a timer — keeps the retention invariant true at all times, no separate cleanup job.
//
// Orders by the table's implicit `rowid` (monotonic insertion order), NOT `created_at`: SQLite's
// datetime('now') only has 1-second resolution, so autosave PUTs arriving within the same second
// (very plausible — this is exactly what a debounced autosave under fast typing looks like) tie on
// created_at, and breaking that tie by `id` (a random UUID, uncorrelated with insertion order)
// would prune/keep an arbitrary subset instead of the actual most-recent ones. rowid has no such
// ambiguity.
function pruneSheetRevisions(db, sheetId) {
  db.prepare(`
    DELETE FROM sheet_revisions
    WHERE sheet_id = ? AND rowid NOT IN (
      SELECT rowid FROM sheet_revisions WHERE sheet_id = ? ORDER BY rowid DESC LIMIT ?
    )
  `).run(sheetId, sheetId, SHEET_REVISION_RETENTION);
}

module.exports = { ensureSheetSchema, pruneSheetRevisions, SHEET_REVISION_RETENTION };
