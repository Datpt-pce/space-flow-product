// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md §5 Phase 1 task
// checklist): "backend/video/schema.js: bảng video_projects... video_project_commands...
// video_project_snapshots". A separate module (unlike Custom Node Platform's tables, which all
// live inline in backend/db/index.js) — deliberate compartmentalization for a large new feature
// area, called once from db/index.js right after the database is opened.
//
// video_projects: mirrors `workflows`'s shape (id/owner_id/name/payload/timestamps) but for a
// DIFFERENT reason payload exists here — workflows has no command log at all (payload IS the
// state), whereas here payload is only ever a best-effort CACHE of the current materialized
// state, kept in sync as a courtesy (e.g. for a fast project-list preview) but never the source
// of truth. backend/routes/video-projects.js's recoverProjectState() always reconstructs current
// state from video_project_snapshots + video_project_commands instead — see that function's own
// comment for why (Phase 1 acceptance criteria: "kill server giữa lúc ghi command log → replay
// log+snapshot khôi phục đúng state cuối").
//
// video_project_commands: append-only log, 1 row per command ever applied, seq monotonic
// per project starting at 1 (seq 0 is reserved for the initial snapshot created at project
// creation — see below — so recovery always has a well-defined anchor, never an ambiguous
// "no snapshot yet, fall back to something" case).
//
// video_project_snapshots: periodic full-state snapshots (every SNAPSHOT_INTERVAL commands, see
// video-projects.js) so recovery never has to replay the ENTIRE history of a long-lived project,
// only the tail since the latest snapshot.

function ensureVideoSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS video_automation_inputs (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('recipe', 'component', 'creative-variant')),
    parent_id TEXT REFERENCES video_automation_inputs(id), name TEXT NOT NULL,
    payload_json TEXT NOT NULL, content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_video_automation_inputs_owner ON video_automation_inputs(owner_id, kind);
  CREATE TABLE IF NOT EXISTS video_compilations (
    project_id TEXT PRIMARY KEY REFERENCES video_projects(id) ON DELETE CASCADE,
    creative_version_id TEXT NOT NULL REFERENCES video_automation_inputs(id),
    recipe_version_id TEXT NOT NULL REFERENCES video_automation_inputs(id),
    plan_json TEXT NOT NULL, report_json TEXT NOT NULL, document_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS video_automation_operations (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(owner_id, idempotency_key)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS video_capcut_packages (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    render_job_id TEXT NOT NULL, package_path TEXT NOT NULL, report_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  // Named pins remain metadata over the immutable command history (ADR 0039).
  db.exec(`CREATE TABLE IF NOT EXISTS video_named_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, name TEXT NOT NULL, document_hash TEXT NOT NULL,
    dependencies_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS video_review_decisions (
    id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES video_named_versions(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('approved', 'changes_requested')),
    note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  db.exec(`
    -- 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md): groups
    -- video_projects rows (each already a legacy Timeline on its own) under one named collection —
    -- created BEFORE video_projects below so that table's collection_id FK target exists. No
    -- TimelineVersion table: (project id, command seq) is that identity already, see the ADR.
    CREATE TABLE IF NOT EXISTS video_timeline_collections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_timeline_collections_owner ON video_timeline_collections(owner_id);

    CREATE TABLE IF NOT EXISTS video_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS video_project_commands (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      args_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_project_commands_seq ON video_project_commands(project_id, seq);

    CREATE TABLE IF NOT EXISTS video_project_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_project_snapshots_seq ON video_project_snapshots(project_id, seq);

    -- Phase 2 (04-video-editor.md §5): video-scoped for now (no shared Asset Service yet — see
    -- that section's "Quyết định kiến trúc"), but shaped like that future service's contract
    -- already (stable id, content_hash, metadata, thumbnail/proxy ref, status) so migrating later
    -- only moves rows, never rewrites the hash/relink logic in routes/video-assets.js.
    -- content_hash is what RelinkAsset (shared/video-commands) trusts to confirm "same content,
    -- new location" — clips reference asset id, never source_path, so a relink never touches
    -- clip data.
    CREATE TABLE IF NOT EXISTS video_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      content_hash TEXT,
      size_bytes INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('video', 'audio', 'image')),
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      fps REAL,
      codec_v TEXT,
      codec_a TEXT,
      thumbnail_path TEXT,
      proxy_path TEXT,
      status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ok', 'offline', 'error')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_assets_owner ON video_assets(owner_id);

    -- Phase 4 (04-video-editor.md §5): 1 row per render attempt, the source of truth
    -- backend/routes/video-render.js's GET (poll/SSE) reads back — the render itself runs
    -- detached from any single HTTP request (fire from POST /:projectId/render, update this row
    -- as ffmpeg reports -progress), so multiple pollers/reconnects all see the same state.
    -- output_path is only meaningful once status='done'. "retry" (task checklist) always INSERTs
    -- a brand-new row (fresh id) rather than mutating this one — an old row's own status/log stays
    -- exactly as it ended, purely historical.
    CREATE TABLE IF NOT EXISTS video_render_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
      progress_pct REAL NOT NULL DEFAULT 0,
      output_path TEXT,
      error_message TEXT,
      log TEXT NOT NULL DEFAULT '',
      preset_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_render_jobs_project ON video_render_jobs(project_id);

    -- 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md): 1 row per BulkTimelineImportOperation
    -- (backend/routes/video-bulk-import.js) — appending a set of assets onto several timelines at
    -- once from TimelineDashboard.jsx's multi-select. Unlike video_render_jobs, this never needs a
    -- background worker (each per-timeline step is a plain DB command, not an ffmpeg run) — the
    -- whole operation runs synchronously inside the POST handler and this row is written once,
    -- already in its final status; results_json (per-target success/error) is written back
    -- unconditionally, retry only re-attempts entries whose result was an error.
    CREATE TABLE IF NOT EXISTS video_bulk_import_operations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      collection_id TEXT REFERENCES video_timeline_collections(id),
      idempotency_key TEXT,
      ordered_asset_ids_json TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('completed', 'completed_with_errors', 'failed')),
      results_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_bulk_import_ops_owner ON video_bulk_import_operations(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_bulk_import_ops_idempotency
      ON video_bulk_import_operations(owner_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  // Phase 16 (§0): which backend/video/renderPresets.js entry this job was queued with — NULL
  // (pre-Phase-16 rows, and any job never given an explicit presetId) means 'original', read that
  // way everywhere this column is consulted (backend/routes/video-render.js). A safe column-add
  // (`ensureColumn`, not `ALTER TABLE` unconditionally) since `video_render_jobs` may already exist
  // live from before this phase — same pattern backend/db/index.js's own ensureColumn() already
  // established for `users.status` etc., duplicated here (not imported) to keep this module's own
  // "compartmentalized, no cross-dependency on db/index.js internals" shape (this file's header).
  ensureColumn(db, 'video_render_jobs', 'preset_id', 'preset_id TEXT');

  // 08-B B4 (specs/ai-creative-operations-platform/08-v2/08-b-composition-document-and-versioning.md)
  // — "pin": the command seq a render request was made against, captured at POST /:projectId/render
  // time. Before this column existed, a render that had to wait in the render QUEUE (Phase 16 —
  // another job already running for this owner) re-fetched the project's CURRENT state only when
  // it actually started, which could by then include edits made AFTER the user clicked Export —
  // silently rendering something other than what they asked for. NULL means "use latest at
  // execution time" (pre-migration rows, and every `/retry` job — retry intentionally re-fetches
  // current state, see that route's own comment for why that stays unchanged).
  ensureColumn(db, 'video_render_jobs', 'pinned_seq', 'pinned_seq INTEGER');

  // 08-J J1 (specs/.../08-v2/08-j-render-and-deliverables.md): same idempotency-key pattern as
  // video_project_commands right below — a caller retrying POST /:projectId/render (e.g. after a
  // client timeout for a submit that actually succeeded) gets the ORIGINAL job back instead of a
  // second, duplicate ffmpeg run for the same intent. Scoped (project_id, idempotency_key), not
  // owner-wide, since the same key could legitimately mean "this export" for one project and
  // something unrelated for another.
  ensureColumn(db, 'video_render_jobs', 'idempotency_key', 'idempotency_key TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_render_jobs_idempotency
      ON video_render_jobs(project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  // 08-J J5/J6: `manifest_json` is only ever written once, right when a job's real output passes
  // post-render verification (ffprobe: real video stream, non-zero/non-corrupt duration, close to
  // the render plan's own computed totalDurationMs) and is about to become `status='done'` — a job
  // that fails verification becomes `status='error'` instead, and NEVER gets a manifest, so
  // "manifest_json IS NOT NULL" alone is already a reliable "this output was verified" signal.
  // Deliberately a JSON blob on the existing row (not a new table) — this is lineage metadata for
  // ONE already-immutable finished job, not something ever queried/joined across jobs yet.
  ensureColumn(db, 'video_render_jobs', 'manifest_json', 'manifest_json TEXT');
  ensureColumn(db, 'video_render_jobs', 'attempt_count', 'attempt_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'video_render_jobs', 'max_attempts', 'max_attempts INTEGER NOT NULL DEFAULT 3');
  ensureColumn(db, 'video_render_jobs', 'attempt_token', 'attempt_token TEXT');
  ensureColumn(db, 'video_render_jobs', 'lease_until', 'lease_until INTEGER');
  ensureColumn(db, 'video_render_jobs', 'cancel_requested', 'cancel_requested INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'video_render_jobs', 'phase', "phase TEXT NOT NULL DEFAULT 'queued'");

  // 08-D D2 (specs/ai-creative-operations-platform/08-v2/08-d-durable-editing-transactions.md) +
  // ADR 0030 Follow-Up (docs/decisions/0030-composition-document-canonical-model-and-legacy-
  // migration.md): optional client-supplied idempotency key so a retried POST
  // /:id/commands (e.g. after a client timeout for a request that actually succeeded) returns the
  // original CommandResult instead of applying the command a second time — enforced at the DB
  // level (partial unique index, NULL never conflicts) rather than only in application code, so a
  // future caller bypassing backend/routes/video-projects.js can't silently defeat it.
  ensureColumn(db, 'video_project_commands', 'idempotency_key', 'idempotency_key TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_project_commands_idempotency
      ON video_project_commands(project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  // 08-E E7 (specs/.../08-v2/08-e-editor-node-and-workbench.md): NULL = active project. Set = soft-
  // deleted ("in trash") — hidden from GET / and ProjectSwitcher's main list, AND 404s on GET/PUT
  // /:id, POST /:id/commands and GET /:id/timeline-collection too (requireActiveOwner() in
  // backend/routes/video-projects.js), degrading exactly like the old hard-delete did (E4's "not
  // found" recovery screen) until restored. See that route file for archive/restore/permanent-
  // delete/list-archived.
  ensureColumn(db, 'video_projects', 'archived_at', 'archived_at TEXT');

  // 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md): NULL =
  // this project is standalone (not in any collection) — the state every pre-existing row already
  // has, unaffected by this column existing. `Timeline` is still just a `video_projects` row;
  // `TimelineCollection` (video_timeline_collections below) only groups them, never touches how any
  // one timeline's own content is edited.
  ensureColumn(db, 'video_projects', 'collection_id', 'collection_id TEXT REFERENCES video_timeline_collections(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_video_projects_collection ON video_projects(collection_id);');

  // 08-B B6 (specs/.../08-v2/08-b-composition-document-and-versioning.md): collection lifecycle —
  // same soft-delete shape as video_projects.archived_at above (E7 precedent). NULL = active
  // collection, unaffected for every pre-existing row. Archiving/deleting a collection never
  // cascades to its member video_projects rows — see backend/routes/video-timeline-collections.js's
  // archive/delete/detach routes for the no-cascade contract.
  ensureColumn(db, 'video_timeline_collections', 'archived_at', 'archived_at TEXT');
  ensureColumn(db, 'video_bulk_import_operations', 'undone_at', 'undone_at TEXT');
  ensureColumn(db, 'video_assets', 'rights_json', 'rights_json TEXT');
  ensureColumn(db, 'video_assets', 'removed_from_bin_at', 'removed_from_bin_at TEXT');
  ensureColumn(db, 'video_assets', 'source_locality', "source_locality TEXT NOT NULL DEFAULT 'agent'");
}

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

module.exports = { ensureVideoSchema };
