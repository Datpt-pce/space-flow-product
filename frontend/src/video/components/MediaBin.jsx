// Video Editor Phase 2 (specs/space-flow-master-plan/04-video-editor.md §5): "danh sách asset,
// badge trạng thái, nút Relink, tái dùng FolderBrowserModal.jsx có sẵn khi SPACE_FLOW_MODE=server."
// Renders its own <FolderBrowserModal/> here (rather than assuming a parent already does) since
// there's no Workspace Shell yet (§1) to guarantee that — the modal only opens as a fallback when
// the native OS dialog (browseFile(), used by pickFile()) isn't available, exactly like every
// other pickFile('media') caller in this codebase already relies on.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Film, Music, Image as ImageIcon, RefreshCw, AlertCircle, Loader2, Mic, Square, Search, Layers, X, Trash2 } from 'lucide-react';
import { useStore } from '../../store.js';
import { useVideoStore } from '../store.js';
import { importExternalFiles, isInternalMediaDrag } from '../externalMedia.js';
import { previewUrl, videoAssetUsage } from '../../lib/api.js';
import { isMod } from '../shortcuts.js';
import FolderBrowserModal from '../../components/FolderBrowserModal.jsx';
import CreateTimelinesDialog from './CreateTimelinesDialog.jsx';
import MediaRightsDialog from './MediaRightsDialog.jsx';

// Phase 15 (§0): voice recording — `MediaRecorder`'s own supported mime types vary by browser
// (Chrome: webm/opus, Firefox: also webm/opus, some browsers: ogg) — tried in the order this app's
// backend allowlist (backend/routes/video-assets.js's RECORDING_EXTENSIONS) actually accepts, so a
// browser supporting neither webm nor ogg (very old/unusual) fails the initial getUserMedia() call
// path cleanly rather than reaching the backend with something it'll reject.
const RECORDING_MIME_CANDIDATES = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
];
function pickRecordingFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDING_MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) || null;
}

// blobToBase64(blob) -> the base64 payload ONLY (no `data:...;base64,` prefix) — FileReader's own
// readAsDataURL, not a manual ArrayBuffer->btoa loop, since the latter risks a call-stack overflow
// on `String.fromCharCode(...largeArray)` for anything more than a few seconds of audio.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon };

const STATUS_LABEL = {
  processing: 'Đang xử lý…',
  ok: 'Sẵn sàng',
  offline: 'Offline',
  error: 'Lỗi',
};

// Labels sit over imagery: a dark backing and pale status colors preserve contrast
// even when the source thumbnail is white or highly detailed.
const STATUS_TOKEN = {
  processing: '#fde68a',
  ok: '#86efac',
  offline: '#fde68a',
  error: '#fca5a5',
};

