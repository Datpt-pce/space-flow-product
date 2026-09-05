// Video Editor Phase 2 (specs/space-flow-master-plan/04-video-editor.md §5): "frontend/src/video/
// store.js (Zustand riêng, không nhét vào store.js hiện có của Flow)". Media Bin's asset list is
// always fetched fresh from the server (GET /api/video-assets already does the offline-liveness
// check server-side) — no localStorage persistence needed for assets, unlike the Flow store's canvas
// state. `pendingCommands` below is the one narrow exception (08-D D6, crash/offline draft recovery).
//
// Phase 3 adds the project/timeline half to this SAME store (one store for the whole video
// feature, mirroring the main app's one-store-for-Flow pattern) rather than a second file: project
// state, the CommandStack instance (frontend/src/video/commands/CommandStack.js), playhead and
// clip selection. Phase 4 adds render/export job tracking the same way.

import { create } from 'zustand';
import {
  fetchVideoAssets, importVideoAsset, recordVoiceAsset, relinkVideoAsset, deleteVideoAsset,
  fetchVideoProjects, fetchVideoProject, createVideoProject, deleteVideoProject, postVideoCommand,
  batchCreateVideoProjectsFromVideos, fetchVideoProjectRevision,
  startRenderJob, streamRenderJob, fetchRenderJobs, cancelRenderJob, retryRenderJob,
  fetchVideoCapability, promoteRenderJobToAsset, fetchVideoProjectStateAtSeq,
} from '../lib/api.js';
import { createCommandStack } from './commands/CommandStack.js';
import { createDefaultProjectPayload } from './defaultProject.js';
import { findClipLocation } from './timelineUtils.js';
import { postCommandWithRetry } from './commandRetry.js';
import { planCompoundUnpack } from '@shared/video-compound';
import { prepareTrackCleanup } from '@shared/video-commands';

// 08-D D6 (specs/.../08-v2/08-d-durable-editing-transactions.md): pendingCommands (below) tracks
// commands applied locally but not yet confirmed persisted — before D6 that queue lived in memory
// only, so a crash/tab-close/reload before the background POST settled silently reverted to the
// server's last confirmed state with no trace. These 3 helpers add just enough localStorage
// persistence to replay + retry the same commands, under their ORIGINAL idempotencyKey, when the SAME
// project is reopened. Deliberately keyed per-project (not global) and cleared on explicit project
// switch (see openProject below) — abandoning a DIFFERENT project's unsaved edits by navigating away
// is the same tradeoff discardPendingAndResync already makes, D6 only covers the reload-same-project
// case.
const pendingCommandsStorageKey = (projectId) => `video-pending-commands:${projectId}`;

