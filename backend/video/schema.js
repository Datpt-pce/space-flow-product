var s=Object.defineProperty;var E=(e,T)=>s(e,"name",{value:T,configurable:!0});function ensureVideoSchema(e){e.exec(`CREATE TABLE IF NOT EXISTS video_batch_speech_jobs (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES video_batch_projects(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, machine_id TEXT NOT NULL, source_hash TEXT NOT NULL,
    request_json TEXT NOT NULL, result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_batch_speech_owner_item ON video_batch_speech_jobs(owner_id,project_id,item_id);`),e.exec(`CREATE TABLE IF NOT EXISTS video_automation_inputs (
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
  );`),e.exec(`CREATE TABLE IF NOT EXISTS video_capcut_packages (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    render_job_id TEXT NOT NULL, package_path TEXT NOT NULL, report_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`),e.exec(`CREATE TABLE IF NOT EXISTS video_batch_capcut_packages (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES video_batch_projects(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL, request_hash TEXT NOT NULL, input_hash TEXT NOT NULL,
    machine_id TEXT NOT NULL, package_path TEXT NOT NULL, report_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prepared', installed_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(owner_id, request_key)
  );`),e.exec(`CREATE TABLE IF NOT EXISTS video_named_versions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, name TEXT NOT NULL, document_hash TEXT NOT NULL,
    dependencies_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS video_review_decisions (
    id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES video_named_versions(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('approved', 'changes_requested')),
    note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`),e.exec(`
    -- 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md): groups
    -- video_projects rows (each already a legacy Timeline on its own) under one named collection \u2014
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

    -- Phase 2 (04-video-editor.md \xA75): video-scoped for now (no shared Asset Service yet \u2014 see
    -- that section's "Quy\u1EBFt \u0111\u1ECBnh ki\u1EBFn tr\xFAc"), but shaped like that future service's contract
    -- already (stable id, content_hash, metadata, thumbnail/proxy ref, status) so migrating later
    -- only moves rows, never rewrites the hash/relink logic in routes/video-assets.js.
    -- content_hash is what RelinkAsset (shared/video-commands) trusts to confirm "same content,
    -- new location" \u2014 clips reference asset id, never source_path, so a relink never touches
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

    -- Phase 4 (04-video-editor.md \xA75): 1 row per render attempt, the source of truth
    -- backend/routes/video-render.js's GET (poll/SSE) reads back \u2014 the render itself runs
    -- detached from any single HTTP request (fire from POST /:projectId/render, update this row
    -- as ffmpeg reports -progress), so multiple pollers/reconnects all see the same state.
    -- output_path is only meaningful once status='done'. "retry" (task checklist) always INSERTs
    -- a brand-new row (fresh id) rather than mutating this one \u2014 an old row's own status/log stays
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
    -- (backend/routes/video-bulk-import.js) \u2014 appending a set of assets onto several timelines at
    -- once from TimelineDashboard.jsx's multi-select. Unlike video_render_jobs, this never needs a
    -- background worker (each per-timeline step is a plain DB command, not an ffmpeg run) \u2014 the
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
  `),ensureColumn(e,"video_render_jobs","preset_id","preset_id TEXT"),ensureColumn(e,"video_render_jobs","pinned_seq","pinned_seq INTEGER"),ensureColumn(e,"video_render_jobs","idempotency_key","idempotency_key TEXT"),e.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_render_jobs_idempotency
      ON video_render_jobs(project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `),ensureColumn(e,"video_render_jobs","manifest_json","manifest_json TEXT"),ensureColumn(e,"video_render_jobs","attempt_count","attempt_count INTEGER NOT NULL DEFAULT 0"),ensureColumn(e,"video_render_jobs","max_attempts","max_attempts INTEGER NOT NULL DEFAULT 3"),ensureColumn(e,"video_render_jobs","attempt_token","attempt_token TEXT"),ensureColumn(e,"video_render_jobs","lease_until","lease_until INTEGER"),ensureColumn(e,"video_render_jobs","cancel_requested","cancel_requested INTEGER NOT NULL DEFAULT 0"),ensureColumn(e,"video_render_jobs","phase","phase TEXT NOT NULL DEFAULT 'queued'"),ensureColumn(e,"video_project_commands","idempotency_key","idempotency_key TEXT"),e.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_project_commands_idempotency
      ON video_project_commands(project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `),ensureColumn(e,"video_projects","archived_at","archived_at TEXT"),ensureColumn(e,"video_projects","collection_id","collection_id TEXT REFERENCES video_timeline_collections(id)"),e.exec("CREATE INDEX IF NOT EXISTS idx_video_projects_collection ON video_projects(collection_id);"),ensureColumn(e,"video_timeline_collections","archived_at","archived_at TEXT"),ensureColumn(e,"video_bulk_import_operations","undone_at","undone_at TEXT"),ensureColumn(e,"video_assets","rights_json","rights_json TEXT"),ensureColumn(e,"video_assets","removed_from_bin_at","removed_from_bin_at TEXT"),ensureColumn(e,"video_assets","source_locality","source_locality TEXT NOT NULL DEFAULT 'agent'"),ensureColumn(e,"video_assets","source_machine_id","source_machine_id TEXT"),ensureColumn(e,"video_assets","original_source_path","original_source_path TEXT"),ensureColumn(e,"video_assets","preview_status","preview_status TEXT CHECK (preview_status IN ('queued','running','done','error'))"),ensureColumn(e,"video_assets","preview_progress","preview_progress REAL"),ensureColumn(e,"video_assets","preview_error","preview_error TEXT"),e.exec(`
    CREATE TABLE IF NOT EXISTS video_batch_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL UNIQUE REFERENCES video_timeline_collections(id),
      revision INTEGER NOT NULL DEFAULT 0,
      draft_json TEXT NOT NULL,
      archived_members_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_batch_owner ON video_batch_projects(owner_id);
    CREATE TABLE IF NOT EXISTS video_batch_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES video_batch_projects(id),
      owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, count INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS video_batch_run_items (
      run_id TEXT NOT NULL REFERENCES video_batch_runs(id), row_index INTEGER NOT NULL,
      assignments_json TEXT NOT NULL, timeline_id TEXT NOT NULL REFERENCES video_projects(id),
      version_id TEXT NOT NULL REFERENCES video_named_versions(id), document_hash TEXT NOT NULL,
      render_jobs_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(run_id, row_index)
    );
    CREATE TABLE IF NOT EXISTS video_batch_deliveries (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, run_id TEXT NOT NULL, row_index INTEGER NOT NULL,
      request_key TEXT NOT NULL, intent_json TEXT NOT NULL, receipt_json TEXT, state TEXT NOT NULL DEFAULT 'planned',
      error TEXT, asset_id TEXT REFERENCES video_assets(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(run_id,row_index) REFERENCES video_batch_run_items(run_id,row_index), UNIQUE(owner_id,request_key)
    );
    -- Changes through the ordinary collection UI also invalidate a Lab editor's CAS.
    CREATE TRIGGER IF NOT EXISTS video_batch_collection_revision
    AFTER UPDATE OF name, archived_at ON video_timeline_collections
    WHEN OLD.name IS NOT NEW.name OR OLD.archived_at IS NOT NEW.archived_at
    BEGIN
      UPDATE video_batch_projects SET revision = revision + 1 WHERE collection_id = NEW.id;
    END;
  `)}E(ensureVideoSchema,"ensureVideoSchema");function ensureColumn(e,T,o,i){e.prepare(`PRAGMA table_info(${T})`).all().some(t=>t.name===o)||e.exec(`ALTER TABLE ${T} ADD COLUMN ${i}`)}E(ensureColumn,"ensureColumn"),module.exports={ensureVideoSchema};