function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export default function MediaBin() {
  const assets = useVideoStore((s) => s.assets);
  const loading = useVideoStore((s) => s.loading);
  const error = useVideoStore((s) => s.error);
  const importingPath = useVideoStore((s) => s.importingPath);
  const relinkingId = useVideoStore((s) => s.relinkingId);
  const fetchAssets = useVideoStore((s) => s.fetchAssets);
  const importAsset = useVideoStore((s) => s.importAsset);
  const recordVoiceAsset = useVideoStore((s) => s.recordVoiceAsset);
  const relinkAsset = useVideoStore((s) => s.relinkAsset);
  const deletingAssetIds = useVideoStore((s) => s.deletingAssetIds);
  const clearError = useVideoStore((s) => s.clearError);

  // 08.2.4 §2: Gallery multi-selection — a separate selection from Timeline's clip selection, see
  // store.js's own comment on `selectedAssetIds`.
  const selectedAssetIds = useVideoStore((s) => s.selectedAssetIds);
  const assetSelectionAnchorId = useVideoStore((s) => s.assetSelectionAnchorId);
  const selectAsset = useVideoStore((s) => s.selectAsset);
  const toggleAssetSelection = useVideoStore((s) => s.toggleAssetSelection);
  const setAssetSelection = useVideoStore((s) => s.setAssetSelection);
  const clearAssetSelection = useVideoStore((s) => s.clearAssetSelection);
  const batchCreateTimelines = useVideoStore((s) => s.batchCreateTimelines);
  const openProject = useVideoStore((s) => s.openProject);

  // 08-UI §6.1 Priority 0 bước 4: search thật, lọc client-side theo filename — view toggle không
  // thêm vì chỉ có đúng 1 view (grid), đúng nguyên tắc "view toggle chỉ xuất hiện khi có ≥2 view".
  const [searchQuery, setSearchQuery] = useState('');
  const [rightsAsset, setRightsAsset] = useState(null);
  const [showPathImport, setShowPathImport] = useState(false);
  const [sourcePathInput, setSourcePathInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const gridRef = useRef(null);
  const [cardSize, setCardSize] = useState(() => Math.max(90, Math.min(280, Number(localStorage.getItem('video-media-card-size')) || 150)));
  const contextMenuRef = useRef(null);

  // 08.2.4 §3: right-click "Create timelines" menu — local component state (not global store),
  // same reasoning as `components/ContextMenu.jsx` not being reused here (this deliberately
  // doesn't couple the video editor's store to that flow-canvas-only global menu, see plan).
  const [assetContextMenu, setAssetContextMenu] = useState(null); // { x, y } | null
  const [createDialogMode, setCreateDialogMode] = useState(null); // 'all-selected-one-timeline' | 'one-video-one-timeline' | null

  // 08-L L6 residual (specs/.../08-v2/08-l-editor-experience-and-interaction-system.md): per-item
  // keyboard selection — before this, only the grid AS A WHOLE was reachable by Tab (Mod+A/Escape),
  // with no way to move to or select ONE specific asset without a mouse. `focusedAssetId` is the
  // roving-tabindex "active" card (WAI-ARIA APG composite-widget pattern): exactly one card is a Tab
  // stop at a time, synced via each card's own onFocus (below) so it tracks Tab, click, AND the
  // arrow-key `.focus()` calls in moveFocusFrom() uniformly, without three separate code paths.
  const [focusedAssetId, setFocusedAssetId] = useState(null);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  // Recording must stop cleanly (release the mic) even if the user navigates away mid-recording —
  // a leaked getUserMedia() stream keeps the browser's mic-in-use indicator lit indefinitely.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!menu || !assetContextMenu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(assetContextMenu.x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(assetContextMenu.y, innerHeight - rect.height - 8))}px`;
  }, [assetContextMenu]);
  useEffect(() => {
    if (!assetContextMenu) return undefined;
    // Bug caught during e2e verification (reproduced with a standalone repro script before fixing):
    // closing on EVERY mousedown with no containment check also closes on a mousedown INSIDE the
    // menu itself — mousedown fires before click, so clicking a menu item unmounted the menu before
    // its own onClick ever ran, silently swallowing every click. Same containment-check pattern
    // `components/ContextMenu.jsx` already uses (`menuRef.current.contains(e.target)`).
    const close = (e) => { if (!contextMenuRef.current?.contains(e.target)) setAssetContextMenu(null); };
    const escape = (e) => { if (e.key === 'Escape') setAssetContextMenu(null); };
    window.addEventListener('mousedown', close);
    // Dismiss intentional scrolling, not a delayed scroll event from focusing the
    // source card. That event could otherwise remove a menu before its click lands.
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', escape);
    };
  }, [assetContextMenu]);

  const handleImport = async () => {
    const p = await useStore.getState().pickFile('media');
    if (!p) return;
    try {
      await importAsset(p);
    } catch {
      // error đã được lưu vào store, hiển thị bên dưới — không cần xử lý thêm ở đây
    }
  };

  const handleStartRecording = async () => {
    const format = pickRecordingFormat();
    if (!format) {
      useVideoStore.setState({ error: 'Trình duyệt này không hỗ trợ ghi âm (MediaRecorder/webm-opus).' });
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      useVideoStore.setState({ error: `Không truy cập được microphone: ${err.message}` });
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      clearInterval(timerRef.current);
      const blob = new Blob(chunksRef.current, { type: format.mimeType });
      chunksRef.current = [];
      try {
        const dataBase64 = await blobToBase64(blob);
        await recordVoiceAsset(dataBase64, format.extension);
      } catch {
        // error đã được lưu vào store, hiển thị bên dưới — không cần xử lý thêm ở đây
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setRecordedSeconds(0);
    timerRef.current = setInterval(() => setRecordedSeconds((s) => s + 1), 1000);
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleRelink = async (assetId) => {
    const p = await useStore.getState().pickFile('media');
    if (!p) return;
    try {
      await relinkAsset(assetId, p);
    } catch {
      // error đã được lưu vào store, hiển thị bên dưới
    }
  };

  const filteredAssets = searchQuery.trim()
    ? assets.filter((a) => a.sourcePath.split(/[\\/]/).pop().toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : assets;

  // 08.2.4 §2: Click/Ctrl+click/Shift+click contract — Shift range resolves against
  // `filteredAssets`' CURRENT visual order (the spec's "theo sort order hiện tại"), not `assets`.
  // Only `status==='ok'` assets are selectable at all — same rule the existing `draggable` gate on
  // each card already enforces (processing/offline/error assets aren't a valid drag source
  // either), kept consistent rather than introducing a second, looser rule.
  function handleAssetClick(asset, e) {
    if (asset.status !== 'ok') return;
    if (isMod(e)) { toggleAssetSelection(asset.id); return; }
    if (e.shiftKey && assetSelectionAnchorId) {
      const ids = filteredAssets.filter((a) => a.status === 'ok').map((a) => a.id);
      const anchorIndex = ids.indexOf(assetSelectionAnchorId);
      const clickIndex = ids.indexOf(asset.id);
      if (anchorIndex !== -1 && clickIndex !== -1) {
        const [start, end] = anchorIndex < clickIndex ? [anchorIndex, clickIndex] : [clickIndex, anchorIndex];
        setAssetSelection(ids.slice(start, end + 1));
        return;
      }
    }
    selectAsset(asset.id);
  }

  // 08.2.4 §3: right-click an unselected item selects it first (replacing selection); right-click
  // inside an existing multi-selection keeps the whole set — mirrors the spec's own wording.
  function handleAssetContextMenu(asset, e) {
    if (asset.status !== 'ok') return;
    e.preventDefault();
    if (!useVideoStore.getState().selectedAssetIds.includes(asset.id)) selectAsset(asset.id);
    setAssetContextMenu({ x: e.clientX, y: e.clientY });
  }

  // moveFocusFrom(currentId, step): roving-tabindex arrow navigation. Steps through `filteredAssets`'
  // OWN visual order (step=±1 for Left/Right, ±2 for Up/Down — matches the fixed `grid-cols-2` layout
  // below) rather than a separately-filtered "selectable only" list, so the step size stays correct
  // even when a non-'ok' (offline/error) card sits between two 'ok' ones. Keeps stepping past any
  // non-'ok' card it lands on (same direction, same magnitude) since those aren't focusable — clamps
  // at the array bounds instead of wrapping, standard grid-nav behavior.
  function moveFocusFrom(currentId, step) {
    const ids = filteredAssets.map((a) => a.id);
    let next = ids.indexOf(currentId) + step;
    while (next >= 0 && next < filteredAssets.length) {
      if (filteredAssets[next].status === 'ok') {
        gridRef.current?.querySelector(`[data-asset-id="${filteredAssets[next].id}"]`)?.focus();
        return;
      }
      next += step;
    }
  }

  // Ctrl/Cmd+A / Escape — focus-scoped to the grid itself (same pattern Timeline.jsx already
  // established for its own shortcuts), so this never fights the browser's page-wide select-all or
  // Timeline's own Escape/clear-selection handling.
  function handleGridKeyDown(e) {
    if (isMod(e) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAssetSelection(filteredAssets.filter((a) => a.status === 'ok').map((a) => a.id));
      return;
    }
    if (e.key === 'Escape') { clearAssetSelection(); return; }

    // 08-L L6 residual: arrow-key navigation and Enter/Space-to-select between individual asset
    // cards — see `focusedAssetId`'s own comment above for why this exists. `e.target` here is
    // whichever card actually has DOM focus (event delegation: keydown bubbles from the focused
    // card up to this container), not necessarily `focusedAssetId` state (that only updates on the
    // resulting `focus` event, one render later) — reading it straight off the DOM avoids a stale id.
    const currentId = e.target.closest?.('[data-asset-id]')?.dataset.assetId;
    if (!currentId) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation(); // keep Timeline.jsx's global frame-step (Left/Right) listener from ALSO firing — same pattern Player.jsx's handleContainerKeyDown already uses
      const card = e.target.closest('[data-asset-id]');
      const columns = Math.max(1, getComputedStyle(card.parentElement).gridTemplateColumns.split(' ').length);
      const step = e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : e.key === 'ArrowRight' ? 1 : -1;
      moveFocusFrom(currentId, step);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation(); // keep Timeline.jsx's global Space-to-play-pause listener from ALSO firing
      const asset = filteredAssets.find((a) => a.id === currentId);
      // Reuses handleAssetClick's own click contract (Mod=toggle, Shift=range, plain=replace) instead
      // of a second selection logic — isMod()/e.shiftKey both read straight off KeyboardEvent same as
      // MouseEvent, so no adaptation needed.
      if (asset) handleAssetClick(asset, e);
    }
  }

  // 08.2.4 §3: "Create timelines" only appears for an all-video, all-ready selection — mixed/
  // image/audio selections show no create-timeline entry at all rather than a disabled state
  // nobody's asked to see yet (see plan's scope decision).
  // effectiveFocusedId: the roving-tabindex "active" card — `focusedAssetId` state when it's still a
  // valid, selectable card in the CURRENT filtered/kind list, else the first selectable one. Falling
  // back like this (rather than leaving it possibly stale/absent) guarantees there's always exactly
  // one Tab stop into the grid whenever at least one 'ok' asset exists — e.g. right after a search
  // query filters out the previously-focused card, or on first render before anything's been focused.
  const okAssets = filteredAssets.filter((a) => a.status === 'ok');
  const effectiveFocusedId = okAssets.some((a) => a.id === focusedAssetId) ? focusedAssetId : okAssets[0]?.id;

  const selectedAssets = selectedAssetIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean);
  const canCreateTimelines = selectedAssets.length > 0 && selectedAssets.every((a) => a.kind === 'video' && a.status === 'ok');
  const selectedTotalDurationMs = selectedAssets.reduce((sum, a) => sum + (a.durationMs || 0), 0);

  // orderedSelectedAssets: the actual Gallery order (filteredAssets' order), not selection-click
  // order — matches the create-timeline dialog's "thứ tự theo Media Bin hiện tại".
  const orderedSelectedAssets = filteredAssets.filter((a) => selectedAssetIds.includes(a.id));

  // 08-C C5: shared by the selection bar's "Xoá" button and the context menu's "Delete" entry —
  // window.confirm() matches the existing destructive-action pattern this codebase already uses
  // (frontend/src/components/WorkflowLibraryModal.jsx's handleDelete), not a new custom modal.
  async function handleDeleteSelected() {
    const count = selectedAssetIds.length;
    if (count === 0) return;
    try {
      if (useVideoStore.getState().pendingCommands.length) throw new Error('Chờ lưu timeline trước khi xoá asset.');
      const ids = [...selectedAssetIds], usage = await videoAssetUsage(ids);
      const message = `Xoá ${count} asset khỏi Media Bin?` + (usage.length ? `\n\nĐang dùng tại:\n${usage.map(t => `• ${t.name}: ${t.clipCount} clip`).join('\n')}\n\nCác clip này sẽ bị xoá. Giữ nguyên timeline và nội dung khác.` : '') + '\nFile gốc trên máy được giữ nguyên.';
      if (!window.confirm(message)) return;
      const result = await videoAssetUsage(ids, usage);
      setAssetContextMenu(null);
      useVideoStore.setState(s => ({ assets: s.assets.filter(a => !ids.includes(a.id)), selectedAssetIds: [], assetsVersion: s.assetsVersion + 1 }));
      const current = useVideoStore.getState().project?.id;
      if (result.affectedTimelineIds.includes(current)) await useVideoStore.getState().openProject(current);
    } catch (err) { useVideoStore.setState({ error: err.message }); }
  }

  async function handleConfirmCreateTimelines(mode, orderedAssetIds, baseName) {
    const result = await batchCreateTimelines(mode, orderedAssetIds, baseName);
    setCreateDialogMode(null);
    // 08.2.4 plan: minimal usability fix — open the first created timeline right away instead of
    // leaving the user to find it through the header switcher (this app had no way to see a
    // freshly-created OTHER project otherwise).
    const firstId = result.createdTimelineIds[0];
    if (firstId) openProject(firstId);
  }

  return (
    <div className="flex flex-col h-full bg-[var(--card,#fff)]"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={e => {
        if (isInternalMediaDrag(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); importExternalFiles([...e.dataTransfer.files]); }
      }}
      onPaste={e => { if (e.clipboardData.files.length && !e.target.matches('input,textarea')) { e.preventDefault(); e.stopPropagation(); importExternalFiles([...e.clipboardData.files]); } }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border,#f3f4f6)]">
        <h2 className="text-sm font-semibold text-[var(--text,#111827)]">Media Bin</h2>
        <div className="flex items-center gap-1.5">
          {isRecording ? (
            <button
              onClick={handleStopRecording}
              aria-label="Dừng ghi âm"
              className="px-3 h-8 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <Square size={12} fill="currentColor" />
              {`${Math.floor(recordedSeconds / 60)}:${String(recordedSeconds % 60).padStart(2, '0')}`}
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
              disabled={!!importingPath}
              title="Ghi âm giọng nói qua microphone"
              aria-label="Ghi âm giọng nói qua microphone"
              className="w-8 h-8 rounded-lg text-xs font-medium border border-[var(--card-border,#e5e7eb)] disabled:opacity-40 hover:bg-[var(--n100,#f3f4f6)] inline-flex items-center justify-center focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <Mic size={14} />
            </button>
          )}
          <button
            onClick={handleImport}
            disabled={!!importingPath || isRecording}
            className="px-3 h-8 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] disabled:opacity-40 hover:bg-[var(--n800,#1f2937)] inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            {importingPath ? <Loader2 size={13} className="animate-spin" /> : null}
            {importingPath === 'recording' ? 'Đang lưu ghi âm…' : importingPath ? 'Đang import…' : 'Import file'}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 px-4 py-1 text-[10px] text-[var(--n600)]">Kích thước asset
        <input aria-label="Kích thước asset Media Bin" type="range" min="90" max="280" step="10" value={cardSize}
          onChange={e => { const size = Number(e.target.value); setCardSize(size); localStorage.setItem('video-media-card-size', String(size)); }} className="min-w-0 flex-1 accent-[var(--accent)]" />
      </label>
      <div className="relative px-4 py-2 border-b border-[var(--card-border,#f3f4f6)]">
        <Search size={13} className="absolute left-6 top-1/2 -translate-y-1/2 text-[var(--n600,#4b5563)] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm theo tên file…"
          aria-label="Tìm asset theo tên file"
          className="w-full h-8 pl-7 pr-2 text-xs rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        />
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-[var(--status-error,#ef4444)]/10 text-[var(--status-error,#ef4444)] text-xs flex items-center justify-between gap-2">
          <span>{error}</span>
          <button onClick={clearError} className="shrink-0 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded">Đóng</button>
        </div>
      )}

      {/* 08.2.4 §2: "N selected of M, loại asset, total duration/size khi có và action hợp lệ". */}
      <div className="px-4 py-1.5 border-b border-[var(--card-border,#f3f4f6)] text-xs">
        <button type="button" aria-expanded={showPathImport} onClick={() => setShowPathImport(v => !v)} className="text-[var(--n600,#4b5563)] underline rounded focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)]">Nhập đường dẫn file</button>
        {showPathImport && (
          <form className="flex flex-col gap-2 py-2" onSubmit={async (e) => {
            e.preventDefault();
            const sourcePath = sourcePathInput.trim().replace(/^"|"$/g, '');
            if (!sourcePath || importingPath) return;
            try { await importAsset(sourcePath); setSourcePathInput(''); setShowPathImport(false); } catch { /* error banner retains the path for correction */ }
          }}>
            <label htmlFor="video-import-path" className="text-[var(--n600,#4b5563)]">Đường dẫn trên máy chạy agent</label>
            <input id="video-import-path" value={sourcePathInput} onChange={e => setSourcePathInput(e.target.value)} autoFocus className="min-w-0 w-full rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] p-2 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)]" />
            <button type="submit" disabled={!sourcePathInput.trim() || !!importingPath || isRecording} className="self-end rounded-lg px-3 py-1.5 bg-[var(--n900,#111827)] text-[var(--n0,#fff)] disabled:opacity-40">Nhập file</button>
          </form>
        )}
      </div>
      {selectedAssetIds.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--card-border,#f3f4f6)] bg-[var(--accent-tint,#EDE9FE)] text-xs">
          <span className="font-medium text-[var(--text,#111827)]">{selectedAssetIds.length} đã chọn</span>
          {selectedTotalDurationMs > 0 && <span className="text-[var(--n600,#4b5563)]">· {formatDuration(selectedTotalDurationMs)}</span>}
          <div className="flex-1" />
          {canCreateTimelines && (
            <button
              type="button"
              onClick={() => setCreateDialogMode('all-selected-one-timeline')}
              className="h-7 px-2.5 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              <Layers size={12} /> Tạo timeline…
            </button>
          )}
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={deletingAssetIds.length > 0}
            className="h-7 px-2.5 rounded-lg text-xs font-medium text-[var(--status-error,#ef4444)] border border-[var(--status-error,#ef4444)]/30 disabled:opacity-40 hover:bg-[var(--status-error,#ef4444)]/10 inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            {deletingAssetIds.length > 0 ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Xoá
          </button>
          <button type="button" onClick={clearAssetSelection} aria-label="Bỏ chọn" title="Bỏ chọn" className="h-7 w-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n0,#fff)]/60 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={13} />
          </button>
        </div>
      )}

      <div
        ref={gridRef}
        // 08-L L6 residual: the container itself is only a Tab stop as a FALLBACK for the empty/
        // all-unselectable state (nothing for roving tabindex to land on below) — normally the one
        // 'ok' card at `effectiveFocusedId` is the grid's single Tab stop instead (see its own
        // comment), matching the WAI-ARIA APG composite-widget pattern rather than a plain focusable
        // container.
        tabIndex={okAssets.length === 0 ? 0 : -1}
        onKeyDown={handleGridKeyDown}
        // Only steals focus to the container for a click that landed OUTSIDE any card (e.g. the
        // padding around the grid) — a click ON a card now focuses that card natively (it has its
        // own tabIndex below), which this capture-phase handler must NOT override, or arrow-key
        // navigation would always resume from whichever card was clicked last instead of the one the
        // user actually clicked.
        onMouseDownCapture={(e) => { if (!e.target.closest('[data-asset-id]')) gridRef.current?.focus(); }}
        className="flex-1 overflow-y-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent,#7C5CFA)]"
      >
        {loading && assets.length === 0 && (
          <p className="text-xs text-[var(--n600,#4b5563)] px-2 py-4">Đang tải danh sách asset…</p>
        )}
        {!loading && assets.length === 0 && (
          <p className="text-xs text-[var(--n600,#4b5563)] px-2 py-4">Chưa có asset nào — bấm "Import file" để bắt đầu.</p>
        )}
        {!loading && assets.length > 0 && filteredAssets.length === 0 && (
          <p className="text-xs text-[var(--n600,#4b5563)] px-2 py-4">Không tìm thấy asset nào khớp "{searchQuery}".</p>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cardSize}px), 1fr))` }}>
          {filteredAssets.map((asset) => {
            const Icon = KIND_ICON[asset.kind] || Film;
            const needsRelink = asset.status === 'offline' || asset.status === 'error';
            const draggable = asset.status === 'ok';
            const isSelected = selectedAssetIds.includes(asset.id);
            return (
              <div
                key={asset.id}
                data-asset-id={asset.id}
                data-selected={isSelected || undefined}
                // 08-L L6 residual: only a selectable ('ok') card joins the roving-tabindex Tab
                // order at all — offline/error/processing cards stay unfocusable, consistent with
                // them already being unselectable/undraggable above.
                tabIndex={draggable ? (asset.id === effectiveFocusedId ? 0 : -1) : undefined}
                onFocus={draggable ? () => setFocusedAssetId(asset.id) : undefined}
                draggable={draggable}
                onDragStart={(e) => {
                  if (!draggable) { e.preventDefault(); return; }
                  e.dataTransfer.clearData();
                  e.dataTransfer.setData('application/x-video-asset', asset.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => handleAssetClick(asset, e)}
                onContextMenu={(e) => handleAssetContextMenu(asset, e)}
                className={`rounded-xl border overflow-hidden flex flex-col outline-none ${draggable ? 'cursor-grab focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1' : ''} ${isSelected ? 'border-[var(--accent,#7C5CFA)] ring-2 ring-[var(--accent,#7C5CFA)]' : 'border-[var(--card-border,#e5e7eb)]'}`}
              >
                {/* 08-UI §6.1 Priority 0 bước 4: thumbnail-first — duration/status ở overlay ngay
                    trên ảnh (không đẩy ảnh thành ô cao bằng text row riêng như trước). */}
                <div className="relative aspect-video overflow-hidden bg-[var(--n100,#f3f4f6)] flex items-center justify-center">
                  {asset.thumbnailUrl || (asset.kind === 'image' && asset.status === 'ok') ? (
                    // Phase 14 (§0): an image asset never gets a generated thumbnailUrl (backend/
                    // routes/video-assets.js deliberately skips probing/thumbnailing it — "source
                    // file itself is already directly displayable") — this is that promised
                    // fallback, previously documented in that comment but never actually wired up.
                    <img draggable={false} src={asset.thumbnailUrl || previewUrl(asset.sourcePath)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <Icon size={28} className="text-[var(--n300,#d1d5db)]" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 py-1 text-[10px] font-medium text-white bg-black/80">
                    <span>{formatDuration(asset.durationMs)}</span>
                    <span className="inline-flex items-center gap-1" style={{ color: STATUS_TOKEN[asset.status] }}>
                      {asset.status === 'processing' && <Loader2 size={10} className="animate-spin" />}
                      {(asset.status === 'offline' || asset.status === 'error') && <AlertCircle size={10} />}
                      {STATUS_LABEL[asset.status] || asset.status}
                    </span>
                  </div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <p className="text-xs font-medium text-[var(--n600,#4b5563)] truncate" title={asset.sourcePath}>
                    {asset.sourcePath.split(/[\\/]/).pop()}
                  </p>
                  <div className="flex items-center justify-between gap-1 text-[11px] text-[var(--n600,#4b5563)]">
                    <span>{formatSize(asset.sizeBytes)}</span>
                    {needsRelink && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRelink(asset.id); }}
                        disabled={relinkingId === asset.id}
                        aria-label={`Relink asset ${asset.sourcePath.split(/[\\/]/).pop()}`}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--accent,#7C5CFA)] hover:underline disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                      >
                        {relinkingId === asset.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                        Relink
                      </button>
                    )}
                  </div>
                  {asset.status === 'error' && asset.errorMessage && (
                    <p className="text-[10px] text-[var(--status-error,#ef4444)] truncate" title={asset.errorMessage}>{asset.errorMessage}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 08.2.4 §3: local menu, deliberately not `components/ContextMenu.jsx` (that one is wired to
          the flow-canvas store — a different domain, see plan). 08-C C5: "Delete" is always shown
          (any kind, any status selection) — Create-timelines section only for an all-video selection,
          same gate as the selection-bar button above. */}
      {assetContextMenu && (
        <div
          ref={contextMenuRef}
          data-testid="asset-context-menu"
          className="fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl py-1.5 px-1 min-w-[220px]"
          style={{ left: assetContextMenu.x, top: assetContextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {orderedSelectedAssets.length === 1 && <button type="button" className="w-full text-left px-3 py-1.5 text-xs rounded-lg text-[var(--n600)] hover:bg-[var(--n100)]" onClick={() => { setRightsAsset(orderedSelectedAssets[0]); setAssetContextMenu(null); }}>Quyền sử dụng media</button>}
          {canCreateTimelines && (
            <>
              <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--n600,#4b5563)]">Create timelines</p>
              <button
                type="button"
                onClick={() => { setCreateDialogMode('all-selected-one-timeline'); setAssetContextMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)]"
              >
                Tất cả → 1 timeline
              </button>
              <button
                type="button"
                onClick={() => { setCreateDialogMode('one-video-one-timeline'); setAssetContextMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)]"
              >
                Mỗi video → 1 timeline
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="w-full text-left px-3 py-1.5 text-xs rounded-lg text-[var(--status-error,#ef4444)] hover:bg-[var(--status-error,#ef4444)]/10 inline-flex items-center gap-1.5"
          >
            <Trash2 size={12} /> Xoá {selectedAssetIds.length > 1 ? `${selectedAssetIds.length} asset` : ''}
          </button>
        </div>
      )}

      {createDialogMode && (
        <CreateTimelinesDialog
          mode={createDialogMode}
          orderedAssets={orderedSelectedAssets}
          onClose={() => setCreateDialogMode(null)}
          onConfirm={handleConfirmCreateTimelines}
        />
      )}

      <FolderBrowserModal />
      {rightsAsset && <MediaRightsDialog asset={rightsAsset} onClose={() => setRightsAsset(null)} />}
    </div>
  );
}
