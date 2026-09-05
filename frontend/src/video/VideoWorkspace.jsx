// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): the first real
// Workspace Shell — mount point for MediaBin.jsx (Phase 2, never rendered anywhere until now),
// Timeline.jsx/Player.jsx/VideoToolbar.jsx (this phase). Mounted at /video
// (frontend/src/main.jsx), replacing the temporary VideoSpikeTest.jsx now that Player.jsx covers
// its one real job (real <video>-tag seek latency measurement — see tests/e2e/ui/
// video-workspace.spec.js).
//
// Auth gate mirrors App.jsx (checkSession/currentUser/authChecked from the MAIN app store,
// ../store.js) — VideoSpikeTest.jsx never needed this since it was reached only by already having
// an authenticated session open elsewhere, but a standalone Workspace Shell page should work from
// a fresh tab too.
//
// 08.1 (specs/ai-creative-operations-platform/08-1-editor-ux-foundation.md): this component is
// mounted INSTEAD OF App.jsx on the /video route (see lib/main.jsx), so it never picked up
// App.jsx's own `data-appearance` effect — every design token in index.css silently fell back to
// its literal default, and dark/light theme switching did nothing here. Fixed below by mirroring
// that same effect. This pass also restructures the shell to CSS Grid (DOM order now matches the
// spec's required tab order: Media -> Preview -> Inspector -> Timeline, while the VISIBLE layout
// is unchanged — Timeline still spans the full width at the bottom) and adds the project/save-
// status bar + resizable/collapsible panels §3/§8 ask for.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowLeft, Loader2, Check, AlertCircle, Download, Trash2, RotateCcw, Group as GroupIcon, LayoutGrid, X } from 'lucide-react';
import { useStore } from '../store.js';
import { useVideoStore } from './store.js';
import { fetchVideoProjects, fetchArchivedVideoProjects, restoreVideoProject, permanentlyDeleteVideoProject } from '../lib/api.js';
import LoginGate from '../components/LoginGate.jsx';
import MediaBin from './components/MediaBin.jsx';
import Player from './components/Player.jsx';
import Timeline from './components/Timeline.jsx';
import ProjectTimelines from './components/ProjectTimelines.jsx';
import TimelineDashboard from './components/TimelineDashboard.jsx';
import BulkImportDialog from './components/BulkImportDialog.jsx';
import TransportBar from './components/TransportBar.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import RenderedPreviewDialog from './components/RenderedPreviewDialog.jsx';
import VersionsDialog from './components/VersionsDialog.jsx';
import ConflictDialog from './components/ConflictDialog.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import EffectsPanel from './components/EffectsPanel.jsx';
import VectorPanel from './components/VectorPanel.jsx';
import DockedGraphEditor from './components/DockedGraphEditor.jsx';
import CaptionPanel from './components/CaptionPanel.jsx';
import { findClipLocation } from './timelineUtils.js';
import { useResizablePanel } from './useResizablePanel.js';
import './video.css';

const SAVE_STATUS_LABEL = { idle: '', saving: 'Đang lưu…', saved: 'Đã lưu', error: 'Lỗi lưu' };