function readPendingCommandsFromStorage(projectId) {
  try {
    const raw = localStorage.getItem(pendingCommandsStorageKey(projectId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writePendingCommandsToStorage(projectId, pendingCommands) {
  try {
    const key = pendingCommandsStorageKey(projectId);
    if (pendingCommands.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pendingCommands.map(({ id, type, args }) => ({ id, type, args }))));
  } catch {
    // localStorage unavailable/full/private-mode — D6 recovery degrades to pre-D6 behavior (a reload
    // loses pending commands), it never blocks the edit itself.
  }
}

// 08-D D5 (specs/.../08-v2/08-d-durable-editing-transactions.md): persistQueue serializes every
// attemptPersist() attempt into strict submission order — a plain module-level promise chain, not
// store state (purely internal sequencing, nothing to render). This is what makes `baseRevision`
// (below) SAFE to compute as just "whatever get().currentRevision is right now": by the time a
// queued attempt's postFn actually runs, every earlier-submitted command has already resolved (won
// on the server and bumped currentRevision, or ended up in an 'error'/'conflict' pendingCommands
// entry without moving it) — there's never a second attempt "in flight" whose outcome this one's
// base could race against. Without this, 2 commands fired back-to-back would both compute
// baseRevision from the SAME stale currentRevision (neither has landed yet to bump it), and the
// second would spuriously conflict against the first's own still-pending write the instant the
// first succeeds — a false positive, not a real multi-session conflict. One shared queue for the
// whole module is correct because this app only ever has ONE video store instance per tab (ES
// module singleton, same assumption `useVideoStore`'s own single `create()` call already makes).
let persistQueue = Promise.resolve();
const renderSubscriptions = new Map();
let exportIntent = null;
function readGraphDockPreference() {
  try { return localStorage.getItem('video.graphDocked') === 'true'; } catch { return false; }
}

export const useVideoStore = create((set, get) => ({
  graphDocked: readGraphDockPreference(),
  graphFocusToken: 0,
  graphInspectorActive: readGraphDockPreference(),
  setGraphDocked: (docked) => {
    try { localStorage.setItem('video.graphDocked', String(docked)); } catch { /* optional layout preference */ }
    set({ graphDocked: docked, graphInspectorActive: docked, graphFocusToken: get().graphFocusToken + 1 });
  },
  setGraphInspectorActive: (active) => set({ graphInspectorActive: active, graphFocusToken: get().graphFocusToken + 1 }),
  assets: [],
  assetsVersion: 0, // bumped by every mutation of `assets` (fetch/import/relink) — see fetchAssets()'s own comment
  loading: false,
  error: null,
  importingPath: null, // source path currently being imported, or null — drives a per-action busy state (import can take a while: probe+thumbnail+proxy)
  relinkingId: null, // asset id currently being relinked, or null
  deletingAssetIds: [], // 08-C C5: ids currently mid-delete (deleteSelectedAssets) — [] when idle

  // fetchAssets() guards against a real race Phase 3's Workspace Shell (the first real consumer
  // that mounts MediaBin) exposed: it fires once on mount, and if the user imports/relinks an
  // asset before that GET resolves (plausible — the GET can be slow with many rows, import always
  // takes real ffmpeg time), the mount's fetchAssets() response would otherwise land LAST and
  // silently overwrite the newer optimistic state with a stale snapshot missing the just-imported
  // asset. Capturing assetsVersion before the request and checking it's unchanged on return
  // detects "something newer already happened" and skips applying the stale response.
  fetchAssets: async () => {
    const versionAtStart = get().assetsVersion;
    set({ loading: true, error: null });
    try {
      const assets = await fetchVideoAssets();
      if (get().assetsVersion !== versionAtStart) { set({ loading: false }); return; }
      set({ assets, loading: false, assetsVersion: versionAtStart + 1 });
    } catch (err) {
      if (get().assetsVersion !== versionAtStart) { set({ loading: false }); return; }
      set({ error: err.message, loading: false });
    }
  },

  importAsset: async (sourcePath) => {
    set({ importingPath: sourcePath, error: null });
    try {
      const asset = await importVideoAsset(sourcePath);
      // Real race, not hypothetical: a fetchAssets() GET that was ALREADY in flight when this
      // import's POST committed server-side can resolve and land (assetsVersion guard above
      // correctly lets it, since nothing newer had happened yet at ITS start) with this exact
      // asset already in the list — then this prepend would add a second copy of the same id if
      // it didn't filter first. Caught by tests/e2e/ui/video-canvas-engine-spike.spec.js's own
      // console-error assertion (React "duplicate key" warning), 2 back-to-back imports in a row.
      set((s) => ({ assets: [asset, ...s.assets.filter((a) => a.id !== asset.id)], importingPath: null, assetsVersion: s.assetsVersion + 1 }));
      return asset;
    } catch (err) {
      set({ error: err.message, importingPath: null });
      throw err;
    }
  },

  // recordVoiceAsset(dataBase64, extension) — Phase 15 (§0): same dedup-against-fetchAssets()
  // pattern importAsset() above already uses (see that action's own comment for the exact race it
  // guards against; a recording landing right as a background fetchAssets() GET is already in
  // flight is the identical scenario, just triggered by the mic instead of a file picker).
  recordVoiceAsset: async (dataBase64, extension) => {
    set({ importingPath: 'recording', error: null });
    try {
      const asset = await recordVoiceAsset(dataBase64, extension);
      set((s) => ({ assets: [asset, ...s.assets.filter((a) => a.id !== asset.id)], importingPath: null, assetsVersion: s.assetsVersion + 1 }));
      return asset;
    } catch (err) {
      set({ error: err.message, importingPath: null });
      throw err;
    }
  },

  relinkAsset: async (id, newPath) => {
    set({ relinkingId: id, error: null });
    try {
      const updated = await relinkVideoAsset(id, newPath);
      set((s) => ({ assets: s.assets.map((a) => (a.id === id ? updated : a)), relinkingId: null, assetsVersion: s.assetsVersion + 1 }));
      return updated;
    } catch (err) {
      set({ error: err.message, relinkingId: null });
      throw err;
    }
  },

  // deleteSelectedAssets() — 08-C C5: deletes every currently-selected asset. Best-effort PER ITEM,
  // not atomic — each asset is an independent resource (unlike batchCreateTimelines' single-project
  // atomicity), so one asset still referenced by a timeline (backend rejects 409) must not block the
  // others from being removed. Returns { deletedIds, failed } so MediaBin.jsx can show which ones
  // failed and why instead of one opaque error swallowing a partially-successful bulk delete.
  deleteSelectedAssets: async () => {
    const ids = [...get().selectedAssetIds];
    if (ids.length === 0) return { deletedIds: [], failed: [] };
    set({ deletingAssetIds: ids, error: null });

    const deletedIds = [];
    const failed = [];
    for (const id of ids) {
      try {
        await deleteVideoAsset(id);
        deletedIds.push(id);
      } catch (err) {
        failed.push({ id, error: err.message });
      }
    }

    set((s) => ({
      assets: s.assets.filter((a) => !deletedIds.includes(a.id)),
      selectedAssetIds: s.selectedAssetIds.filter((id) => !deletedIds.includes(id)),
      assetSelectionAnchorId: deletedIds.includes(s.assetSelectionAnchorId) ? null : s.assetSelectionAnchorId,
      deletingAssetIds: [],
      assetsVersion: s.assetsVersion + 1,
      error: failed.length > 0 ? `Không xoá được ${failed.length} asset: ${failed.map((f) => f.error).join('; ')}` : s.error,
    }));
    return { deletedIds, failed };
  },

  clearError: () => set({ error: null }),

  // --- Project / timeline (Phase 3) ---
  project: null, // { id, name } | null
  // breadcrumbParent — 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md):
  // { id, name } | null of the project that was open right before openNestedTimeline() (below)
  // navigated away from it, so VideoWorkspace.jsx can render a "← Back to <parent>" affordance.
  // Reset by every openProject() call (including a manual ProjectSwitcher pick, or navigating back
  // itself) — deliberately single-level, not a full stack: a breadcrumb 2+ levels deep is not
  // something F5's own acceptance criteria asks for.
  breadcrumbParent: null,
  projectState: null, // current timeline state (tracks/clips/...), mirrors commandStack.getState()
  commandStack: null,
  canUndo: false,
  canRedo: false,
  projectLoading: false,
  projectError: null,
  playheadMs: 0,
  // 08.2.1 (specs/ai-creative-operations-platform/08-2-1-selection-navigation-and-feedback.md §1):
  // selection is UI session state, not composition content — `selectedIds` is ORDERED (insertion
  // order, not timeline order), `primaryId` decides Inspector context/canvas handles/relative-
  // transform anchor. Never routed through commandStack/execute(): undo()/redo() never restore or
  // re-add to selection, they only PRUNE dead ids (see loadOrCreateProject()'s stack.subscribe
  // below) — deleting a clip already clears selection explicitly as part of the delete gesture
  // itself (Timeline.jsx/VideoToolbar.jsx), so undoing that delete does not re-select it.
  selectedIds: [],
  primaryId: null,

  // saveStatus mirrors sheet/store.js's own field (Toolbar.jsx already renders that pattern) —
  // 'idle' until the first command, 'saving' while execute()'s background POST is in flight,
  // 'saved'/'error' on settle. Purely a UI indicator, never read by any command/undo logic.
  saveStatus: 'idle',

  // livePreviewPatch: { entries: [{ clipId | transitionId, path: [...relativePath], value }] } | null
  // — an EPHEMERAL, non-undoable, non-persisted preview of an in-progress drag/slider gesture
  // (TransformOverlay, EffectsPanel's colorGrade/volume sliders). `path` is relative to the CLIP
  // object (e.g. ['transform', 'x']), not an absolute tracks/clips index — indices can't shift
  // mid-drag anyway, but resolving by id keeps this decoupled from track/clip ordering. Never
  // touches commandStack or the network; Player.jsx merges it onto `projectState` for rendering
  // only. The gesture's owner clears it and commits a real SetProperty/SetProperties exactly once,
  // on release.
  livePreviewPatch: null,
  setLivePreviewPatch: (entries) => set({ livePreviewPatch: { entries } }),
  clearLivePreviewPatch: () => set({ livePreviewPatch: null }),

  // openProject(projectId, projectName?) — loads a project by id, (re)creates the command stack,
  // and resets the per-document UI state (selection/playhead/save-status/live-preview-patch) that
  // would otherwise leak from whatever was open before. Extracted out of loadOrCreateProject()
  // below (08.2.4: the minimal project switcher, VideoWorkspace.jsx header, and
  // batchCreateTimelines()'s "open the first created timeline" both need this exact load path —
  // this app had no way to open a SECOND project before that spec, only ever "the" one).
  openProject: async (projectId, projectName) => {
    const previousProjectId = get().project?.id;
    if (previousProjectId !== projectId && get().pendingCommands.length) {
      set({ projectError: 'Đang lưu thay đổi. Hãy chờ lưu xong trước khi chuyển timeline.' });
      return;
    }
    for (const stop of renderSubscriptions.values()) stop();
    renderSubscriptions.clear();
    exportIntent = null;
    set({ projectLoading: true, projectError: null });
    try {
      const full = await fetchVideoProject(projectId);
      // Read BEFORE the pendingCommands:[] reset below — that reset's own set() call is itself a
      // "pendingCommands changed" event the storage-sync subscription (below the store) reacts to by
      // writing the (now empty) array back, which would otherwise erase this project's recovery data
      // out from under us before we get a chance to read it. Skipped entirely when this call is
      // discardPendingAndResync() re-opening the project THAT'S ALREADY OPEN (previousProjectId ===
      // projectId) — that call means "abandon the pending edits", replaying them here would silently
      // undo the very thing the user just asked for. A genuine reload always starts from a fresh
      // store (previousProjectId undefined), which this condition correctly treats as eligible.
      const restored = previousProjectId === projectId ? [] : readPendingCommandsFromStorage(projectId);
      const stack = createCommandStack(full.payload);
      // Fires on every execute()/undo()/redo() — prunes `selectedIds` down to ids that still
      // resolve in the new state and re-derives `primaryId` only if IT was the one dropped
      // (see `selectedIds`'s own comment above for why this never ADDS anything back).
      stack.subscribe((state) => {
        const { selectedIds, primaryId } = get();
        const prunedIds = selectedIds.filter((id) => findClipLocation(state, id));
        const nextPrimary = prunedIds.includes(primaryId) ? primaryId : (prunedIds[prunedIds.length - 1] ?? null);
        set({
          projectState: state, canUndo: stack.canUndo(), canRedo: stack.canRedo(),
          selectedIds: prunedIds, primaryId: nextPrimary,
        });
      });
      set({
        project: { id: projectId, name: projectName ?? full.name },
        projectState: full.payload,
        commandStack: stack,
        canUndo: stack.canUndo(),
        canRedo: stack.canRedo(),
        projectLoading: false,
        renderJobs: [], exportError: null, isExportSubmitting: false,
        selectedIds: [], primaryId: null, playheadMs: 0, saveStatus: 'idle', livePreviewPatch: null,
        // 08-D D3: a fresh/re-load always starts with an empty pending queue — any entry from the
        // PREVIOUS project (or a discardPendingAndResync() call on this same one) referred to a
        // commandStack that no longer exists, retrying it now would be meaningless.
        pendingCommands: [],
        recoveredCommandCount: null,
        // 08-E E5: `currentRevision` is THIS tab's own belief of the latest seq — updated here (from
        // GET /:id's own `seq`, added alongside `payload`) and after every successful command below.
        // `staleVersionDetected` always resets on a fresh load — we just fetched the truth.
        currentRevision: full.seq ?? null,
        staleVersionDetected: false,
        // 08-F F5: reset on every load — openNestedTimeline() (below) sets this back AFTER
        // openProject() itself resolves, so a manual switch (ProjectSwitcher) or "Back" correctly
        // clears it, while "Open nested timeline" correctly re-establishes it.
        breadcrumbParent: null,
      });
      if (previousProjectId && previousProjectId !== projectId) {
        // Explicit switch away from a DIFFERENT project — same abandonment tradeoff as
        // discardPendingAndResync, not D6's crash-recovery case.
        writePendingCommandsToStorage(previousProjectId, []);
      }
      // 08-D D6: replay any commands still unconfirmed the last time THIS project was open in this
      // browser — covers crash/tab-close/reload before postAndTrack's background POST settled.
      // Known, documented tradeoff (same spirit as D3's "not a full ordered queue" scope-down): if a
      // command's success response arrived but the tab died before the .then() handler ran (removing
      // it from pendingCommands / clearing storage), `full.payload` already reflects it server-side —
      // replaying it here re-applies it a SECOND time locally. The server stays correct (the retry
      // POST below reuses the same idempotencyKey, which the backend's unique index turns into a
      // no-op replay per D2), but the client would show a duplicated edit. This window requires the
      // network round-trip to have already completed with the tab dying before running a JS callback.
      // D5's baseRevision (now wired below) does NOT close this specific gap — applyCommand() checks
      // idempotencyKey BEFORE baseRevision (backend/routes/video-projects.js), so an idempotent replay
      // hit returns the ORIGINAL cached success before baseRevision is ever consulted. Still accepted
      // as out of scope: closing it needs the client to distrust its OWN local replay result against
      // the freshly-fetched `full.payload` (reconcile, not just retry), a bigger change than D6's
      // "replay + retry persistence" scope.
      if (restored.length > 0) {
        const applied = [];
        for (const entry of restored) {
          try {
            stack.execute(entry.type, entry.args);
            applied.push(entry);
          } catch {
            // The document changed shape since this command was queued (e.g. the clip it targeted no
            // longer exists) — can't safely replay or persist it; drop it rather than corrupt state.
          }
        }
        if (applied.length > 0) {
          set((s) => ({
            saveStatus: 'saving',
            pendingCommands: applied.map((e) => ({ ...e, status: 'saving', errorMessage: null })),
            recoveredCommandCount: applied.length,
          }));
          applied.forEach((entry) => {
            get().attemptPersist(entry.id, (key) => postVideoCommand(projectId, entry.type, entry.args, key, get().currentRevision));
          });
        }
      }
    } catch (err) {
      set({ projectError: err.message, projectLoading: false });
    }
  },

  // openNestedTimeline(nestedId, nestedName) — 08-F F5 / ADR 0034: navigates INTO a compound
  // clip's embedded timeline (a normal video_projects row, already fully openable) while
  // remembering where we came from, so VideoWorkspace.jsx can render a "← Back to <parent>"
  // breadcrumb. Set AFTER openProject() resolves — openProject() itself always resets
  // breadcrumbParent to null as part of its own fresh-load state reset (see that field's comment).
  openNestedTimeline: async (nestedId, nestedName) => {
    const parent = get().project ? { ...get().project } : null;
    await get().openProject(nestedId, nestedName);
    if (parent) set({ breadcrumbParent: parent });
  },

  goToBreadcrumbParent: () => {
    const { breadcrumbParent, openProject } = get();
    if (breadcrumbParent) openProject(breadcrumbParent.id, breadcrumbParent.name);
  },

  // loadOrCreateProject() picks the owner's most recently updated project, or creates one with an
  // empty video+audio track pair — the FIRST project this browser session ever shows (still no
  // multi-project picker at the very start, only after 08.2.4's minimal switcher exists in
  // VideoWorkspace.jsx does the user get anywhere else to go).
  //
  // 08-E E3 minimal (specs/.../08-v2/08-e-editor-node-and-workbench.md): a `?projectId=` query
  // param, when present, deep-links straight to that project via openProject() instead of the
  // most-recently-updated fallback — this is what VideoEditorWorkbenchNode's "Mở Editor" button
  // navigates to. No param (direct /video visit) keeps the old fallback behavior byte-identical.
  loadOrCreateProject: async () => {
    // StrictMode double-invoke guard (same pattern VideoSpikeTest.jsx used) — `commandStack` alone
    // doesn't close the race: React 18 dev-mode invokes the mount effect TWICE synchronously
    // (effect → cleanup → effect again, no yield in between), so the 2nd call can still start
    // WHILE the 1st is mid-`await` (before `commandStack` is ever set) and would otherwise create a
    // 2nd, orphaned project. `projectLoading` is set synchronously as this function's very first
    // statement (before any `await`), so it's already true by the time a same-tick 2nd invocation
    // checks it — closing the gap `commandStack` alone left open.
    if (get().commandStack || get().projectLoading) return;
    set({ projectLoading: true, projectError: null });
    try {
      const deepLinkProjectId = new URLSearchParams(window.location.search).get('projectId');
      if (deepLinkProjectId) {
        await get().openProject(deepLinkProjectId);
        return;
      }
      const list = await fetchVideoProjects();
      let projectId;
      let projectName;
      if (list.length > 0) {
        projectId = list[0].id;
        projectName = list[0].name;
      } else {
        const created = await createVideoProject('Untitled Project', createDefaultProjectPayload());
        projectId = created.id;
        projectName = 'Untitled Project';
      }
      await get().openProject(projectId, projectName);
    } catch (err) {
      set({ projectError: err.message, projectLoading: false });
    }
  },

  // deleteProject(id) -> Promise<void> — 08-E E7 / 08-B B6: no UI ever called the backend's existing
  // DELETE /:id route before this (see deleteVideoProject()'s own comment in lib/api.js). Deleting a
  // project OTHER than the one this tab has open just removes it server-side — the caller (e.g.
  // ProjectSwitcher) is responsible for refreshing whatever list it showed. Deleting the CURRENTLY
  // open project needs this tab to land somewhere real afterward, reusing loadOrCreateProject()'s
  // existing "most recent, or create a fresh default" fallback rather than any new navigation logic
  // — but that function's OWN guard (`if (get().commandStack ...) return`) would otherwise treat the
  // just-deleted project's still-set commandStack as "already loaded" and no-op, so it's cleared
  // first. A `?projectId=` deep link pointing at the now-deleted id is also stripped from the URL
  // first — left in place, loadOrCreateProject() would deep-link straight back to it and hit a 404
  // (E4's graceful "project not found" screen, not broken, but not the "land somewhere real" this is
  // meant to do either).
  deleteProject: async (id) => {
    await deleteVideoProject(id);
    if (get().project?.id !== id) return;
    set({ project: null, commandStack: null, projectState: null, projectError: null });
    const params = new URLSearchParams(window.location.search);
    if (params.get('projectId') === id) {
      params.delete('projectId');
      const qs = params.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }
    await get().loadOrCreateProject();
  },

  // 08-D D3 (specs/.../08-v2/08-d-durable-editing-transactions.md): pendingCommands — an EXPLICIT
  // queue of commands applied locally but not yet confirmed persisted, replacing the old behavior
  // where a persistence failure surviving commandRetry's own retry just left `projectError` set
  // forever with no way to reconcile ("UI âm thầm lệch server", exactly what D3's acceptance §5
  // forbids). Each entry: { id (= the idempotencyKey, stable across retries), type, args, status:
  // 'saving'|'error'|'conflict' (D5, a 409 base-revision mismatch — see attemptPersist below),
  // errorMessage }. Persisted to localStorage across reload as of D6 (see that work's own helpers
  // near the top of this file) — this in-memory field is still the live source of truth the UI reads
  // every render, localStorage is only the crash-recovery backing store.
  pendingCommands: [],

  // 08-D D6 residual ("replay diagnostics" — the one item its own Project Status left explicitly
  // undone: "không chỉ tự động silent-replay"): count of commands openProject() just replayed from
  // localStorage after a crash/tab-close/reload, so the header banner below can tell the user their
  // edits were recovered instead of leaving the replay-then-persist cycle invisible whenever it
  // happens to succeed quickly. `null` = nothing to announce. Reset on every openProject() (including
  // discardPendingAndResync's re-open) and cleared by dismissRecoveryNotice() below.
  recoveredCommandCount: null,
  dismissRecoveryNotice: () => set({ recoveredCommandCount: null }),

  // postAndTrack(type, args, buildPostFn) -> the shared plumbing behind execute()/undo()/redo()
  // below: generates the idempotencyKey up front (so it can double as the queue entry's stable id
  // BEFORE the network call even starts, unlike before where commandRetry.js generated its own
  // internally and nothing outside it ever saw it), pushes a 'saving' entry, and resolves it to
  // either removal (success) or 'error'/'conflict' (see attemptPersist below) — never silently
  // drops the entry.
  //
  // attemptPersist(idempotencyKey, buildPostFn): the network attempt behind an ALREADY-tracked
  // pendingCommands entry — split out of postAndTrack() below so D6's crash-recovery replay
  // (openProject above) and retryPendingCommand() (below) can retry an EXISTING entry under its
  // ORIGINAL idempotencyKey instead of minting a new one, reusing the exact same handling.
  //
  // 08-D D5: chains onto the module-level `persistQueue` (see its own big comment above) instead of
  // firing immediately — this is what makes `baseRevision` (read fresh via `get().currentRevision`
  // inside each call site's buildPostFn, not passed in here) a correct base instead of a race. A
  // rejection from `.catch()` below is swallowed into a pendingCommands status update, never
  // re-thrown — so one failed/conflicted command never blocks `persistQueue` from moving on to
  // whatever was submitted after it.
  attemptPersist: (idempotencyKey, buildPostFn) => {
    persistQueue = persistQueue.then(() =>
      postCommandWithRetry((key) => buildPostFn(key), { idempotencyKey })
        .then((result) => {
          set((s) => {
            const pendingCommands = s.pendingCommands.filter((c) => c.id !== idempotencyKey);
            return {
              pendingCommands,
              saveStatus: pendingCommands.some((c) => c.status === 'error' || c.status === 'conflict') ? 'error' : 'saved',
              // 08-E E5: our OWN successful command already tells us the new latest seq (both a fresh
              // apply and an idempotent replay hit return `.seq`, see applyCommand()/getResultForSeq()
              // in backend/routes/video-projects.js) — no need for a separate poll for our own writes.
              currentRevision: result.seq ?? s.currentRevision,
            };
          });
        })
        .catch((err) => {
          // 08-D D5: a real 409 base-revision conflict (another session moved this project forward)
          // gets its OWN status, distinct from a generic network/validation 'error' — the UI (§
          // VideoWorkspace.jsx) shows a different message and offers only "Đồng bộ lại" for it, never
          // "Thử lại" (retrying would resend the exact same stale baseRevision and conflict again,
          // identically — commandRetry.js's own fast-path already skips wasting a retry on this, this
          // is the SAME distinction surfacing one level up for the human).
          set((s) => ({
            saveStatus: 'error',
            pendingCommands: s.pendingCommands.map((c) => (c.id === idempotencyKey
              ? { ...c, status: err.conflict ? 'conflict' : 'error', errorMessage: err.message }
              : c)),
          }));
        }),
    );
  },

  postAndTrack: (type, args, buildPostFn) => {
    const idempotencyKey = crypto.randomUUID();
    set((s) => ({
      saveStatus: 'saving',
      pendingCommands: [...s.pendingCommands, { id: idempotencyKey, type, args, status: 'saving', errorMessage: null }],
    }));
    get().attemptPersist(idempotencyKey, buildPostFn);
    return idempotencyKey;
  },

  // retryPendingCommand(id): re-POST the SAME {type, args} under the SAME idempotencyKey — safe to
  // call even if the original attempt actually landed server-side and only the response was lost
  // (backend's idempotency-key uniqueness returns the original CommandResult instead of re-applying,
  // see backend/routes/video-projects.js's applyCommand()). Local state is NOT re-applied (it
  // already was, at the original execute()/undo()/redo() call) — this only retries the PERSISTENCE.
  // Routed through attemptPersist() (queued + baseRevision-aware, same as every other call site)
  // rather than its own separate postVideoCommand()/.then()/.catch() as before D5 — a manual retry
  // deserves the exact same conflict-vs-error handling as an automatic one, and must not jump the
  // queue ahead of some other command still in flight.
  retryPendingCommand: (id) => {
    const { project, pendingCommands } = get();
    const entry = pendingCommands.find((c) => c.id === id);
    if (!entry || !project) return;
    set((s) => ({
      saveStatus: 'saving',
      pendingCommands: s.pendingCommands.map((c) => (c.id === id ? { ...c, status: 'saving', errorMessage: null } : c)),
    }));
    get().attemptPersist(id, (key) => postVideoCommand(project.id, entry.type, entry.args, key, get().currentRevision));
  },

  // discardPendingAndResync(): the deliberate escape hatch when retry keeps failing — re-fetches
  // the project's own last CONFIRMED server state (openProject(), which rebuilds commandStack from
  // scratch) and drops every pendingCommands entry with it. This LOSES whatever local-only edits
  // never made it to the server — a real, documented tradeoff (the alternative — silently keeping a
  // diverged local state forever — is exactly the D3 acceptance violation this feature exists to
  // fix). openProject() already resets pendingCommands to [] as part of its normal per-document
  // reset (see its own `set({...})` below).
  discardPendingAndResync: () => {
    const { project } = get();
    if (!project) return;
    get().openProject(project.id, project.name);
  },

  // 08-E E5 (specs/.../08-v2/08-e-editor-node-and-workbench.md): multi-tab/multi-session staleness
  // — the SAME project open in 2 tabs (or 2 devices) has no live push between them; without this, a
  // tab left in the background has no way to ever learn the OTHER tab already moved the project
  // forward, and would keep editing/showing a stale view indefinitely with no warning. Distinct from
  // (and complementary to) a 409 base_revision conflict (D5, now wired below) in WHEN it fires: this
  // is a passive background poll (visibilitychange/focus) that can warn BEFORE the user even attempts
  // an edit, purely a dismissible banner the user acts on when THEY choose to — D5's conflict only
  // fires REACTIVELY, the instant an actual edit attempt collides.
  staleVersionDetected: false,
  currentRevision: null,
  checkForStaleVersion: async () => {
    const { project, currentRevision } = get();
    if (!project || currentRevision == null) return;
    try {
      const { seq } = await fetchVideoProjectRevision(project.id);
      if (seq > currentRevision) set({ staleVersionDetected: true });
    } catch {
      // A transient network/agent hiccup checking staleness must never itself surface an error —
      // this is a background convenience check, not a user-initiated action (same principle
      // loadCapabilitySnapshot() above already follows for its own background check).
    }
  },

  // execute(type, args) applies the command LOCALLY first (commandStack.execute — synchronous,
  // throws immediately if validate() rejects it, so an invalid drag-drop/keyboard action never
  // reaches the network) then persists it in the background via postAndTrack() (08-D D2/D3) — an
  // explicit pendingCommands entry now tracks it end-to-end instead of a bare saveStatus flag, so a
  // persistence failure surviving retry is user-actionable (retryPendingCommand/
  // discardPendingAndResync), not silently stuck.
  //
  // 08-D D5: `get().currentRevision` is read INSIDE the buildPostFn closure, not destructured up
  // front — attemptPersist() below only actually invokes this once persistQueue reaches it, by
  // which point every earlier-submitted command has already resolved, so reading it lazily here
  // (rather than "whatever it was the instant execute() was called") is what makes it the correct
  // base for THIS command specifically.
  execute: (type, args) => {
    const { commandStack, project } = get();
    if (!commandStack) throw new Error('Chưa có project nào được tải');
    args = prepareTrackCleanup(commandStack.getState(), type, args);
    commandStack.execute(type, args);
    get().postAndTrack(type, args, (idempotencyKey) => postVideoCommand(project.id, type, args, idempotencyKey, get().currentRevision));
  },

  // 08-D D4: undo/redo persist too, same optimistic-local-then-background-POST shape as execute()
  // above. Undo posts a new "Undo" command (shared/video-commands/UndoCommand.js); redo simply
  // re-posts the ORIGINAL {type, args} as a brand-new forward command — both go through the exact
  // same server code path as any other edit, no special-casing on the backend, and now the same
  // pendingCommands tracking as execute() (08-D D3).
  undo: () => {
    const { commandStack, project } = get();
    const result = commandStack?.undo();
    if (!result) return; // nothing to undo
    const { undoneCommand } = result;
    const args = { originalType: undoneCommand.type, originalArgs: undoneCommand.args };
    get().postAndTrack('Undo', args, (idempotencyKey) => postVideoCommand(project.id, 'Undo', args, idempotencyKey, get().currentRevision));
  },
  redo: () => {
    const { commandStack, project } = get();
    const result = commandStack?.redo();
    if (!result) return; // nothing to redo
    const { redoneCommand } = result;
    get().postAndTrack(
      redoneCommand.type, redoneCommand.args,
      (idempotencyKey) => postVideoCommand(project.id, redoneCommand.type, redoneCommand.args, idempotencyKey, get().currentRevision),
    );
  },

  setPlayheadMs: (ms) => set({ playheadMs: Math.max(0, ms) }),

  // selectClip(clipId | null): single-select replace — kept as the simple entry point every
  // pre-multi-select call site (delete/split/create-cue/etc.) still uses unchanged.
  selectClip: (clipId) => set({ selectedIds: clipId ? [clipId] : [], primaryId: clipId || null }),
  // setSelection(ids, primaryId?): replace the whole set at once (marquee, Shift+click range).
  // `primaryId` defaults to the LAST id in `ids` (the most-recently-touched clip becomes primary).
  setSelection: (ids, primaryId) => set({
    selectedIds: [...ids],
    primaryId: primaryId !== undefined ? primaryId : (ids[ids.length - 1] ?? null),
  }),
  // toggleClipSelection(clipId): Mod+click — add/remove one id, keep the rest in place. Removing
  // the current primary falls back to whatever is now last in the remaining set.
  toggleClipSelection: (clipId) => set((s) => {
    if (s.selectedIds.includes(clipId)) {
      const nextIds = s.selectedIds.filter((id) => id !== clipId);
      return { selectedIds: nextIds, primaryId: s.primaryId === clipId ? (nextIds[nextIds.length - 1] ?? null) : s.primaryId };
    }
    return { selectedIds: [...s.selectedIds, clipId], primaryId: clipId };
  }),
  clearSelection: () => set({ selectedIds: [], primaryId: null }),

  // 08.2.4 §2 (Multi-selection contract): Gallery asset selection — a SEPARATE selection from
  // `selectedIds`/`primaryId` above (those are Timeline CLIP selection, a different concept).
  // `assetSelectionAnchorId` is the last asset clicked (plain OR Ctrl+click) — MediaBin.jsx
  // computes the actual Shift+click range (over its own currently filtered/sorted asset list) and
  // passes the result to setAssetSelection(); this store only holds the resulting set, it doesn't
  // know about Gallery sort/filter order itself.
  selectedAssetIds: [],
  assetSelectionAnchorId: null,
  selectAsset: (assetId) => set({ selectedAssetIds: [assetId], assetSelectionAnchorId: assetId }),
  // Anchor moves to `assetId` on EVERY Ctrl+click, add or remove — matches a desktop file manager's
  // own convention (the anchor tracks the last item you interacted with, not just the last one
  // added), and avoids a surprising Shift+range computed from an item that's no longer selected.
  toggleAssetSelection: (assetId) => set((s) => {
    if (s.selectedAssetIds.includes(assetId)) {
      return { selectedAssetIds: s.selectedAssetIds.filter((id) => id !== assetId), assetSelectionAnchorId: assetId };
    }
    return { selectedAssetIds: [...s.selectedAssetIds, assetId], assetSelectionAnchorId: assetId };
  }),
  // setAssetSelection(ids): replace the whole set — Shift+click range and Ctrl/Cmd+A both resolve
  // to a full replacement computed by the caller; anchor is left untouched (range-select doesn't
  // move the anchor, same convention as a desktop file manager).
  setAssetSelection: (ids) => set({ selectedAssetIds: [...ids] }),
  clearAssetSelection: () => set({ selectedAssetIds: [], assetSelectionAnchorId: null }),

  // 08.2.4: batch-create N timelines from a Gallery multi-selection — clears the Gallery selection
  // on success (the create-timeline dialog already confirmed mode/order/naming before calling
  // this) so the toolbar/context-menu affordance disappears once its job is done.
  batchCreateTimelines: async (mode, orderedAssetIds, baseName) => {
    const result = await batchCreateVideoProjectsFromVideos(mode, orderedAssetIds, baseName);
    get().clearAssetSelection();
    return result;
  },

  isPlaying: false,
  togglePlay: () => set(s => {
    const duration = Math.max(0, ...(s.projectState?.tracks || []).flatMap(t => t.clips.map(c => c.timelineOutMs)));
    return { isPlaying: !s.isPlaying, ...(!s.isPlaying && s.playheadMs >= duration ? { playheadMs: 0 } : {}) };
  }),
  pause: () => set({ isPlaying: false }),

  // --- Render / Export (Phase 4) ---
  renderJobs: [],
  exportError: null,
  isExportSubmitting: false,
  isExportPanelOpen: false,
  openExportPanel: () => set({ isExportPanelOpen: true }),
  closeExportPanel: () => set({ isExportPanelOpen: false }),

  loadRenderJobs: async () => {
    const { project } = get();
    if (!project) return;
    try {
      const jobs = await fetchRenderJobs(project.id);
      if (get().project?.id !== project.id) return;
      set((s) => ({ renderJobs: [...jobs, ...s.renderJobs.filter((j) => !jobs.some((loaded) => loaded.id === j.id))] }));
      for (const job of jobs) {
        if (job.status === 'queued' || job.status === 'running') get().watchJob(job.id);
      }
    } catch (err) {
      set({ exportError: err.message });
    }
  },

  // 08-C C6 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md):
  // proactive capability check — ExportPanel.jsx calls this when it opens, so a machine missing
  // ffmpeg/an encoder is caught BEFORE the user waits for a render job that would fail anyway
  // (ADR 0031's capability-gating goal). `capabilitySnapshot` stays null (no gate at all, same as
  // pre-C6 behavior) if the check itself can't be reached — a transient network/agent hiccup
  // fetching the check must not block an export that might well still succeed.
  capabilitySnapshot: null,
  capabilityCheckError: null,
  loadCapabilitySnapshot: async () => {
    try {
      const snapshot = await fetchVideoCapability();
      set({ capabilitySnapshot: snapshot, capabilityCheckError: null });
    } catch (err) {
      set({ capabilitySnapshot: null, capabilityCheckError: err.message });
    }
  },

  // watchJob(jobId) subscribes to the job's live SSE status and folds every update into
  // `renderJobs` in place — shared by both startExport() and retryExport() below.
  watchJob: (jobId) => {
    const { project } = get();
    if (!project || renderSubscriptions.has(jobId)) return;
    const stop = streamRenderJob(project.id, jobId, (statusUpdate) => {
      if (!statusUpdate || get().project?.id !== project.id) return;
      set((s) => ({ renderJobs: s.renderJobs.map((j) => (j.id === jobId ? { ...j, ...statusUpdate } : j)) }));
      if (['done', 'error', 'cancelled'].includes(statusUpdate.status)) renderSubscriptions.delete(jobId);
    });
    renderSubscriptions.set(jobId, stop);
  },

  startExport: async (presetId) => {
    const { project, watchJob, currentRevision, pendingCommands, projectLoading, isExportSubmitting } = get();
    if (!project || projectLoading || isExportSubmitting) return;
    if (pendingCommands.length || get().staleVersionDetected || get().saveStatus === 'error') {
      set({ exportError: 'Lưu và đồng bộ mọi thay đổi trước khi export.' });
      return;
    }
    const intentSignature = JSON.stringify([project.id, presetId, currentRevision]);
    if (exportIntent?.signature !== intentSignature) exportIntent = { signature: intentSignature, key: crypto.randomUUID() };
    set({ exportError: null, isExportSubmitting: true });
    try {
      const jobId = await startRenderJob(project.id, presetId, { idempotencyKey: exportIntent.key, baseRevision: currentRevision });
      if (get().project?.id !== project.id) return;
      exportIntent = null;
      set((s) => ({ renderJobs: [{ id: jobId, status: 'queued', progress_pct: 0, error_message: null, log: '', preset_id: presetId || 'original', pinned_seq: currentRevision }, ...s.renderJobs.filter((j) => j.id !== jobId)] }));
      watchJob(jobId);
    } catch (err) {
      if (get().project?.id === project.id) set({ exportError: err.message });
    } finally {
      if (get().project?.id === project.id) set({ isExportSubmitting: false });
    }
  },

  cancelExport: async (jobId) => {
    try {
      await cancelRenderJob(jobId);
    } catch (err) {
      set({ exportError: err.message });
    }
  },

  retryExport: async (jobId) => {
    const { watchJob, project, pendingCommands, isExportSubmitting } = get();
    if (!project || isExportSubmitting) return;
    if (pendingCommands.length || get().staleVersionDetected || get().saveStatus === 'error') {
      set({ exportError: 'Lưu và đồng bộ mọi thay đổi trước khi thử lại export.' });
      return;
    }
    set({ isExportSubmitting: true, exportError: null });
    try {
      const newJobId = await retryRenderJob(jobId);
      if (get().project?.id !== project.id) return;
      set((s) => ({ renderJobs: [{ id: newJobId, status: 'queued', progress_pct: 0, error_message: null, log: '' }, ...s.renderJobs] }));
      watchJob(newJobId);
    } catch (err) {
      if (get().project?.id === project.id) set({ exportError: err.message });
    } finally {
      if (get().project?.id === project.id) set({ isExportSubmitting: false });
    }
  },

  clearExportError: () => set({ exportError: null }),

  // --- Compound clip (08-F F5 / ADR 0034: docs/decisions/0034-compound-clip-minimal-slice.md) ---
  // embedOperation: { status: 'rendering'|'promoting'|'error', progress, timelineProjectId,
  // timelineProjectName, error } | null — a SEPARATE tracker from `renderJobs` above: this renders
  // a DIFFERENT project (the one being embedded), not the currently open one, and ends in an
  // InsertClip rather than a downloadable file. Only one embed runs at a time (matches the export
  // queue's own one-active-render-per-owner limit — a 2nd embed would just queue behind it anyway).
  embedOperation: null,
  dismissEmbedOperation: () => set({ embedOperation: null }),

  // embedTimelineAsCompoundClip({ timelineProjectId, timelineProjectName, trackId, index,
  // timelineInMs }) — renders the timeline being embedded (pinned to ITS current revision by the
  // existing POST /:projectId/render, same as any export), promotes the finished output into a
  // real asset, then inserts one ordinary clip referencing it — see ADR 0034 decision 1-4 for why
  // this needs no new render/preview code path at all.
  embedTimelineAsCompoundClip: async ({ timelineProjectId, timelineProjectName, trackId, index, timelineInMs }) => {
    if (get().embedOperation && get().embedOperation.status !== 'error') throw new Error('Chờ thao tác ghép timeline hiện tại hoàn tất.');
    const destinationProjectId = get().project?.id;
    if (timelineProjectId === destinationProjectId) throw new Error('Không thể ghép timeline vào chính nó.');
    set({ embedOperation: { status: 'rendering', progress: 0, timelineProjectId, timelineProjectName, error: null } });
    try {
      const jobId = await startRenderJob(timelineProjectId, 'original');
      await new Promise((resolve, reject) => {
        const stop = streamRenderJob(timelineProjectId, jobId, (statusUpdate) => {
          set((s) => (s.embedOperation ? { embedOperation: { ...s.embedOperation, progress: statusUpdate.progress_pct ?? s.embedOperation.progress } } : {}));
          if (statusUpdate.status === 'done') { stop(); resolve(); }
          else if (statusUpdate.status === 'error' || statusUpdate.status === 'cancelled') {
            stop();
            reject(new Error(statusUpdate.error_message || 'Render timeline lồng thất bại'));
          }
        });
      });

      set((s) => (s.embedOperation ? { embedOperation: { ...s.embedOperation, status: 'promoting' } } : {}));
      const { asset, pinnedSeq } = await promoteRenderJobToAsset(timelineProjectId, jobId);
      set((s) => ({ assets: [asset, ...s.assets.filter((a) => a.id !== asset.id)], assetsVersion: s.assetsVersion + 1 }));

      const clip = {
        id: crypto.randomUUID(), assetId: asset.id, sourceInMs: 0, sourceOutMs: asset.durationMs,
        timelineInMs, timelineOutMs: timelineInMs + asset.durationMs, speed: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
        // compoundRef — ADR 0034: purely additive, ignored by canvasEngine.js/Player.jsx/
        // renderPlanner.js (which only ever read clip.assetId); read only by the breadcrumb/
        // staleness badge/Unpack below. `timelineProjectName` is a denormalized display
        // convenience (avoids a project-list fetch just to label a clip) — if the nested project
        // is later renamed, this label goes stale too, same informational-only tradeoff as the
        // staleness badge itself; never used for anything except a button label.
        compoundRef: { timelineProjectId, timelineProjectName, pinnedSeq },
      };
      if (get().project?.id !== destinationProjectId) throw new Error('Timeline đang mở đã đổi; clip chưa được chèn. Mở lại timeline đích để thử lại.');
      const destination = get().projectState.tracks.find(t => t.id === trackId);
      if (!destination || destination.locked) throw new Error('Track đích không còn khả dụng.');
      if (destination.clips.some(c => c.timelineInMs < clip.timelineOutMs && c.timelineOutMs > clip.timelineInMs)) throw new Error('Vị trí ghép đã có clip khác. Chọn một khoảng trống rồi thử lại.');
      const currentIndex = destination.clips.filter(c => c.timelineInMs < clip.timelineInMs).length;
      get().execute('InsertClip', { trackId, index: currentIndex, clip });
      set({ embedOperation: null });
    } catch (err) {
      set((s) => ({ embedOperation: s.embedOperation ? { ...s.embedOperation, status: 'error', error: err.message } : null }));
    }
  },

  // unpackCompoundClip(trackId, clipId) — 08-F F5 / ADR 0034 Follow-Up: replaces a compound clip
  // with the literal tracks/clips of the timeline it embedded, fetched at the EXACT revision that
  // was actually rendered (compoundRef.pinnedSeq, not the nested project's current state) so the
  // result retains the pinned source window. The pure planner remaps source time,
  // cropped easing curves, track order, transitions and groups for trim/retime.
  unpackCompoundClip: async (trackId, clipId) => {
    const { projectState, execute } = get();
    const track = projectState?.tracks.find((t) => t.id === trackId);
    const index = track ? track.clips.findIndex((c) => c.id === clipId) : -1;
    const clip = index >= 0 ? track.clips[index] : null;
    if (!clip?.compoundRef) return;

    const { timelineProjectId, pinnedSeq } = clip.compoundRef;
    const nestedState = await fetchVideoProjectStateAtSeq(timelineProjectId, pinnedSeq);
    // The fetch can overlap another edit/project switch; never apply indices from
    // before that await to a newer document.
    if (get().projectState !== projectState) throw new Error('Timeline đã thay đổi trong lúc tải. Hãy thử bung lại.');
    execute('UnpackCompoundClip', planCompoundUnpack(projectState, trackId, clipId, nestedState, () => crypto.randomUUID()));
  },
}));

// 08-D D6: single choke point that keeps localStorage in sync with pendingCommands for whatever
// project is currently open — instead of threading a storage write into every one of postAndTrack/
// attemptPersist/retryPendingCommand/openProject's several pendingCommands mutation sites above, this
// fires once per state change and writes only when the pendingCommands array reference actually
// changed (which is exactly when one of those call sites touched it).
useVideoStore.subscribe((state, prevState) => {
  if (state.pendingCommands !== prevState.pendingCommands && state.project) {
    writePendingCommandsToStorage(state.project.id, state.pendingCommands);
  }
});