// 08.2.4 (specs/ai-creative-operations-platform/08-2-4-asset-gallery-and-timeline-creation.md):
// a MINIMAL project switcher — not the real Timeline Dashboard (08.2.5, deferred, see slice plan).
// Before this, `loadOrCreateProject()` always opened "the" one most-recently-updated project with
// no way to reach any other — this is just enough to open a timeline the Gallery's batch-create
// just made. No thumbnail/search/checkbox/bulk-import, that's 08.2.5's real job.
function ProjectSwitcher({ currentProjectId }) {
  const openProject = useVideoStore((s) => s.openProject);
  const deleteProject = useVideoStore((s) => s.deleteProject);
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState(null); // null = not fetched yet
  const [deletingId, setDeletingId] = useState(null);
  // 08-E E7: "Thùng rác" — collapsed by default, fetched lazily on first expand so opening the
  // switcher doesn't always pay for a second request most sessions never need.
  const [showTrash, setShowTrash] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState(null); // null = not fetched yet
  const [restoringId, setRestoringId] = useState(null);
  const [permDeletingId, setPermDeletingId] = useState(null);
  const [dashboardCollectionId, setDashboardCollectionId] = useState(null); // 08-F F6
  const [bulkImportTargets, setBulkImportTargets] = useState(null); // 08-F F8
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 400 });

  useEffect(() => {
    if (!open) return undefined;
    fetchVideoProjects().then(setProjects).catch(() => setProjects([]));
    const closeOnOutsideClick = (e) => { if (!rootRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false); };
    const closeOnEscape = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('mousedown', closeOnOutsideClick); window.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  useEffect(() => {
    if (!open) { setShowTrash(false); return; }
    if (!showTrash || archivedProjects !== null) return;
    fetchArchivedVideoProjects().then(setArchivedProjects).catch(() => setArchivedProjects([]));
  }, [open, showTrash, archivedProjects]);

  async function handleRestore(p, e) {
    e.stopPropagation();
    setRestoringId(p.id);
    try {
      await restoreVideoProject(p.id);
      setArchivedProjects((list) => (list ? list.filter((x) => x.id !== p.id) : list));
      setProjects((list) => (list ? [p, ...list] : list));
    } catch (err) {
      window.alert(err.message);
    } finally {
      setRestoringId(null);
    }
  }

  async function handlePermanentDelete(p, e) {
    e.stopPropagation();
    if (!window.confirm(`Xoá vĩnh viễn timeline "${p.name}"? Không thể khôi phục.`)) return;
    setPermDeletingId(p.id);
    try {
      await permanentlyDeleteVideoProject(p.id);
      setArchivedProjects((list) => (list ? list.filter((x) => x.id !== p.id) : list));
    } catch (err) {
      window.alert(err.message);
    } finally {
      setPermDeletingId(null);
    }
  }

  // 08-E E7 / 08-B B6: the only place a user can ever delete a project today — `window.confirm()`
  // matches the existing destructive-action pattern this codebase already uses elsewhere (asset
  // delete, MediaBin.jsx's handleDeleteSelected; WorkflowLibraryModal.jsx's handleDelete). Deleting
  // the CURRENTLY open project is handled by store.js's deleteProject() itself (falls back to
  // another project or a fresh default) — but doing so briefly nulls the store's `project`, and
  // VideoWorkspace only renders THIS component while `project` is set, so it unmounts (then remounts
  // fresh once the fallback lands) partway through the same `await` below. Any local state update
  // after that point would hit a stale, unmounted instance — `wasCurrent` skips them in that case
  // (nothing to update anyway: a fresh instance means a fresh, already-correct `open`/`deletingId`).
  async function handleDelete(p, e) {
    e.stopPropagation();
    if (!window.confirm(`Chuyển timeline "${p.name}" vào thùng rác? Có thể khôi phục lại sau.`)) return;
    const wasCurrent = p.id === currentProjectId;
    setDeletingId(p.id);
    try {
      await deleteProject(p.id);
      if (!wasCurrent) setProjects((list) => (list ? list.filter((x) => x.id !== p.id) : list));
    } catch (err) {
      window.alert(err.message);
    } finally {
      if (!wasCurrent) setDeletingId(null);
    }
  }

  // 08-B B2 / ADR 0033 (F7's real consumer): timelines created together via Gallery batch-create
  // share a `collectionId` — a count >= 2 is the only signal worth surfacing here (a collection of
  // 1, which never happens by construction, or a project the user just never grouped, needs no
  // badge). Computed from THIS already-fetched list, not a separate request — F6's real Dashboard
  // (not built) would query a collection directly instead.
  const collectionCounts = {};
  for (const p of projects || []) {
    if (p.collectionId) collectionCounts[p.collectionId] = (collectionCounts[p.collectionId] || 0) + 1;
  }
  // 08-F F6: the real Dashboard (TimelineDashboard.jsx) is only worth surfacing once we know the
  // current timeline is actually grouped with others — same signal condition as the badge above.
  const currentProjectEntry = (projects || []).find((p) => p.id === currentProjectId);
  const currentCollectionId = currentProjectEntry?.collectionId;
  const showDashboardEntry = currentCollectionId && collectionCounts[currentCollectionId] >= 2;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => { const rect = rootRef.current.getBoundingClientRect(); setMenuPosition({ left: rect.left, top: rect.top }); setOpen((v) => !v); }}
        title="Chuyển sang timeline khác"
        aria-label="Chuyển sang timeline khác"
        className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--text,#111827)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
      >
        <ChevronDown size={12} />
      </button>
      {open && createPortal(
        <div ref={menuRef} data-timeline-switcher-menu className="fixed w-64 overflow-y-auto rounded-xl border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] shadow-xl py-1 z-50 text-xs" style={{ left: Math.max(8, Math.min(window.innerWidth - 264, menuPosition.left)), bottom: Math.max(8, window.innerHeight - menuPosition.top + 4), maxHeight: Math.max(80, Math.min(320, menuPosition.top - 12)) }}>
          {showDashboardEntry && (
            <button
              type="button"
              title="Xem Dashboard cho bộ timeline này"
              onClick={() => { setDashboardCollectionId(currentCollectionId); setOpen(false); }}
              className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 border-b border-[var(--card-border,#f3f4f6)] mb-1 text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--accent,#7C5CFA)]"
            >
              <LayoutGrid size={11} /> Xem Dashboard ({collectionCounts[currentCollectionId]} timeline)
            </button>
          )}
          {projects === null && <p className="px-3 py-2 text-[var(--n600,#4b5563)]">Đang tải…</p>}
          {projects?.length === 0 && <p className="px-3 py-2 text-[var(--n600,#4b5563)]">Chưa có timeline nào khác.</p>}
          {projects?.map((p) => (
            <div key={p.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => { openProject(p.id, p.name); setOpen(false); }}
                draggable={p.id !== currentProjectId}
                title={p.id !== currentProjectId ? 'Kéo xuống track video để ghép timeline này' : undefined}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-video-timeline', JSON.stringify({ projectId: p.id, name: p.name })); }}
                onDragEnd={() => setOpen(false)}
                className={`flex-1 min-w-0 flex items-center gap-1 text-left px-3 py-1.5 hover:bg-[var(--n100,#f3f4f6)] ${p.id === currentProjectId ? 'text-[var(--accent,#7C5CFA)] font-medium' : 'text-[var(--n600,#4b5563)]'}`}
              >
                {p.collectionId && collectionCounts[p.collectionId] >= 2 && (
                  <span title={`Cùng bộ với ${collectionCounts[p.collectionId] - 1} timeline khác`} className="shrink-0 flex items-center">
                    <GroupIcon size={11} className="text-[var(--n600,#4b5563)]" aria-hidden="true" />
                  </span>
                )}
                <span className="truncate">{p.name}</span>
              </button>
              <button
                type="button"
                onClick={(e) => handleDelete(p, e)}
                disabled={deletingId === p.id}
                title={`Xoá timeline "${p.name}"`}
                aria-label={`Xoá timeline "${p.name}"`}
                className="w-7 h-7 mr-1 shrink-0 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              >
                {deletingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          ))}
          <div className="border-t border-[var(--card-border,#e5e7eb)] mt-1 pt-1">
            <button
              type="button"
              onClick={() => setShowTrash((v) => !v)}
              className="w-full flex items-center gap-1.5 text-left px-3 py-1.5 text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--text,#111827)]"
            >
              {showTrash ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              Thùng rác
            </button>
            {showTrash && (
              <div>
                {archivedProjects === null && <p className="px-3 py-2 text-[var(--n600,#4b5563)]">Đang tải…</p>}
                {archivedProjects?.length === 0 && <p className="px-3 py-2 text-[var(--n600,#4b5563)]">Thùng rác trống.</p>}
                {archivedProjects?.map((p) => (
                  <div key={p.id} className="group flex items-center">
                    <span className="flex-1 min-w-0 text-left px-3 py-1.5 truncate text-[var(--n600,#4b5563)]">{p.name}</span>
                    <button
                      type="button"
                      onClick={(e) => handleRestore(p, e)}
                      disabled={restoringId === p.id}
                      title={`Khôi phục "${p.name}"`}
                      aria-label={`Khôi phục "${p.name}"`}
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] opacity-0 group-hover:opacity-100 hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--accent,#7C5CFA)] disabled:opacity-40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
                    >
                      {restoringId === p.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handlePermanentDelete(p, e)}
                      disabled={permDeletingId === p.id}
                      title={`Xoá vĩnh viễn "${p.name}"`}
                      aria-label={`Xoá vĩnh viễn "${p.name}"`}
                      className="w-7 h-7 mr-1 shrink-0 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
                    >
                      {permDeletingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>, document.body
      )}
      {dashboardCollectionId && (
        <TimelineDashboard
          collectionId={dashboardCollectionId}
          currentProjectId={currentProjectId}
          onOpenProject={(id, name) => { openProject(id, name); setDashboardCollectionId(null); }}
          onClose={() => setDashboardCollectionId(null)}
          onBulkAction={(selected) => { setBulkImportTargets(selected); setDashboardCollectionId(null); }}
          bulkActionLabel="Nhập hàng loạt"
        />
      )}
      {bulkImportTargets && (
        <BulkImportDialog timelines={bulkImportTargets} onClose={() => setBulkImportTargets(null)} />
      )}
    </div>
  );
}

export default function VideoWorkspace() {
  const currentUser = useStore((s) => s.currentUser);
  const authChecked = useStore((s) => s.authChecked);
  const checkSession = useStore((s) => s.checkSession);
  const appearanceSettings = useStore((s) => s.appearanceSettings);

  const projectLoading = useVideoStore((s) => s.projectLoading);
  const projectError = useVideoStore((s) => s.projectError);
  const loadOrCreateProject = useVideoStore((s) => s.loadOrCreateProject);
  const projectState = useVideoStore((s) => s.projectState);
  const selectedIds = useVideoStore((s) => s.selectedIds);
  const graphDocked = useVideoStore(s => s.graphDocked);
  const graphInspectorActive = useVideoStore(s => s.graphInspectorActive);
  const graphFocusToken = useVideoStore(s => s.graphFocusToken);
  const project = useVideoStore((s) => s.project);
  const saveStatus = useVideoStore((s) => s.saveStatus);
  const pendingCommands = useVideoStore((s) => s.pendingCommands);
  const retryPendingCommand = useVideoStore((s) => s.retryPendingCommand);
  const discardPendingAndResync = useVideoStore((s) => s.discardPendingAndResync);
  const staleVersionDetected = useVideoStore((s) => s.staleVersionDetected);
  const checkForStaleVersion = useVideoStore((s) => s.checkForStaleVersion);
  const recoveredCommandCount = useVideoStore((s) => s.recoveredCommandCount);
  const dismissRecoveryNotice = useVideoStore((s) => s.dismissRecoveryNotice);
  const openExportPanel = useVideoStore((s) => s.openExportPanel);
  const breadcrumbParent = useVideoStore((s) => s.breadcrumbParent);
  const goToBreadcrumbParent = useVideoStore((s) => s.goToBreadcrumbParent);
  const embedOperation = useVideoStore((s) => s.embedOperation);
  const dismissEmbedOperation = useVideoStore((s) => s.dismissEmbedOperation);

  // 08-E E5: checks for a newer server revision (another tab/session) whenever this tab regains
  // focus/visibility — deliberately NOT a fixed-interval poll (no background network chatter while
  // the tab sits unfocused, which is the common case for a background editor tab) and deliberately
  // NOT on every keystroke/command (this tab's own writes already update `currentRevision` locally,
  // see store.js's postAndTrack()).
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') checkForStaleVersion();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkForStaleVersion is a stable
    // Zustand action reference; safe to register exactly once.
  }, []);

  // 08-L L5 (specs/ai-creative-operations-platform/08-v2/08-l-editor-experience-and-interaction-
  // system.md §4.2): minPx/maxPx tightened to match the contract (260-340/300-380 — was 200-480/
  // 260-420, wider than the contract on both ends per L2 §2's own finding). `clamp` additionally
  // caps EACH side panel against the OTHER's current effective width + viewport width so Preview
  // never drops below its contract floor (43%, owner-confirmed 2026-09-04). Each closure reads the
  // SIBLING `const` declared further down this function — safe despite the declaration order:
  // `clamp` is only ever CALLED later, from a real pointer event (well after this render finished
  // and both consts are initialized), never synchronously while either `useResizablePanel` call
  // itself is still running.
  const PREVIEW_MIN_FRACTION = 0.35;
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const media = useResizablePanel({
    storageKey: 've.panel.media.right-layout', initialPx: Math.round(window.innerWidth * 0.32), minPx: 220, maxPx: 800, axis: 'x',
    clamp: (px) => {
      const inspectorPx = inspector.collapsed ? 44 : inspector.sizePx;
      return Math.min(px, window.innerWidth * (1 - PREVIEW_MIN_FRACTION) - inspectorPx);
    },
  });
  const inspector = useResizablePanel({
    storageKey: 've.panel.inspector', initialPx: Math.round(window.innerWidth * 0.3), minPx: 260, maxPx: 800, axis: 'x',
    clamp: (px) => {
      const mediaPx = media.collapsed ? 44 : media.sizePx;
      return Math.min(px, window.innerWidth * (1 - PREVIEW_MIN_FRACTION) - mediaPx);
    },
  });
  const timelinePanel = useResizablePanel({ storageKey: 've.panel.timeline', initialPx: 320, minPx: 220, maxPx: 480, axis: 'y', invert: true });
  useEffect(() => {
    if (graphDocked && graphInspectorActive && inspector.collapsed) inspector.toggleCollapse();
    // Open requests reveal the dock; manually collapsing it remains possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFocusToken]);

  // 08-L L5 responsive collapse (§4.2 "Dưới width threshold: collapse panel phụ theo thứ tự đã
  // chốt"): threshold = the contract's own usable floor (1280px, §4.2 "usable floor 1280×720").
  // Order chốt 2026-09-04: Inspector collapses first (Media/Layers needs to stay visible longer for
  // picking an asset; Inspector only matters once something is selected) — only Inspector for now,
  // matching the contract's own single decided order; a second cascading threshold isn't specified
  // anywhere, so none is invented here.
  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth < 1280) inspector.collapseIfNotAlready();
    }
    window.addEventListener('resize', handleResize);
    handleResize(); // catch an already-narrow window on first mount, not just a live resize
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inspector.collapseIfNotAlready is a
    // stable useCallback ([] deps in useResizablePanel.js), safe to register exactly once here.
  }, []);

  // 08-UI §6.2 Priority 0 bước 4: view-only preview state (KHÔNG phải project data, không qua
  // command/undo) — sống ở đây (cha chung của Player + TransportBar) vì TransportBar (transport
  // bar mới, thay VideoToolbar.jsx đã xoá) là SIBLING của Player, không phải con của nó.
  const [zoomMode, setZoomMode] = useState('fit');
  const [previewVolume, setPreviewVolume] = useState(1);
  const [renderedPreviewOpen, setRenderedPreviewOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); e.stopImmediatePropagation(); setPaletteOpen(true); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Same effect App.jsx:44-46 runs — see this file's own header comment for why VideoWorkspace
  // needs its own copy rather than mounting under App.
  useEffect(() => {
    document.documentElement.dataset.appearance = `beta-${appearanceSettings.theme}`;
  }, [appearanceSettings]);

  useEffect(() => {
    if (currentUser) loadOrCreateProject();
  }, [currentUser, loadOrCreateProject]);

  if (!authChecked) return null;
  if (!currentUser) return <LoginGate />;

  // 08-E E4 (specs/.../08-v2/08-e-editor-node-and-workbench.md, acceptance §5 "Reload/deep link mở
  // đúng timeline/version hoặc đưa recovery action rõ"): `!project` (never successfully loaded)
  // distinguishes this from a SAVE-time error — execute()/undo()/redo() also set `projectError` but
  // only ever run once a project IS loaded (`project` stays truthy then), so those keep using the
  // small inline header banner below, unaffected. Before this, a bad/deleted/not-owned `?projectId=`
  // left `projectState` null — Timeline.jsx's own `if (!projectState) return null` guard silently
  // dropped the entire bottom half of the grid, Media Bin/Player still rendered normally, looking
  // like a half-broken app instead of a clear error with a way out.
  if (!project && !projectLoading && projectError) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[var(--canvas,#f5f5f5)]">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm px-4">
          <AlertCircle size={32} className="text-red-500 shrink-0" />
          <p className="text-sm text-[var(--text,#111827)] font-medium">{projectError}</p>
          <a
            href="/"
            className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] text-xs font-medium hover:bg-[var(--accent-strong,#6B46F0)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            <ArrowLeft size={14} />
            Quay lại Space-Flow
          </a>
        </div>
      </div>
    );
  }

  const saveStatusLabel = SAVE_STATUS_LABEL[saveStatus];
  // 08-D D3: pending commands that exhausted commandRetry's own retry — surfaced as an explicit,
  // user-actionable state (count + Retry/Resync) instead of the old silent-forever-diverged banner
  // that only ever said "Lỗi lưu" with no way out. `firstErrorId` (Retry acts on the OLDEST failed
  // entry) keeps the affordance simple — retrying one at a time mirrors how they were queued, and a
  // user with several failures almost always wants "try again" more than fine-grained per-command
  // control the UI doesn't otherwise expose.
  const pendingErrors = pendingCommands.filter((c) => c.status === 'error');
  const firstErrorId = pendingErrors[0]?.id;
  // 08-D D5: a 409 base-revision conflict — another session moved this project forward, so the
  // stale base this command was built on will never succeed no matter how many times it's retried.
  // Takes priority over the generic pendingErrors banner below when both exist (rare: some earlier
  // command genuinely failed on the network before any conflict happened) — resolving the conflict
  // (Đồng bộ lại) clears pendingCommands entirely regardless of status, so it resolves both at once.
  const pendingConflicts = pendingCommands.filter((c) => c.status === 'conflict');
  const mediaColPx = media.collapsed ? 44 : Math.min(media.sizePx, viewportWidth * 0.35);
  const inspectorColPx = inspector.collapsed ? 44 : Math.min(inspector.sizePx, Math.max(260, viewportWidth * (1 - PREVIEW_MIN_FRACTION) - mediaColPx));
  const timelineRowPx = timelinePanel.collapsed ? 38 : timelinePanel.sizePx;

  return (
    <div
      className="video-workspace w-screen h-screen overflow-hidden bg-[var(--canvas,#f5f5f5)] grid text-[var(--text,#111827)]"
      style={{
        gridTemplateColumns: `${mediaColPx}px ${inspectorColPx}px minmax(0, 1fr)`,
        gridTemplateRows: `auto minmax(0, 1fr) ${timelineRowPx}px`,
        gridTemplateAreas: '"header header header" "media inspector preview" "timeline timeline preview"',
      }}
    >
      <header style={{ gridArea: 'header' }} className="flex items-center gap-3 px-4 h-11 border-b border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] text-xs">
        <a
          href="/"
          title="Về Space-Flow"
          aria-label="Về Space-Flow"
          className="w-8 h-8 -ml-1 flex items-center justify-center rounded-lg shrink-0 text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        >
          <ArrowLeft size={16} />
        </a>
        {/* 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): shown only while
            the current project was reached via a compound clip's "Mở timeline lồng" action — a
            manual ProjectSwitcher pick or navigating back both clear breadcrumbParent (see that
            field's own comment in store.js). Deliberately single-level, not a full trail. */}
        {breadcrumbParent && (
          <button
            type="button"
            onClick={goToBreadcrumbParent}
            title={`Quay lại "${breadcrumbParent.name}"`}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[var(--n600,#4b5563)] hover:text-[var(--accent,#7C5CFA)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
          >
            <ArrowLeft size={11} /> {breadcrumbParent.name}
          </button>
        )}
        <ProjectTimelines mode="project" />
        {/* 08-D D6 residual: announces a just-happened crash/reload replay (openProject() found
            unconfirmed commands in localStorage from before this tab last closed) — without this,
            recovery that persists successfully is invisible, leaving the user to wonder whether their
            edits came back by luck. Dismissible only (no timer) — the user decides when they've seen
            it, matching every other banner here. */}
        {recoveredCommandCount > 0 && (
          <span className="flex items-center gap-1.5 shrink-0 text-[var(--accent,#7C5CFA)]">
            <RotateCcw size={13} className="shrink-0" />
            Đã khôi phục {recoveredCommandCount} thao tác chưa lưu từ phiên trước
            <button
              type="button"
              onClick={dismissRecoveryNotice}
              title="Đóng thông báo khôi phục"
              aria-label="Đóng thông báo khôi phục"
              className="hover:text-[var(--accent-strong,#6B46F0)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
            >
              <X size={13} />
            </button>
          </span>
        )}
        {saveStatusLabel && pendingErrors.length === 0 && pendingConflicts.length === 0 && (
          <span className={`flex items-center gap-1 shrink-0 ${saveStatus === 'error' ? 'text-red-600' : 'text-[var(--n600,#4b5563)]'}`}>
            {saveStatus === 'saving' && <Loader2 size={13} className="animate-spin" />}
            {saveStatus === 'saved' && <Check size={13} />}
            {saveStatus === 'error' && <AlertCircle size={13} />}
            {saveStatusLabel}
          </span>
        )}
        {/* 08-D D5: a stale base revision — the server moved forward from another session, so no
            amount of retrying THIS request will ever succeed (it would keep asking to apply on top
            of a base that no longer exists). Only "Đồng bộ lại" makes sense here, unlike the plain
            network-failure banner below which still offers "Thử lại". Shown instead of (not
            alongside) that banner when both exist — see pendingConflicts' own comment above. */}
        {pendingConflicts.length > 0 && (
          <span className="flex items-center gap-1.5 shrink-0 text-red-600">
            <AlertCircle size={13} className="shrink-0" />
            {pendingConflicts.length} thao tác xung đột với bản mới trên server
            <button type="button" className="underline" onClick={() => setConflictOpen(true)}>Xem khác biệt</button>
            <button
              type="button"
              onClick={discardPendingAndResync}
              title="Bỏ thao tác chưa lưu, tải lại đúng bản mới nhất trên server"
              className="underline hover:no-underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
            >
              Đồng bộ lại
            </button>
          </span>
        )}
        {/* 08-D D3: replaces the generic "Lỗi lưu" label once retry is exhausted — an explicit,
            actionable state instead of a dead-end banner (acceptance §5 "Network reject không để UI
            âm thầm lệch server"). */}
        {pendingConflicts.length === 0 && pendingErrors.length > 0 && (
          <span className="flex items-center gap-1.5 shrink-0 text-red-600">
            <AlertCircle size={13} className="shrink-0" />
            {pendingErrors.length} thao tác chưa lưu
            <button
              type="button"
              onClick={() => retryPendingCommand(firstErrorId)}
              title="Thử lưu lại thao tác chưa lưu"
              className="underline hover:no-underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
            >
              Thử lại
            </button>
            <button
              type="button"
              onClick={discardPendingAndResync}
              title="Bỏ thao tác chưa lưu, tải lại đúng bản đã lưu trên server"
              className="underline hover:no-underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
            >
              Đồng bộ lại
            </button>
          </span>
        )}
        {/* 08-E E5: another tab/session moved this project forward since it was opened here — a
            dismissible, user-triggered reload, not an automatic one (never interrupt an active
            edit gesture with a surprise state swap). Independent of pendingErrors above — both can
            render at once (rare: this tab both has a stuck edit AND is behind). */}
        {staleVersionDetected && (
          <span className="flex items-center gap-1.5 shrink-0 text-amber-600">
            <AlertCircle size={13} className="shrink-0" />
            Có bản mới hơn (từ tab/thiết bị khác)
            <button
              type="button"
              onClick={discardPendingAndResync}
              title="Tải lại bản mới nhất từ server"
              className="underline hover:no-underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
            >
              Tải lại
            </button>
          </span>
        )}
        {projectError && (
          <span className="flex items-center gap-1 text-red-600 truncate">
            <AlertCircle size={13} className="shrink-0" />
            {projectError}
          </span>
        )}
        {projectLoading && !projectError && <span className="text-[var(--n600,#4b5563)]">Đang tải project…</span>}
        <div className="flex-1" />
        <button type="button" onClick={() => setRenderedPreviewOpen(true)} className="h-8 px-3 rounded-lg shrink-0 border border-[var(--card-border)] text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Xem bản render</button>
        <button type="button" onClick={() => setVersionsOpen(true)} className="h-8 px-3 rounded-lg shrink-0 border border-[var(--card-border)] text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Bản lưu và duyệt</button>
        <button type="button" onClick={() => setPaletteOpen(true)} title="Tìm thao tác (Ctrl/Cmd+K)" aria-label="Tìm thao tác" className="h-8 px-2 rounded-lg shrink-0 border border-[var(--card-border)]">⌕</button>
        <button
          type="button"
          onClick={openExportPanel}
          title="Export"
          aria-label="Export"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg shrink-0 bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] text-xs font-medium hover:bg-[var(--accent-strong,#6B46F0)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        >
          <Download size={14} />
          Export
        </button>
      </header>

      <aside style={{ gridArea: 'media' }} aria-label="Media" className="relative min-w-0 border-r border-[var(--card-border,#e5e7eb)] overflow-hidden">
        {media.collapsed ? (
          <button
            type="button"
            onClick={media.toggleCollapse}
            aria-label="Mở lại Media Bin"
            title="Mở lại Media Bin"
            className="w-8 h-8 m-1 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            <ChevronRight size={14} />
          </button>
        ) : (
          <>
            <MediaBin />
            <div
              onPointerDown={media.onDragStart}
              className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent-tint,#EDE9FE)]"
            />
            <button
              type="button"
              onClick={media.toggleCollapse}
              aria-label="Thu gọn Media Bin"
              title="Thu gọn Media Bin"
              className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <ChevronLeft size={12} />
            </button>
          </>
        )}
      </aside>

      <main style={{ gridArea: 'preview' }} aria-label="Xem trước" className="min-w-0 min-h-0 flex flex-col border-l border-[var(--card-border)]">
        <div className="h-10 shrink-0 flex items-center px-3 text-xs font-medium border-b border-[var(--card-border)] bg-[var(--card)]">Xem trước<span className="ml-2 truncate text-[var(--n600)]">{project?.name}</span></div>
        <div className="flex-1 min-h-0">
          <Player zoomMode={zoomMode} previewVolume={previewVolume} />
        </div>
        <TransportBar zoomMode={zoomMode} setZoomMode={setZoomMode} previewVolume={previewVolume} setPreviewVolume={setPreviewVolume} />
      </main>

      <aside style={{ gridArea: 'inspector' }} aria-label="Thuộc tính" className="relative min-w-0 border-l border-[var(--card-border,#e5e7eb)] overflow-hidden">
        {inspector.collapsed ? (
          <button
            type="button"
            onClick={inspector.toggleCollapse}
            aria-label="Mở lại bảng thuộc tính"
            title="Mở lại bảng thuộc tính"
            className="w-8 h-8 m-1 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            <ChevronLeft size={14} />
          </button>
        ) : (
          <>
            <div
              onPointerDown={inspector.onDragStart}
              className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--accent-tint,#EDE9FE)] z-10"
            />
            <button
              type="button"
              onClick={inspector.toggleCollapse}
              aria-label="Thu gọn bảng thuộc tính"
              title="Thu gọn bảng thuộc tính"
              className="absolute top-1 left-1 w-6 h-6 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <ChevronRight size={12} />
            </button>
            {/* Phase 13 (§0): the selected clip's OWN track decides which sidebar shows — a caption
                cue has no `.effects` to speak of, EffectsPanel would just show its "no clip selected"
                state confusingly even though a clip IS selected. 08.2.1 §4: with multi-select, this
                now has to look at EVERY selected item's track type, not just one. */}
            {(() => {
              if (graphDocked) return <div className="h-full min-h-0 flex flex-col pt-8">
                <div className="flex gap-2 px-3 pb-2 text-xs" role="group" aria-label="Bảng chỉnh sửa">
                  <button type="button" aria-pressed={!graphInspectorActive} onClick={() => useVideoStore.getState().setGraphInspectorActive(false)} className="rounded border border-[var(--card-border)] px-2 py-1">Thuộc tính clip</button>
                  <button type="button" aria-pressed={graphInspectorActive} onClick={() => useVideoStore.getState().setGraphInspectorActive(true)} className="rounded border border-[var(--card-border)] px-2 py-1">Graph Editor</button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">{graphInspectorActive ? <DockedGraphEditor /> : (selectedIds.some(id => ['text', 'shape'].includes(findClipLocation(projectState, id)?.track.type)) ? <VectorPanel /> : selectedIds.some(id => findClipLocation(projectState, id)?.track.type === 'caption') ? <CaptionPanel /> : <EffectsPanel />)}</div>
              </div>;
              const trackTypes = new Set(selectedIds.map((id) => findClipLocation(projectState, id)?.track.type).filter(Boolean));
              if (trackTypes.size > 1) {
                return (
                  <div className="w-56 shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 text-xs text-[var(--n600,#4b5563)]">
                    Lựa chọn gồm nhiều loại track khác nhau — chọn cùng 1 loại (phụ đề hoặc clip) để chỉnh.
                  </div>
                );
              }
              return trackTypes.has('text') || trackTypes.has('shape') ? <VectorPanel /> : trackTypes.has('caption') ? <CaptionPanel /> : <EffectsPanel />;
            })()}
          </>
        )}
      </aside>

      <div style={{ gridArea: 'timeline' }} className="relative min-h-0 flex flex-col border-t border-[var(--card-border,#e5e7eb)] overflow-hidden">
        {timelinePanel.collapsed ? (
          <button
            type="button"
            onClick={timelinePanel.toggleCollapse}
            aria-label="Mở lại Timeline"
            title="Mở lại Timeline"
            className="w-8 h-8 m-1 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            <ChevronUp size={14} />
          </button>
        ) : (
          <>
            <div
              onPointerDown={timelinePanel.onDragStart}
              className="absolute top-0 left-0 w-full h-1.5 cursor-row-resize hover:bg-[var(--accent-tint,#EDE9FE)] z-10"
            />
            <button
              type="button"
              onClick={timelinePanel.toggleCollapse}
              aria-label="Thu gọn Timeline"
              title="Thu gọn Timeline"
              className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-md text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <ChevronDown size={12} />
            </button>
            <div className="flex shrink-0 items-center min-w-0"><ProjectTimelines mode="timeline" />{project && <ProjectSwitcher currentProjectId={project.id} />}</div>
            <Timeline />
          </>
        )}
      </div>

      <ExportPanel />
      {renderedPreviewOpen && project && <RenderedPreviewDialog onClose={() => setRenderedPreviewOpen(false)} />}
      {versionsOpen && project && <VersionsDialog onClose={() => setVersionsOpen(false)} />}
      {conflictOpen && project && <ConflictDialog onClose={() => setConflictOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} actions={[
        { label: 'Xem bản render', run: () => setRenderedPreviewOpen(true), disabled: !project },
        { label: 'Bản lưu và duyệt', run: () => setVersionsOpen(true), disabled: !project },
        { label: 'Xuất video', run: openExportPanel, disabled: !project },
        { label: 'Hoàn tác', run: () => useVideoStore.getState().undo(), disabled: !useVideoStore.getState().canUndo },
        { label: 'Làm lại', run: () => useVideoStore.getState().redo(), disabled: !useVideoStore.getState().canRedo },
        { label: 'Ẩn / hiện thư viện media', run: media.toggleCollapse },
        { label: 'Ẩn / hiện Inspector', run: inspector.toggleCollapse },
        { label: 'Ẩn / hiện timeline', run: timelinePanel.toggleCollapse },
      ]} />}

      {/* 08-F F5 / ADR 0034: embedding a compound clip is a render+promote round-trip (can take
          real seconds), unlike every other synchronous timeline edit — a floating toast rather
          than blocking the whole editor, since the user can keep doing other things meanwhile. */}
      {embedOperation && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[9999] w-72 rounded-xl border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] shadow-xl p-3 flex flex-col gap-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--text,#111827)] truncate">
              Ghép "{embedOperation.timelineProjectName}"
            </span>
            {embedOperation.status === 'error' && (
              <button type="button" onClick={dismissEmbedOperation} aria-label="Đóng" className="shrink-0 text-[var(--n600,#4b5563)] hover:text-[var(--n600,#4b5563)]">
                <X size={13} />
              </button>
            )}
          </div>
          {embedOperation.status === 'error' ? (
            <span className="flex items-center gap-1.5 text-red-600"><AlertCircle size={13} className="shrink-0" /> {embedOperation.error}</span>
          ) : (
            <>
              <span className="text-[var(--n600,#4b5563)]">
                {embedOperation.status === 'rendering' ? 'Đang render…' : 'Đang xử lý thành clip…'}
              </span>
              <div className="h-1.5 rounded-full bg-[var(--n100,#f3f4f6)] overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(embedOperation.progress || 0)}%` }} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
