// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): "tự viết track
// renderer (DOM/CSS ... KHÔNG dùng React Flow, timeline không phải node graph)". Tracks stack
// vertically, clips are absolutely-positioned divs sized by pxPerSecond — no canvas, no drag
// library (native HTML5 drag-and-drop from MediaBin.jsx's asset cards).
//
// Keyboard shortcuts (split/ripple-delete/undo/redo/frame-step) are wired here rather than a
// separate hook, since they all read/mutate the same clip-under-playhead/selection state this
// component already owns.
//
// Phase 6 (Core Parity, §0): +/- track buttons (AddTrack/RemoveTrack) and dragging a clip ALREADY
// on the timeline (not just from MediaBin) to a new position/track (MoveClip) — the 2 gaps Phase 5
// left ("Timeline UI để tạo >1 video track thật vẫn CHƯA có"). Tracks now render sorted by `.order`
// (previously rendered in raw array order, which just happened to already equal `.order` since
// nothing ever reordered `state.tracks` — AddTrack appends, so that stops being true the moment a
// 2nd video track exists) — display order must match `.order` since that's also what
// canvasEngine.js's composite loop sorts by (Phase 5), so what's on top on screen matches what's
// on top in the actual composite.
//
// Phase 13 (§0): caption cues are `clip`-shaped objects on a `type: 'caption'` track — no new
// command types, no assetId (renderPlanner.js never routes a caption-track clip through
// buildTrackLayer/buildClipVideoBranch, so the lack of one is never a problem there). This gets
// drag/move/trim/split/ripple-delete/snapping/undo/redo for free from the SAME command
// infrastructure video/audio clips already use — only the CREATION path differs (double-click, not
// drag from MediaBin, since there's no asset) and the CLIP LABEL differs (its own text content).
//
// 08.2.1 (specs/ai-creative-operations-platform/08-2-1-selection-navigation-and-feedback.md):
// multi-select (Mod+click/Shift+click/marquee), a sticky ruler for continuous drag-scrub, reactive
// zoom (`pxPerSecond` used to be a hardcoded module constant), auto-scroll near the viewport edges,
// and a track lock toggle + UI-layer edit guards. See that spec + the mother tracker's §0.5 for the
// full acceptance criteria this pass targets, and its own §12 for what was deliberately cut.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TEXT_DEFAULTS, SHAPE_DEFAULTS } from '@shared/video-vector';

// Menu height depends on clip type and available actions. Measure it before paint
// so menus opened on lower tracks remain usable in the right-preview layout.
function useViewportMenu(ref, menu, setMenu) {
  useLayoutEffect(() => {
    if (!menu || !ref.current) return undefined;
    const contain = () => {
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8));
      const y = Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8));
      if (x !== menu.x || y !== menu.y) setMenu(current => current ? { ...current, x, y } : null);
    };
    contain();
    window.addEventListener('resize', contain);
    return () => window.removeEventListener('resize', contain);
  }, [ref, menu, setMenu]);
}
import {
  Eye, EyeOff, Volume2, VolumeX, Lock, Unlock, Film, Music, Captions, Sticker, Image as ImageIcon, Plus,
  Undo2, Redo2, Scissors, Trash2, Diamond, ZoomIn, ZoomOut, Scan, Frame, Keyboard, Copy,
  Group as GroupIcon, Ungroup, Layers, PackageOpen, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, Type, Square,
} from 'lucide-react';
import ShortcutHelpDialog from './ShortcutHelpDialog.jsx';
import EmbedTimelineDialog from './EmbedTimelineDialog.jsx';
import BezierEasingEditor from './BezierEasingEditor.jsx';
import GraphEditorPanel from './GraphEditorPanel.jsx';
import { useVideoStore } from '../store.js';
import { captureClips, buildPaste } from '../timelineClipboard.js';
import { importExternalFiles, isInternalMediaDrag } from '../externalMedia.js';
import TimelineTransition from './TimelineTransition.jsx';
import {
  findClipLocation, findClipAtPlayheadMs, clipsOverlap, buildSnapCandidates, resolveSnap, computeInsertIndex,
  keyframeMarkersForClip, adjacentClipPairs, clipScreenRect,
  rectsIntersect, rectContains, resolveSelectionOnClick, buildDuplicateClip, findNextFreeSlot,
  buildMultiMoveTargets, multiMoveOverlaps, mergeRippleIntervals, computeSpeedResizedDuration,
  getTrackZone, tracksAreZoneCompatible, getTimelineRows, clipsInGroup, orderForNewTrack, trackReorderChanges,
} from '../timelineUtils.js';
import { parseSubtitle, formatSrt, formatVtt } from '../subtitleFormat.js';
import { evaluateClipTransform, TRANSFORM_KEYS } from '@shared/video-keyframes';
import { isMod, SHORTCUTS } from '../shortcuts.js';
import { subscribePeaks } from '../waveform.js';
import { previewUrl, fetchVideoProjectRevision } from '../../lib/api.js';

// 08-UI §6.4/§5.1: icon riêng theo track type, dùng chung bộ Lucide MediaBin.jsx đã dùng cho asset
// kind — video/audio tô màu qua token (--track-video mới, --status-done có sẵn cho audio); caption/
// sticker chỉ phân biệt bằng SHAPE icon (không có track màu riêng, đúng nguyên tắc "tím/màu track
// chỉ tiết chế, không lấn accent selection").
// 08.2.6 §1: `image` is a new track type, same visual-zone family as `video` (see
// getTrackZone/tracksAreZoneCompatible in timelineUtils.js) — shares its icon color token below.
const TRACK_TYPE_ICON = { video: Film, image: ImageIcon, audio: Music, caption: Captions, sticker: Sticker, text: Type, shape: Square };
const TRACK_TYPE_LABEL = { video: 'Video', image: 'Ảnh', audio: 'Audio', caption: 'Phụ đề', sticker: 'Sticker', text: 'Text', shape: 'Shape' };
// 08.2.6 §1: `image` shares `video`'s token — same visual-zone family, not a new token (design
// system rule: no new token for a purely cosmetic distinction the spec doesn't ask for).
const TRACK_TYPE_COLOR = { video: 'var(--track-video,#6366F1)', image: 'var(--track-video,#6366F1)', audio: 'var(--status-done,#22c55e)' };
const TRACK_HEADER_WIDTH_PX = 220;

// Phase 8 (04-video-editor.md §5), moved from VideoToolbar.jsx (08-UI Priority 0 bước 2 — 1
// Timeline toolbar duy nhất, xem file đó trước khi xoá): fixed speed preset list, nothing asks for
// arbitrary values, dropdown keeps reverse/freeze-frame from needing separate controls.
const SPEED_PRESETS = [
  { value: 0.25, label: '0.25x' },
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
  { value: 4, label: '4x' },
  { value: -1, label: 'Đảo ngược (1x)' },
  { value: 0, label: 'Đóng băng khung hình' },
];

const SNAP_PX = 10;
const MIN_TRACK_AREA_SECONDS = 30; // keeps drop-space visible even on a near-empty project
const MIN_PX_PER_SECOND = 5;
const MAX_PX_PER_SECOND = 400;
const DEFAULT_PX_PER_SECOND = 60;
const RULER_HEIGHT_PX = 20; // must match the ruler's own `style={{ height: RULER_HEIGHT_PX }}` below
const MARQUEE_THRESHOLD_PX = 4; // below this drag distance, mousedown+mouseup is treated as a plain click
const KEYFRAME_TIME_EPSILON_MS = 1e-6; // 08-G G4: float-noise tolerance for "is the playhead exactly ON a marker"
// 08-G G5 (easing picker): the 5 presets shared/video-easing.js's EASINGS map actually implements —
// kept as a small local list (not derived from that module) since the LABELS are UI-only and this
// is the one place they're needed; adding a 6th preset there is a 2-line change here too, not worth
// a shared registry for a fixed set this small.
const EASING_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In (vào chậm)' },
  { value: 'ease-out', label: 'Ease Out (ra chậm)' },
  { value: 'ease-in-out', label: 'Ease In-Out (vào & ra chậm)' },
  { value: 'hold', label: 'Hold (giữ nguyên tới keyframe sau)' },
];
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_SPEED_PX = 20;
const TRIM_HANDLE_PX = 8;
const MIN_CLIP_WIDTH_FOR_TRIM_PX = 16; // below this, both handles would overlap — hide them instead
const SNAP_STICKY_MARGIN_PX = 2; // 08.2.2 §2: a new snap candidate must beat the sticky one by more than this to take over

const SNAP_TYPE_LABEL = {
  playhead: 'Playhead', marker: 'Marker', transition: 'Transition', 'clip-edge': 'Clip cạnh', 'project-bounds': 'Biên project',
};

function formatTimecode(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const frames = Math.floor((totalMs % 1000) / 33); // display only, ~30fps granularity
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// 08-UI §6.4 Priority 0 bước 2: waveform thật cho audio clip (peaks decode client-side, xem
// waveform.js) — component riêng ở module scope (không định nghĩa trong .map()) vì cần hook
// useState/useEffect của chính nó, tránh vi phạm Rules of Hooks. Vẽ bằng CSS bar thay vì canvas —
// đơn giản hơn, tự theo theme qua token CSS var, không cần vẽ lại khi đổi theme.
const trackHeight = track => track.type === 'audio' ? ({ short: 48, default: 64, tall: 112 }[track.height] || 64) : 64;
function AudioWaveform({ assetId, sourcePath, clip, durationMs, width }) {
  const [peaks, setPeaks] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!assetId || !sourcePath) return;
    let cancelled = false;
    setFailed(false); setPeaks(null);
    subscribePeaks(assetId, sourcePath, (p) => { if (!cancelled) { setPeaks(p); setFailed(!p); } });
    return () => { cancelled = true; };
  }, [assetId, sourcePath]);
  if (!peaks) return <span className="text-[9px] opacity-60" aria-label={failed ? 'Không đọc được sóng âm' : 'Đang tải sóng âm'}>{failed ? 'Không đọc được sóng âm' : 'Đang tải sóng âm…'}</span>;
  const count = Math.max(2, Math.min(600, Math.round(width / 3)));
  const start = Math.max(0, Math.floor(clip.sourceInMs / durationMs * peaks.length));
  const end = Math.min(peaks.length, Math.ceil(clip.sourceOutMs / durationMs * peaks.length));
  const bucketSize = (end - start) / count;
  const bars = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const bucket = clip.speed < 0 ? count - 1 - i : i;
    for (let j = Math.floor(start + bucket * bucketSize); j < Math.min(peaks.length, Math.ceil(start + (bucket + 1) * bucketSize)); j++) max = Math.max(max, peaks[j]);
    bars.push(max);
  }
  return (
    <div data-audio-waveform="true" className="absolute inset-0 flex items-center gap-px px-0.5 pointer-events-none overflow-hidden" aria-hidden="true">
      {bars.map((v, i) => (
        <div key={i} className="flex-1 bg-[var(--status-done,#22c55e)]/50 rounded-sm" style={{ height: `${Math.max(8, v * 90)}%` }} />
      ))}
    </div>
  );
}

export default function Timeline() {
  const projectState = useVideoStore((s) => s.projectState);
  const assets = useVideoStore((s) => s.assets);
  const playheadMs = useVideoStore((s) => s.playheadMs);
  const setPlayheadMs = useVideoStore((s) => s.setPlayheadMs);
  const selectedIds = useVideoStore((s) => s.selectedIds);
  const primaryId = useVideoStore((s) => s.primaryId);
  const selectClip = useVideoStore((s) => s.selectClip);
  const setSelection = useVideoStore((s) => s.setSelection);
  const toggleClipSelection = useVideoStore((s) => s.toggleClipSelection);
  const clearSelection = useVideoStore((s) => s.clearSelection);
  const execute = useVideoStore((s) => s.execute);
  const undo = useVideoStore((s) => s.undo);
  const redo = useVideoStore((s) => s.redo);
  const canUndo = useVideoStore((s) => s.canUndo);
  const canRedo = useVideoStore((s) => s.canRedo);
  const livePreviewPatch = useVideoStore((s) => s.livePreviewPatch);
  // 08-L L3 §2 finding #3, now patched (Space bar bound below) — TransportBar.jsx's own toggle
  // button was the ONLY way to play/pause before this.
  const togglePlay = useVideoStore((s) => s.togglePlay);
  // 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md)
  const openNestedTimeline = useVideoStore((s) => s.openNestedTimeline);
  const unpackCompoundClip = useVideoStore((s) => s.unpackCompoundClip);
  const embedTimelineAsCompoundClip = useVideoStore((s) => s.embedTimelineAsCompoundClip);

  // 08.3.1 (canvas drag Escape-cancel, TransformOverlay.jsx/Player.jsx's MultiSelectBounds): this
  // component's own global Escape handler below must NOT also clearSelection() while some OTHER
  // gesture elsewhere (a canvas transform drag) is mid-flight and handling that SAME Escape press
  // itself — both listeners sit on `window`, and DOM dispatch runs every listener on a node in
  // registration order regardless of stopPropagation() (only stopImmediatePropagation() would skip
  // sibling listeners, and this one is registered first, before any gesture-scoped listener could
  // exist). A ref (not the raw prop) so this doesn't force the handleKeyDown effect below to
  // re-subscribe on every pointermove tick of an unrelated drag — see scrubClientXRef etc. for the
  // same ref-mirror precedent already used in this file.
  const livePreviewPatchRef = useRef(null);
  useEffect(() => { livePreviewPatchRef.current = livePreviewPatch; }, [livePreviewPatch]);

  // staleCompoundTimelineIds — 08-F F5 / ADR 0034: informational-only badge, checked once per
  // distinct embedded timeline whenever the clip list changes (not a poll) — compares
  // compoundRef.pinnedSeq against that nested project's CURRENT latest seq via the existing
  // GET /:id/revision (08-E E5). A fetch failure for one id just leaves it out of the stale set
  // (no badge) rather than surfacing an error — same "background convenience check must never
  // itself be disruptive" principle checkForStaleVersion() in store.js already follows.
  const [staleCompoundTimelineIds, setStaleCompoundTimelineIds] = useState(() => new Set());
  useEffect(() => {
    if (!projectState) return undefined;
    const refs = new Map(); // timelineProjectId -> pinnedSeq (last one wins if embedded >1 time, fine for a badge)
    for (const track of projectState.tracks) {
      for (const clip of track.clips) {
        if (clip.compoundRef) refs.set(clip.compoundRef.timelineProjectId, clip.compoundRef.pinnedSeq);
      }
    }
    if (refs.size === 0) { setStaleCompoundTimelineIds(new Set()); return undefined; }
    let cancelled = false;
    Promise.all([...refs.entries()].map(([id, pinnedSeq]) =>
      fetchVideoProjectRevision(id).then(({ seq }) => (seq > pinnedSeq ? id : null)).catch(() => null)
    )).then((results) => {
      if (!cancelled) setStaleCompoundTimelineIds(new Set(results.filter(Boolean)));
    });
    return () => { cancelled = true; };
  }, [projectState]);

  const scrollRef = useRef(null);
  const [dragOverTrackId, setDragOverTrackId] = useState(null);
  const [dropError, setDropError] = useState(null);
  const [insertionTrackId, setInsertionTrackId] = useState(null);
  const [trackMenu, setTrackMenu] = useState(null);
  const trackMenuRef = useRef(null);
  useViewportMenu(trackMenuRef, trackMenu, setTrackMenu);
  useEffect(() => {
    if (!trackMenu) return;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !trackMenuRef.current?.contains(e.target)) setTrackMenu(null); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [trackMenu]);
  // 08-L L6: shortcut-help dialog visibility — pure UI/session state, never touches commandStack.
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  // 08-F F5 / ADR 0034: EmbedTimelineDialog's own open/close, same "pure UI/session state" class as
  // showShortcutHelp above.
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);

  // 08-L L3 (§2 finding #1, now patched — see `08-l-3`'s own file): Timeline had NO context menu at
  // all before this. Stores only { x, y, clipId } — never a stale track/clip snapshot — the menu's
  // own render below re-resolves track/clip fresh from `projectState` via findClipLocation, same
  // "never trust a captured closure across a render" rule Player.jsx's canvas-nudge comment states.
  const [clipContextMenu, setClipContextMenu] = useState(null);
  const clipContextMenuRef = useRef(null);
  useViewportMenu(clipContextMenuRef, clipContextMenu, setClipContextMenu);
  useEffect(() => {
    if (!clipContextMenu) return undefined;
    // Same containment-check pattern MediaBin.jsx's asset context menu already uses (a plain
    // "close on every mousedown" would also close on a mousedown INSIDE the menu, before its own
    // onClick ever runs — see that file's own comment for the bug this avoids).
    const close = (e) => { if (!clipContextMenuRef.current?.contains(e.target)) setClipContextMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [clipContextMenu]);

  // 08-G G5 (easing picker): { x, y, clipId, timeMs } — timeMs (not the marker's `keyframes` array)
  // so the render below re-resolves the LIVE marker fresh, same "never trust a stale closure" rule
  // clipContextMenu's own comment states.
  const [keyframeContextMenu, setKeyframeContextMenu] = useState(null);
  const keyframeContextMenuRef = useRef(null);
  useViewportMenu(keyframeContextMenuRef, keyframeContextMenu, setKeyframeContextMenu);
  useEffect(() => {
    if (!keyframeContextMenu) return undefined;
    const close = (e) => { if (!keyframeContextMenuRef.current?.contains(e.target)) setKeyframeContextMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [keyframeContextMenu]);

  // 08-G G5 (ADR 0036, custom bezier easing): { x, y, clipId, timeMs } — opened from
  // keyframeContextMenu's own "Custom (Bezier)..." item, at the SAME anchor position. Stays open
  // across MULTIPLE drag gestures (p1 then p2), only closed by an outside click/scroll — same
  // containment-check pattern as every other popover here.
  const [bezierEditor, setBezierEditor] = useState(null);
  const bezierEditorRef = useRef(null);
  useEffect(() => {
    if (!bezierEditor) return undefined;
    const close = (e) => { if (!bezierEditorRef.current?.contains(e.target)) setBezierEditor(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [bezierEditor]);

  // 08-G Graph Editor V1 (ADR 0037): { x, y, clipId, propertyKey } — opened from
  // keyframeContextMenu's own "Graph Editor..." item, same anchor position and outside-click-close
  // pattern as bezierEditor above.
  const [graphEditor, setGraphEditor] = useState(null);
  const graphEditorRef = useRef(null);
  useEffect(() => {
    if (!graphEditor) return undefined;
    const close = (e) => { if (!graphEditorRef.current?.contains(e.target)) setGraphEditor(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [graphEditor]);

  // 08.2.2 §2 (Snap): live guide state for a native-HTML5-drag gesture (asset drop, clip move,
  // duplicate-drag) — dragGestureRef is set at dragstart with which clip id(s), if any, to exclude
  // from candidates (a move excludes the clip(s) leaving that spot; a duplicate excludes nothing,
  // since the original stays and is a perfectly valid thing to snap the copy against; an asset
  // drop excludes nothing either, there's no existing clip). stickySnapRef holds the currently-
  // winning candidate for THIS gesture only (anti-flicker hysteresis, resolveSnap's own
  // `stickyCandidate` arg) and is reset at the start of each new gesture.
  const dragGestureRef = useRef(null);
  const stickySnapRef = useRef(null);
  const [snapGuide, setSnapGuide] = useState(null); // {ms, type} | null

  // 08.2.1 §5: was a hardcoded module-level constant — now reactive so Mod+wheel/fit-to-* can
  // change it. Persists nowhere (viewport zoom is per-session UI state, not composition content).
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  function msToPx(ms) { return (ms / 1000) * pxPerSecond; }
  function pxToMs(px) { return (px / pxPerSecond) * 1000; }
  function timeToX(ms) { return TRACK_HEADER_WIDTH_PX + msToPx(ms); }

  // 08.1 (§7, "virtualize/cull clip ... ngoài viewport khi scale lớn"): only `scrollLeft`/
  // `clientWidth` need to be reactive — everything else about a clip's own screen position is
  // still plain px math (msToPx/pxToMs). Re-measured on scroll and whenever the project (re)loads;
  // a window resize while not scrolling can leave `width` stale until the next scroll, which only
  // means the culled buffer at the edges is briefly a bit off, not a correctness issue.
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 2000 }); // generous fallback pre-measurement, avoids an empty-looking flash on first paint
  useEffect(() => {
    if (scrollRef.current) setViewport({ scrollLeft: scrollRef.current.scrollLeft, width: scrollRef.current.clientWidth });
  }, [projectState]);

  // 08.2.1 §2: reveal the primary selection when it changes (e.g. selected from the canvas, or
  // Shift/Mod+click moved the anchor) — no-op if it's already visible.
  useEffect(() => {
    if (!primaryId || !scrollRef.current) return;
    const clip = scrollRef.current.querySelector(`[data-clip-id="${primaryId}"]`);
    if (!clip) return;
    const bounds = clip.getBoundingClientRect(), viewport = scrollRef.current.getBoundingClientRect();
    if (bounds.top < viewport.top + RULER_HEIGHT_PX) scrollRef.current.scrollTop -= viewport.top + RULER_HEIGHT_PX - bounds.top;
    else if (bounds.bottom > viewport.bottom) scrollRef.current.scrollTop += bounds.bottom - viewport.bottom;
    if (bounds.left < viewport.left + TRACK_HEADER_WIDTH_PX) scrollRef.current.scrollLeft -= viewport.left + TRACK_HEADER_WIDTH_PX - bounds.left;
    else if (bounds.right > viewport.right) scrollRef.current.scrollLeft += bounds.right - viewport.right;
  }, [primaryId]);

  // 08.2.1 §5: Mod+wheel zoom is pointer-anchored — the time under the cursor must stay at the
  // same screen pixel after the zoom level changes. `zoomAnchorRef` stashes what that time/pixel
  // were right before the change; this effect runs AFTER the re-render at the new scale (so
  // totalWidthPx/msToPx already reflect it) and corrects scrollLeft once.
  const zoomAnchorRef = useRef(null);
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor || !scrollRef.current) return;
    zoomAnchorRef.current = null;
    const rect = scrollRef.current.getBoundingClientRect();
    scrollRef.current.scrollLeft = Math.max(0, timeToX(anchor.pointerMs) - (anchor.clientX - rect.left));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSecond]);

  function zoomBy(factor, clientX) {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const anchorClientX = clientX ?? (rect.left + rect.width / 2);
    const pointerMs = pxToMs(anchorClientX - rect.left + scrollRef.current.scrollLeft - TRACK_HEADER_WIDTH_PX);
    zoomAnchorRef.current = { pointerMs, clientX: anchorClientX };
    setPxPerSecond((p) => Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, p * factor)));
  }

  function handleFitToProject() {
    if (!scrollRef.current || !projectState) return;
    const durationSec = Math.max(1, maxClipEndMs / 1000);
    zoomAnchorRef.current = { pointerMs: 0, clientX: scrollRef.current.getBoundingClientRect().left + TRACK_HEADER_WIDTH_PX };
    setPxPerSecond(Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, (scrollRef.current.clientWidth - TRACK_HEADER_WIDTH_PX - 16) / durationSec)));
  }
  function handleFitToSelection() {
    if (!scrollRef.current || !projectState || selectedIds.length === 0) return;
    const locations = selectedIds.map((id) => findClipLocation(projectState, id)).filter(Boolean);
    if (locations.length === 0) return;
    const minIn = Math.min(...locations.map((l) => l.clip.timelineInMs));
    const maxOut = Math.max(...locations.map((l) => l.clip.timelineOutMs));
    const durationSec = Math.max(0.1, (maxOut - minIn) / 1000);
    zoomAnchorRef.current = { pointerMs: minIn, clientX: scrollRef.current.getBoundingClientRect().left + TRACK_HEADER_WIDTH_PX };
    setPxPerSecond(Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, (scrollRef.current.clientWidth - TRACK_HEADER_WIDTH_PX - 16) / durationSec)));
  }

  // React attaches `onWheel` as a PASSIVE native listener (perf default for scroll-related
  // events) — calling e.preventDefault() inside it is a silent no-op (logs "Unable to
  // preventDefault inside passive event listener invocation.", doesn't actually stop the
  // browser's own native scroll/zoom). A real Ctrl+wheel zoom NEEDS to block that native
  // behavior, so this is a manually-attached, explicitly non-passive listener instead of a JSX
  // `onWheel` prop. `zoomByRef` always points at the LATEST render's `zoomBy` (which closes over
  // the current `pxPerSecond`) so the listener body itself never goes stale.
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  useEffect(() => {
    const el = scrollRef.current;
    // `[projectState]` (not `[]`): on the FIRST render `projectState` is still null, this whole
    // component returns null below (see the early return further down) and `scrollRef.current` is
    // therefore also still null — an empty-deps effect would silently attach to nothing and never
    // get another chance to. Same "re-check once scrollRef actually has something" pattern the
    // viewport-measurement effect above this one already uses for the identical reason.
    if (!el) return;
    function onWheelNative(e) {
      if (!isMod(e)) return; // no modifier: leave native scroll/pan completely untouched (§5, "platform convention")
      e.preventDefault();
      zoomByRef.current(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX);
    }
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [projectState]);

  // 08.2.1 §5 (ref 24): shared by clip-drag (handleDragOverTrack, native DnD) and playhead-scrub
  // (handleScrubStart's rAF loop) — nudges scrollLeft proportionally when `clientX` is within
  // AUTO_SCROLL_EDGE_PX of the viewport edge. Both callers re-derive time from the CURRENT
  // scrollLeft afterward (xToMs always reads it live), so pointer-to-time stays correct through
  // the scroll with no extra compensation needed.
  function autoScrollForClientX(clientX) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fromLeft = clientX - rect.left;
    const fromRight = rect.right - clientX;
    if (fromLeft < AUTO_SCROLL_EDGE_PX) {
      el.scrollLeft = Math.max(0, el.scrollLeft - AUTO_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, fromLeft) / AUTO_SCROLL_EDGE_PX));
    } else if (fromRight < AUTO_SCROLL_EDGE_PX) {
      el.scrollLeft += AUTO_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, fromRight) / AUTO_SCROLL_EDGE_PX);
    }
  }

  // --- Marquee selection (§1/§3) ---
  // Local component state, not the store — pure visual/interaction-scoped UI state, same rationale
  // useResizablePanel.js already established for panel sizes not living in useVideoStore.
  const marqueeStateRef = useRef(null);
  const [marqueeRect, setMarqueeRect] = useState(null); // content-space (includes the ruler's own height), render-only

  // 08.2.2 §3 (Trim): live preview of the in-progress trim drag, cleared on mouseup. Not the
  // committed value — that only happens once via execute('TrimClip', ...) in handleTrimStart's
  // onUp, same "no per-tick command" rule the scrub/marquee gestures above already follow.
  const [trimPreview, setTrimPreview] = useState(null); // { clipId, edge, timelineInMs, timelineOutMs, sourceInMs, sourceOutMs }

  // 08-G G4 (keyframe navigation/remap): live preview of an in-progress keyframe-marker drag,
  // same "no per-tick command" rule as trimPreview above — MoveKeyframe only fires once, on
  // mouseup. `blocked` mirrors MoveKeyframe.js's own assertNoDuplicateKeyframeTime check (a
  // property in this marker already has a keyframe at the candidate time) so the drop is refused
  // with the same message a stale command would get, instead of silently landing there.
  const [keyframeDragPreview, setKeyframeDragPreview] = useState(null); // { clipId, timeMs, blocked }
  // Distinguishes "the marker's onClick fired because the drag never moved" (delete, existing
  // behavior) from "the marker's onClick fired right after a real drag released" (must NOT also
  // delete) — the trim handles avoid this because they have no onClick at all; the keyframe
  // marker needs both gestures on the same element.
  const keyframeDragSuppressClickRef = useRef(false);

  function handleMarqueeMove(e) {
    const st = marqueeStateRef.current;
    if (!st || !scrollRef.current || !projectState) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const curX = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const curY = e.clientY - rect.top + scrollRef.current.scrollTop;
    if (!st.moved) {
      if (Math.hypot(e.clientX - st.startClientX, e.clientY - st.startClientY) < MARQUEE_THRESHOLD_PX) return;
      st.moved = true;
    }
    const rectNow = {
      left: Math.min(st.startX, curX), top: Math.min(st.startY, curY),
      width: Math.abs(curX - st.startX), height: Math.abs(curY - st.startY),
    };
    setMarqueeRect(rectNow);

    const containment = e.altKey; // §3: intersection is default, Alt switches to containment
    // 08.2.6: getTimelineRows() (not a plain `.order` sort) — must match the render loop's row
    // order exactly, empty-zone placeholder rows included, or `rowIndex` here would no longer be
    // the same pixel row clipScreenRect() assumes (see timelineUtils.js's own comment on this).
    const hitIds = [];
    let rowTop = RULER_HEIGHT_PX;
    getTimelineRows(projectState).forEach((row, rowIndex) => {
      if (row.kind !== 'track') { rowTop += 64; return; }
      const track = row.track;
      const top = rowTop; rowTop += trackHeight(track);
      if (track.locked) return;
      for (const clip of track.clips) {
        const clipRect = clipScreenRect(rowIndex, clip, pxPerSecond);
        const clipRectContent = { ...clipRect, left: clipRect.left + TRACK_HEADER_WIDTH_PX, top: top + 16, height: trackHeight(track) - 24 };
        if (containment ? rectContains(rectNow, clipRectContent) : rectsIntersect(rectNow, clipRectContent)) hitIds.push(clip.id);
      }
    });
    setSelection(hitIds);
  }

  // 08-L L4 (specs/ai-creative-operations-platform/08-v2/08-l-4-selection-focus-and-gesture-
  // grammar.md §5): cancels an in-progress marquee with NO selection change committed — restores
  // the EXACT pre-gesture selection (`preSelection`), not just "stop here". Shared by Escape (below)
  // and a window-`blur` listener (audit found marquee had no recovery at all if the window lost
  // focus mid-drag, e.g. Alt+Tab — the drag would stay "active" until the user happened to move the
  // mouse and release it again, possibly selecting something never intended).
  function cancelMarquee() {
    const st = marqueeStateRef.current;
    if (!st) return;
    st.cleanup();
    marqueeStateRef.current = null;
    setMarqueeRect(null);
    setSelection(st.preSelection.ids, st.preSelection.primary);
  }

  function handleMarqueeUp() {
    const st = marqueeStateRef.current;
    if (!st) return; // already cancelled via Escape
    st.cleanup();
    marqueeStateRef.current = null;
    setMarqueeRect(null);
    // §1: "click vùng trống: clear selection, trừ khi đang giữ modifier" — a genuine marquee drag
    // already replaced the selection live in handleMarqueeMove above, nothing more to do here.
    if (!st.moved && !st.modifierHeld) clearSelection();
  }

  function handleBackgroundMouseDown(e) {
    if (e.target.closest('[data-clip]')) return;
    if (e.button !== 0 || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const onMove = (ev) => handleMarqueeMove(ev);
    const onUp = () => handleMarqueeUp();
    // 08-L L4 §5: window losing focus mid-marquee (Alt+Tab etc.) must cancel, not leave the drag
    // "active" forever — see cancelMarquee()'s own comment.
    const onBlur = () => cancelMarquee();
    marqueeStateRef.current = {
      startClientX: e.clientX, startClientY: e.clientY,
      startX: e.clientX - rect.left + scrollRef.current.scrollLeft,
      startY: e.clientY - rect.top + scrollRef.current.scrollTop,
      moved: false,
      modifierHeld: isMod(e) || e.shiftKey,
      preSelection: { ids: selectedIds, primary: primaryId },
      cleanup: () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onBlur);
      },
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
  }

  // --- Playhead ruler / continuous drag-scrub (§4, ref 22) ---
  const scrubClientXRef = useRef(null);
  const scrubRafRef = useRef(null);

  function xToMs(clientX) {
    const rect = scrollRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollRef.current.scrollLeft - TRACK_HEADER_WIDTH_PX;
    return Math.max(0, pxToMs(x));
  }

  // 08.2.2 §2 (Snap): the single place every drag/trim/drop call site goes through — builds
  // priority candidates for `track`, resolves against `stickySnapRef` (kept across calls within
  // the SAME gesture; callers reset it at gesture start), and updates `stickySnapRef` for the next
  // call. `shiftHeld` (the modifier held DURING this specific pointer event, not a toggled
  // setting) disables snapping for this call only — resets the sticky candidate too, so releasing
  // Shift mid-drag doesn't suddenly snap back to a stale candidate from before Shift was pressed.
  function computeSnappedMs(track, rawMs, excludeIds, shiftHeld) {
    if (shiftHeld) {
      stickySnapRef.current = null;
      return { ms: rawMs, candidate: null };
    }
    const thresholdMs = pxToMs(SNAP_PX);
    const marginMs = pxToMs(SNAP_STICKY_MARGIN_PX);
    const candidates = buildSnapCandidates(projectState, track, playheadMs, excludeIds);
    const result = resolveSnap(candidates, rawMs, thresholdMs, stickySnapRef.current, marginMs);
    stickySnapRef.current = result.candidate;
    return result;
  }

  function handleScrubStart(e) {
    e.preventDefault();
    e.stopPropagation(); // don't also trigger handleBackgroundMouseDown's marquee on the same mousedown
    scrubClientXRef.current = e.clientX;
    setPlayheadMs(xToMs(e.clientX));
    const onMove = (ev) => { scrubClientXRef.current = ev.clientX; };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp); // 08-L L4 §5: window blur mid-scrub stops the rAF loop instead of leaking it
      scrubClientXRef.current = null;
      if (scrubRafRef.current) { cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    // rAF loop (not just the mousemove handler above) so auto-scroll keeps advancing the playhead
    // even while the pointer sits still in the edge zone (ref 24) — every tick re-derives time
    // from xToMs against whatever scrollLeft auto-scroll just produced. Only ever calls
    // setPlayheadMs, never execute() — ref 22's "scrub không commit command" holds structurally.
    function tick() {
      if (scrubClientXRef.current == null) return;
      autoScrollForClientX(scrubClientXRef.current);
      setPlayheadMs(xToMs(scrubClientXRef.current));
      scrubRafRef.current = requestAnimationFrame(tick);
    }
    scrubRafRef.current = requestAnimationFrame(tick);
  }

  // 08-UI Priority 0 bước 2: extracted so BOTH the 's' keyboard shortcut below AND the new Timeline
  // toolbar Split button (VideoToolbar.jsx's handleSplit, now deleted — 1 toolbar duy nhất) call
  // the exact same logic instead of duplicating it across 2 files like before.
  const splitTarget = projectState ? findClipAtPlayheadMs(projectState, playheadMs, primaryId) : null;
  function handleSplitAtPlayhead() {
    if (!splitTarget || splitTarget.track.locked) {
      if (splitTarget?.track.locked) setDropError('Clip nằm trên track đang khoá — mở khoá để cắt.');
      return;
    }
    try {
      execute('SplitClip', {
        trackId: splitTarget.track.id, index: splitTarget.index, originalClip: splitTarget.clip,
        splitAtMs: playheadMs, newClipId: crypto.randomUUID(),
      });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // Same extraction for 'k' shortcut / VideoToolbar.jsx's old "Thêm keyframe" button.
  const keyframeTarget = primaryId && projectState ? findClipLocation(projectState, primaryId) : null;
  const canAddKeyframe = !!(keyframeTarget && !keyframeTarget.track.locked && playheadMs >= keyframeTarget.clip.timelineInMs && playheadMs <= keyframeTarget.clip.timelineOutMs);
  function handleAddKeyframeAtPlayhead() {
    if (!canAddKeyframe) return;
    const { track, clip } = keyframeTarget;
    const clipRelativeMs = playheadMs - clip.timelineInMs;
    const effective = evaluateClipTransform(clip, clipRelativeMs);
    // 08-G G4: skip any property that ALREADY has a keyframe at this exact clip-relative instant
    // — before MoveKeyframe (this same pass) let one property's keyframe drift to a different
    // time than its siblings, "add keyframe at playhead" always wrote/removed all
    // TRANSFORM_KEYS together, so this exact collision was structurally impossible. Now it can
    // happen (re-pressing 'k' at an already-keyframed instant, or after a marker was dragged
    // elsewhere and the user keys the remaining properties back at the old time) — without this
    // guard, MoveKeyframe/AddKeyframe's shared assertNoDuplicateKeyframeTime invariant would
    // reject the FIRST already-duplicate property and abort the loop, leaving only some of the
    // gesture's properties keyframed (a partial-apply bug, not just a thrown error).
    const alreadyKeyed = new Set((clip.keyframes || []).filter((kf) => kf.timeMs === clipRelativeMs).map((kf) => kf.propertyPath));
    for (const key of TRANSFORM_KEYS) {
      if (alreadyKeyed.has(`transform.${key}`)) continue;
      execute('AddKeyframe', {
        trackId: track.id, clipId: clip.id,
        keyframe: { id: crypto.randomUUID(), propertyPath: `transform.${key}`, timeMs: clipRelativeMs, value: effective[key], easing: 'linear' },
      });
    }
  }

  // 08-G G4: previous/next keyframe navigation — jumps the playhead to the nearest marker
  // (keyframeMarkersForClip's per-distinct-time grouping, same granularity add/remove already
  // use) before/after the CURRENT playhead position on the primary-selected clip. Reuses
  // `keyframeTarget` (primaryId's clip) rather than a separate lookup, matching
  // handleAddKeyframeAtPlayhead's own target resolution.
  const keyframeMarkers = keyframeTarget ? keyframeMarkersForClip(keyframeTarget.clip) : [];
  const keyframePlayheadRelativeMs = keyframeTarget ? playheadMs - keyframeTarget.clip.timelineInMs : null;
  const prevKeyframeMarker = keyframeTarget
    ? [...keyframeMarkers].reverse().find((m) => m.timeMs < keyframePlayheadRelativeMs - KEYFRAME_TIME_EPSILON_MS)
    : null;
  const nextKeyframeMarker = keyframeTarget
    ? keyframeMarkers.find((m) => m.timeMs > keyframePlayheadRelativeMs + KEYFRAME_TIME_EPSILON_MS)
    : null;
  function handleJumpToKeyframe(marker) {
    if (!keyframeTarget || !marker) return;
    setPlayheadMs(keyframeTarget.clip.timelineInMs + marker.timeMs);
  }

  // Phase 8, moved from VideoToolbar.jsx: speed applies to the whole selected clip (no playhead
  // requirement, unlike keyframing above).
  const speedTarget = primaryId && projectState ? findClipLocation(projectState, primaryId) : null;
  function handleSpeedChange(e) {
    if (!speedTarget || speedTarget.track.locked) return;
    const newSpeed = Number(e.target.value);
    const { track, clip } = speedTarget;
    const newDurationMs = computeSpeedResizedDuration(clip, newSpeed);
    try {
      execute('SetClipSpeed', {
        trackId: track.id, clipId: clip.id,
        from: { speed: clip.speed ?? 1, timelineOutMs: clip.timelineOutMs },
        to: { speed: newSpeed, timelineOutMs: clip.timelineInMs + newDurationMs },
      });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(e) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;

      if (e.key === 'Escape') {
        // 08-L L6: the shortcut-help dialog intercepts Escape FIRST — otherwise this SAME handler's
        // marquee-cancel/clear-selection branch below would also fire underneath it (Escape isn't
        // scoped to the dialog, it's a window-level listener), closing the dialog would feel like it
        // silently cleared the timeline selection too.
        if (showShortcutHelp) { setShowShortcutHelp(false); return; }
        if (marqueeStateRef.current) {
          cancelMarquee();
        } else if (!livePreviewPatchRef.current) {
          clearSelection();
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutHelp((v) => !v);
        return;
      }

      if (!projectState) return;

      if (isMod(e) && e.key.toLowerCase() === 'a' && scrollRef.current?.closest('[aria-label="Timeline"]')?.contains(e.target)) {
        e.preventDefault();
        const ids = projectState.tracks.flatMap(t => t.clips.map(c => c.id));
        setSelection(ids, ids.at(-1) || null);
        return;
      }

      if (isMod(e) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (isMod(e) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (isMod(e) && e.key.toLowerCase() === 'd') {
        if (!primaryId) return;
        const found = findClipLocation(projectState, primaryId);
        if (!found) return;
        e.preventDefault();
        handleDuplicateClip(found.track, found.clip);
        return;
      }

      // 08-F F4: Mod+Shift+G checked BEFORE plain Mod+G (both match `key.toLowerCase() === 'g'`,
      // Shift only distinguishes ungroup from group).
      if (isMod(e) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleUngroupSelection(); else handleGroupSelection();
        return;
      }

      // 08.2.2 §5: plain Delete/Backspace keeps the gap (DeleteClip/DeleteClips), Shift+Delete/
      // Backspace closes it (RippleDelete/RippleDeleteClips) — the NLE convention (shortcuts.js's
      // own header comment explains the pre-08.2.2 behavior this replaces). Operates on the WHOLE
      // selection (handleDeleteSelection), not just primaryId.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        handleDeleteSelection(e.shiftKey);
        return;
      }

      if (e.key.toLowerCase() === 's') {
        if (!splitTarget) return;
        e.preventDefault();
        handleSplitAtPlayhead();
        return;
      }

      // Add keyframe at playhead (Phase 7) — now shares handleAddKeyframeAtPlayhead with the
      // Timeline toolbar's own "Thêm keyframe" button (VideoToolbar.jsx deleted, 1 toolbar duy nhất
      // — 08-UI Priority 0 bước 2).
      if (e.key.toLowerCase() === 'k') {
        if (!keyframeTarget || playheadMs < keyframeTarget.clip.timelineInMs || playheadMs > keyframeTarget.clip.timelineOutMs) return;
        if (keyframeTarget.track.locked) { setDropError('Clip nằm trên track đang khoá — mở khoá để thêm keyframe.'); return; }
        e.preventDefault();
        handleAddKeyframeAtPlayhead();
        return;
      }
      // 08-G G4: Alt+Left/Right jumps to the prev/next keyframe marker — checked BEFORE the plain
      // frame-step branch below (both match e.key === 'ArrowLeft'/'ArrowRight', e.altKey is what
      // distinguishes them), same "specific modifier combo checked before the plain key" order
      // Mod+Shift+G/Mod+G already uses above.
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const marker = e.key === 'ArrowLeft' ? prevKeyframeMarker : nextKeyframeMarker;
        if (!marker) return;
        e.preventDefault();
        handleJumpToKeyframe(marker);
        return;
      }
      // Frame-step: nudges the playhead by 1 project-frame. Player.jsx's own playheadMs-sync effect
      // then seeks/redraws to match (canvas engine redraw, or <video> seek on the no-VideoDecoder
      // fallback) — using requestVideoFrameCallback directly here would only step the CURRENTLY
      // loaded proxy, not the timeline playhead that decides which clip/asset is even loaded, so
      // timeline-ms arithmetic is the simpler correct primitive for this MVP.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const fps = projectState.fps || 30;
        const deltaMs = 1000 / fps;
        setPlayheadMs(playheadMs + (e.key === 'ArrowRight' ? deltaMs : -deltaMs));
        return;
      }
      // 08-L L3 §2 finding #3 (now patched): Space is the near-universal NLE play/pause convention
      // (CapCut included) — TransportBar.jsx's toggle button was the only entry point before this.
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectState, playheadMs, primaryId, selectedIds, execute, undo, redo, setPlayheadMs, setSelection, clearSelection, showShortcutHelp, togglePlay, insertionTrackId]);

  if (!projectState) return null;

  const maxClipEndMs = projectState.tracks.reduce((max, track) => {
    const trackMax = track.clips.reduce((m, c) => Math.max(m, c.timelineOutMs), 0);
    return Math.max(max, trackMax);
  }, 0);
  const totalWidthPx = TRACK_HEADER_WIDTH_PX + Math.max(msToPx((MIN_TRACK_AREA_SECONDS) * 1000), msToPx(maxClipEndMs) + 200);

  // Visible time range + a fixed px buffer either side, so a clip doesn't visibly pop in/out right
  // at the viewport edge during a fast scroll.
  const CULL_BUFFER_PX = 400;
  const visibleStartMs = pxToMs(Math.max(0, viewport.scrollLeft - TRACK_HEADER_WIDTH_PX - CULL_BUFFER_PX));
  const visibleEndMs = pxToMs(viewport.scrollLeft + viewport.width - TRACK_HEADER_WIDTH_PX + CULL_BUFFER_PX);
  const rulerStepMs = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000].find((ms) => msToPx(ms) >= 70) || 60000;
  const rulerTicks = [];
  for (let ms = Math.max(0, Math.floor(visibleStartMs / rulerStepMs) * rulerStepMs); ms <= visibleEndMs; ms += rulerStepMs) rulerTicks.push(ms);
  function isClipVisible(clip) {
    return clip.timelineOutMs >= visibleStartMs && clip.timelineInMs <= visibleEndMs;
  }

  // 08.2.2 §2: live snap guide during a native-HTML5 drag. Clip-drags (move/duplicate) use
  // computeSnappedMs's sticky/anti-flicker tracking (reset cleanly at handleClipDragStart, its own
  // gesture-start hook); an asset drag from MediaBin has no such hook available in this component
  // (its dragstart lives in MediaBin.jsx), so it's computed fresh on every dragover instead —
  // acceptable since a fresh-asset drop is a coarser, less frequent placement than fine-tuning an
  // existing clip's position.
  function handleDragOverTrack(track, e) {
    if (!isInternalMediaDrag(e.dataTransfer) && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setInsertionTrackId(track.id); return; }
    const isClipDrag = e.dataTransfer.types.includes('application/x-video-clip');
    const isAssetDrag = e.dataTransfer.types.includes('application/x-video-asset');
    const isTimelineDrag = e.dataTransfer.types.includes('application/x-video-timeline');
    if (!isClipDrag && !isAssetDrag && !isTimelineDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isClipDrag ? 'move' : 'copy';
    setDragOverTrackId(track.id);
    autoScrollForClientX(e.clientX); // ref 24 — xToMs below always re-reads the live scrollLeft on drop
    const rawMs = xToMs(e.clientX);
    if (isClipDrag) {
      const excludeIds = dragGestureRef.current?.excludeIds || [];
      setSnapGuide(dragPlacement(track, e).candidate);
    } else {
      const candidates = e.shiftKey ? [] : buildSnapCandidates(projectState, track, playheadMs, []);
      setSnapGuide(resolveSnap(candidates, rawMs, pxToMs(SNAP_PX), null).candidate);
    }
  }

  function dragPlacement(track, e) {
    const gesture = dragGestureRef.current;
    if (!gesture) return computeSnappedMs(track, xToMs(e.clientX), [], e.shiftKey);
    const raw = Math.max(-gesture.headOffset, xToMs(e.clientX) - gesture.pointerOffset);
    const candidates = e.shiftKey ? [] : buildSnapCandidates(projectState, track, playheadMs, gesture.excludeIds);
    const options = [gesture.headOffset, gesture.tailOffset].map(offset => {
      const result = resolveSnap(candidates, raw + offset, pxToMs(SNAP_PX), null);
      return { ms: result.ms - offset, candidate: result.candidate, distance: Math.abs(result.ms - raw - offset) };
    }).filter(result => result.candidate && result.ms + gesture.headOffset >= 0);
    return options.sort((a, b) => a.distance - b.distance)[0] || { ms: raw, candidate: null };
  }

  function handlePasteClips(aboveTrackId, clipboard = useVideoStore.getState().timelineClipboard) {
    try {
      const args = buildPaste(projectState, clipboard, playheadMs, aboveTrackId);
      if (!args) return;
      execute('BulkInsertClips', args);
      const ids = args.insertions.map(i => i.clip.id); setSelection(ids, ids.at(-1));
    } catch (err) { setDropError(err.message); }
  }

  function handleCopyClips(e, cut = false) {
    if (e.target.matches('input,textarea') || e.target.isContentEditable || !selectedIds.length) return;
    e.preventDefault();
    const clipboard = captureClips(projectState, selectedIds);
    useVideoStore.setState({ timelineClipboard: clipboard });
    e.clipboardData.setData('application/x-space-flow-clips', JSON.stringify(clipboard));
    e.clipboardData.setData('text/plain', `SpaceFlow clips:${JSON.stringify(clipboard)}`);
    if (cut) handleDeleteSelection(false);
  }

  // Phase 14 (§0), extended 08.2.6 §1: any image asset has no `durationMs` (deliberately never
  // probed — backend/routes/video-assets.js's own comment: "source file itself is already
  // directly displayable"), whether it lands on a 'sticker' track OR (08.2.6) a 'video'/'image'
  // track now that those accept image assets too — so it gets an arbitrary default length instead,
  // same idea as DEFAULT_CAPTION_DURATION_MS below — trimmable afterward like any other clip (no
  // invariant ties a clip's sourceOutMs to its asset's real duration, see
  // shared/video-commands/invariants.js).
  const DEFAULT_IMAGE_DURATION_MS = 3000;
  // A sticker defaults to 30% of the canvas, not full-screen (video/audio's own transform default,
  // also what an image asset gets on a video/image track — see `transform:` below) — a freshly-
  // dropped logo/watermark covering the whole frame is never what's wanted; the Player.jsx
  // TransformOverlay (Phase 14) lets the user drag/resize it from there.
  const DEFAULT_STICKER_TRANSFORM = { x: 0, y: 0, scaleX: 0.3, scaleY: 0.3, rotation: 0, opacity: 1 };

  function handleDropAsset(track, e, newTrack = false) {
    const assetId = e.dataTransfer.getData('application/x-video-asset');
    if (!assetId) return;
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    if (asset.status !== 'ok') { setDropError('Asset chưa sẵn sàng — kiểm tra media trước khi thêm.'); return; }
    const isSticker = asset.kind === 'image' && track.type === 'sticker';
    const isImageAsset = asset.kind === 'image';
    // 08.2.6 §2: video/image assets and tracks are interchangeable within the visual zone —
    // tracksAreZoneCompatible() (not a raw `!==`) so a video asset can land on an `image` track
    // and vice versa. Audio/sticker/caption stay exact-type-only, unchanged.
    if (!isSticker && !tracksAreZoneCompatible(asset.kind, track.type)) {
      setDropError(`Không thể thả asset "${asset.kind}" vào track "${track.type}"`);
      return;
    }
    if (!isImageAsset && !asset.durationMs) {
      setDropError('Asset chưa có thời lượng (đang xử lý hoặc lỗi) — chưa thể thêm vào timeline.');
      return;
    }

    const durationMs = isImageAsset ? DEFAULT_IMAGE_DURATION_MS : asset.durationMs;
    const rawStartMs = xToMs(e.clientX);
    const candidates = e.shiftKey ? [] : buildSnapCandidates(projectState, track, playheadMs, []);
    const { ms: startMs } = resolveSnap(candidates, rawStartMs, pxToMs(SNAP_PX), null);
    const endMs = startMs + durationMs;

    if (clipsOverlap(track, startMs, endMs)) {
      setDropError('Vị trí này chồng lấn clip khác trên cùng track — kéo sang vị trí trống.');
      return;
    }

    const index = computeInsertIndex(track, null, startMs);
    const clip = {
      id: crypto.randomUUID(), assetId: asset.id, sourceInMs: 0, sourceOutMs: durationMs,
      timelineInMs: startMs, timelineOutMs: endMs, speed: 1,
      transform: isSticker ? { ...DEFAULT_STICKER_TRANSFORM } : { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      effects: [], keyframes: [],
    };
    try {
      if (newTrack) execute('BulkInsertClips', { newTracks: [track], insertions: [{ trackId: track.id, clip }] });
      else execute('InsertClip', { trackId: track.id, index, clip });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // 08.2.2 §1: the multi-select move branch — resolves every selected clip's target track/time via
  // buildMultiMoveTargets (keeps relative time+track offset), proactively rejects the WHOLE batch
  // on any lock/overlap/out-of-bounds track (multiMoveOverlaps), same "check before execute, atomic
  // rollback via not-executing-at-all" pattern the single-move path already uses.
  function handleDropMultiMove(track, payload, e) {
    if (payload.duplicate) { handlePasteClips(track.id, captureClips(projectState, payload.clipIds)); return; }
    const { clipIds, primaryClipId } = payload;
    const primaryLoc = findClipLocation(projectState, primaryClipId);
    if (!primaryLoc) return;
    for (const id of clipIds) {
      const loc = findClipLocation(projectState, id);
      if (loc?.track.locked) { setDropError('Một clip trong lựa chọn nằm trên track đang khoá — mở khoá để di chuyển.'); return; }
    }

    const { ms: startMs } = dragPlacement(track, e);

    const result = buildMultiMoveTargets(projectState, clipIds, primaryClipId, track.id, startMs);
    if (!result) {
      setDropError('Không thể di chuyển cả lựa chọn tới vị trí này — thiếu track tương ứng cho 1 clip.');
      return;
    }
    if (multiMoveOverlaps(projectState, result.moves)) {
      setDropError('Vị trí này chồng lấn clip khác — kéo sang vị trí trống.');
      return;
    }
    try {
      execute('MoveClips', result);
    } catch (err) {
      setDropError(err.message);
    }
  }

  // handleDropClip: moving a clip ALREADY on the timeline (Phase 6 — see handleClipDragStart).
  // `to.index`/`from.index` follow the FINAL-post-removal-index contract MoveClip.js's header
  // documents; computeInsertIndex(..., clipId, ...) is what gets that right for a same-track move.
  function handleDropClip(track, e) {
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('application/x-video-clip'));
    } catch {
      return;
    }
    if (payload.clipIds) {
      handleDropMultiMove(track, payload, e);
      return;
    }
    const { clipId, fromTrackId, duplicate } = payload;
    const fromTrack = projectState.tracks.find((t) => t.id === fromTrackId);
    const fromIndex = fromTrack ? fromTrack.clips.findIndex((c) => c.id === clipId) : -1;
    if (!fromTrack || fromIndex === -1) return;
    // 08.2.2 §6: a duplicate-drag only READS the source clip (the original stays put and
    // unmodified), so a locked SOURCE track doesn't block it — unlike a real move, which does.
    if (!duplicate && fromTrack.locked) { setDropError('Track nguồn đang khoá — mở khoá để di chuyển clip.'); return; }
    const clip = fromTrack.clips[fromIndex];
    // Phase 13: was `asset.kind !== track.type` — silently skipped this check entirely for a
    // caption clip (no assetId, so `asset` was always undefined, and `asset && ...` short-
    // circuited). Checking the SOURCE track's own type instead is both simpler (1 lookup, not an
    // assets-array search) and correct for every clip kind uniformly, captions included.
    // 08.2.6 §2: zone-based, not exact-type — a clip can move between any 2 visual-zone tracks
    // (video<->image), same relaxation as handleDropAsset's asset-drop check above.
    if (!tracksAreZoneCompatible(fromTrack.type, track.type)) {
      setDropError(`Không thể chuyển clip từ track "${fromTrack.type}" sang track "${track.type}"`);
      return;
    }

    const durationMs = clip.timelineOutMs - clip.timelineInMs;
    // Duplicate excludes nothing (the original stays — a valid snap target for its own copy);
    // move excludes the clip's own edges (it's leaving that spot).
    const { ms: startMs } = dragPlacement(track, e);
    const endMs = startMs + durationMs;

    if (duplicate) {
      // Unlike a move, the original clip stays exactly where it is — it's a normal occupant of
      // the drop target too (no excludeClipId), so dropping the duplicate back onto the original
      // is correctly rejected as an overlap, same as dropping onto any other clip would be.
      if (clipsOverlap(track, startMs, endMs)) {
        setDropError('Vị trí này chồng lấn clip khác trên cùng track — kéo sang vị trí trống.');
        return;
      }
      const newClip = buildDuplicateClip(clip);
      newClip.timelineInMs = startMs;
      newClip.timelineOutMs = endMs;
      const index = computeInsertIndex(track, null, startMs);
      try {
        execute('InsertClip', { trackId: track.id, index, clip: newClip });
        selectClip(newClip.id);
      } catch (err) {
        setDropError(err.message);
      }
      return;
    }

    if (clipsOverlap(track, startMs, endMs, clipId)) {
      setDropError('Vị trí này chồng lấn clip khác trên cùng track — kéo sang vị trí trống.');
      return;
    }

    const toIndex = computeInsertIndex(track, clipId, startMs);
    try {
      execute('MoveClip', {
        clipId,
        from: { trackId: fromTrackId, index: fromIndex, timelineInMs: clip.timelineInMs },
        to: { trackId: track.id, index: toIndex, timelineInMs: startMs },
      });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // 08.2.2 §5: Delete/Shift+Delete on the whole current selection, not just primaryId — a single
  // selected clip takes the exact same single-clip path this already had (DeleteClip/RippleDelete,
  // unchanged); 2+ takes the batched DeleteClips/RippleDeleteClips path. mergeRippleIntervals
  // (timelineUtils.js) groups touching selected clips into one interval per track so ripple-delete
  // never double-shifts. A locked track anywhere in the selection blocks the WHOLE operation
  // (nothing partially deletes), same "check before execute" pattern used elsewhere in this file.
  function handleDeleteSelection(shiftKey) {
    // Keeps the exact pre-08.2.2 message for the single-clip case (existing tests assert this
    // text) — only the genuinely-multi-select case gets the new plural wording.
    const lockedMsg = selectedIds.length > 1
      ? 'Một clip trong lựa chọn nằm trên track đang khoá — mở khoá để xoá.'
      : 'Clip nằm trên track đang khoá — mở khoá để xoá.';
    for (const id of selectedIds) {
      const loc = findClipLocation(projectState, id);
      if (loc?.track.locked) {
        setDropError(lockedMsg);
        return;
      }
    }
    try {
      if (selectedIds.length === 1 && (shiftKey || !(projectState.transitions || []).some(t => selectedIds.includes(t.fromClipId) || selectedIds.includes(t.toClipId)))) {
        const found = findClipLocation(projectState, selectedIds[0]);
        if (!found) return;
        execute(shiftKey ? 'RippleDelete' : 'DeleteClip', { trackId: found.track.id, index: found.index, clip: found.clip });
      } else if (shiftKey) {
        execute('RippleDeleteClips', { perTrack: mergeRippleIntervals(projectState, selectedIds) });
      } else {
        const deletions = selectedIds.map((id) => {
          const loc = findClipLocation(projectState, id);
          return { trackId: loc.track.id, index: loc.index, clip: loc.clip };
        });
        execute('DeleteClips', { deletions, transitions: (projectState.transitions || []).filter(t => selectedIds.includes(t.fromClipId) || selectedIds.includes(t.toClipId)) });
      }
      clearSelection();
    } catch (err) {
      setDropError(err.message);
    }
  }

  function handleDropTrack(track, e) {
    e.preventDefault();
    if (!isInternalMediaDrag(e.dataTransfer) && e.dataTransfer.files.length) {
      e.stopPropagation(); importExternalFiles([...e.dataTransfer.files], { atMs: playheadMs, aboveTrackId: track.id }); return;
    }
    setDragOverTrackId(null);
    setSnapGuide(null); // gesture over — same "clear on drop" the trim preview already does
    if (e.dataTransfer.types.includes('application/x-video-clip')) {
      const gesture = dragGestureRef.current;
      const ids = gesture?.clipIds || [];
      const sources = projectState.tracks.filter(t => t.clips.some(c => ids.includes(c.id)));
      const wholeTracks = sources.length && sources.every(t => t.clips.every(c => ids.includes(c.id)));
      const atTopEdge = e.clientY - e.currentTarget.getBoundingClientRect().top < 14;
      if (gesture?.duplicate && (wholeTracks || atTopEdge || sources.some(t => t.type !== track.type))) {
        handlePasteClips(track.id, captureClips(projectState, ids)); return;
      }
      if (wholeTracks && !gesture.duplicate && !sources.some(t => t.id === track.id)) {
        try {
          const changes = trackReorderChanges(projectState, sources, track.id);
          if (changes.length) execute('SetProperties', { changes });
        } catch (err) { setDropError(err.message); }
        return;
      }
    }
    if (track.locked) { setDropError('Track đang khoá — mở khoá để chỉnh sửa.'); return; }
    if (e.dataTransfer.types.includes('application/x-video-timeline')) {
      if (track.type !== 'video') { setDropError('Thả timeline lồng vào track video.'); return; }
      try {
        const source = JSON.parse(e.dataTransfer.getData('application/x-video-timeline'));
        if (typeof source.projectId !== 'string' || typeof source.name !== 'string') throw new Error('Timeline kéo thả không hợp lệ.');
        const candidates = e.shiftKey ? [] : buildSnapCandidates(projectState, track, playheadMs, []);
        const timelineInMs = Math.max(0, resolveSnap(candidates, xToMs(e.clientX), pxToMs(SNAP_PX), null).ms);
        embedTimelineAsCompoundClip({ timelineProjectId: source.projectId, timelineProjectName: source.name, trackId: track.id, timelineInMs })
          .catch(err => setDropError(err.message));
      } catch (err) { setDropError(err.message); }
    } else if (e.dataTransfer.types.includes('application/x-video-clip')) handleDropClip(track, e);
    else handleDropAsset(track, e);
  }

  // 08.2.2 §6: Alt held at drag-start marks this as a duplicate-drag rather than a move — read
  // once here (not per dragover) since it decides the whole gesture's TYPE, unlike Shift's
  // per-frame snap-toggle in handleTrimStart. handleDropClip below reads `payload.duplicate` and
  // branches to InsertClip instead of MoveClip; no ghost/temp clip exists in the store while
  // dragging (the browser draws its own native DnD ghost image).
  // 08.2.2 §1: dragging a clip that's part of a multi-selection (2+) moves the WHOLE selection
  // together — payload carries `clipIds` instead of a lone `clipId`, resolved by
  // buildMultiMoveTargets in handleDropClip below. Alt copies the entire selection onto new tracks
  // at the playhead, preserving relative timing and source track order.
  //
  // 08-F F4 (groups): a group's members move together the SAME way a multi-selection does — but
  // `selectedIds` can't be trusted here for a group that was just click-selected in THIS same
  // gesture (mousedown already ran and called setSelection(), but that's a Zustand store write —
  // this component's own `selectedIds` closure is still the PRE-click render's value until the next
  // re-render, same staleness class documented in docs/issues/2026-08-30-multiselect-drag-collapses-
  // selection-on-mousedown.md). Deriving the group directly from `clip.groupId` + the CURRENT
  // `projectState` sidesteps that entirely — project content, unlike selection, was never touched
  // by the click.
  function handleClipDragStart(track, clip, e) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    const isMultiMove = selectedIds.length > 1 && selectedIds.includes(clip.id);
    const groupIds = !e.altKey && !isMultiMove && clip.groupId
      ? clipsInGroup(projectState, clip.groupId).map((c) => c.id)
      : null;
    const isGroupMove = !!groupIds && groupIds.length > 1;
    const moveIds = isMultiMove ? selectedIds : (isGroupMove ? groupIds : null);
    const payload = moveIds
      ? { clipIds: moveIds, primaryClipId: clip.id, duplicate: e.altKey }
      : { clipId: clip.id, fromTrackId: track.id, duplicate: e.altKey };
    e.dataTransfer.setData('application/x-video-clip', JSON.stringify(payload));
    // 08.2.2 §2: gesture-start reset — a fresh drag never inherits the previous gesture's sticky
    // snap candidate. excludeIds mirrors handleDropClip/handleDropMultiMove's own choice: a move
    // excludes the moving clip(s)' own edges, a duplicate excludes nothing (the original is a
    // valid snap target for its own copy).
    stickySnapRef.current = null;
    const clipIds = moveIds || [clip.id];
    const moving = clipIds.map(id => findClipLocation(projectState, id)?.clip).filter(Boolean);
    dragGestureRef.current = { clipIds, duplicate: e.altKey, excludeIds: e.altKey ? [] : clipIds,
      pointerOffset: xToMs(e.clientX) - clip.timelineInMs,
      headOffset: Math.min(...moving.map(c => c.timelineInMs)) - clip.timelineInMs,
      tailOffset: Math.max(...moving.map(c => c.timelineOutMs)) - clip.timelineInMs };
  }

  function handleClipDragEnd() {
    dragGestureRef.current = null;
    stickySnapRef.current = null;
    setSnapGuide(null);
  }

  // 08-L L3 (specs/.../08-l-3-canonical-action-registry.md §2 finding #2, now patched — see
  // `08-l-3`'s own file for the "Cố ý CHƯA làm" note this closes): duplicateTarget mirrors
  // keyframeTarget/speedTarget's own pattern (resolve the primary-selected clip fresh every render)
  // so the new toolbar button and context-menu item below share the exact same enable/disable logic
  // the Mod+D shortcut already used inline.
  const duplicateTarget = primaryId && projectState ? findClipLocation(projectState, primaryId) : null;

  // 08.2.2 §6 (Duplicate): shared by the Mod+D shortcut, the toolbar button and the clip context
  // menu (both added by 08-L L3's gap-patch above) — default placement is the next free slot on the
  // SAME track starting right after the original (findNextFreeSlot jumps past whatever's in the way
  // instead of failing).
  function handleDuplicateClip(track, clip) {
    if (track.locked) { setDropError('Track đang khoá — mở khoá để nhân bản clip.'); return; }
    const durationMs = clip.timelineOutMs - clip.timelineInMs;
    const startMs = findNextFreeSlot(track, clip.timelineOutMs, durationMs, clip.id);
    const newClip = buildDuplicateClip(clip);
    newClip.timelineInMs = startMs;
    newClip.timelineOutMs = startMs + durationMs;
    const index = computeInsertIndex(track, null, startMs);
    try {
      execute('InsertClip', { trackId: track.id, index, clip: newClip });
      selectClip(newClip.id);
    } catch (err) {
      setDropError(err.message);
    }
  }

  // 08-F F4 (Group giữ relative offsets): tags every selected clip with a fresh `groupId` via the
  // existing generic SetProperties (1 atomic command, N field changes) — no new command type,
  // same precedent SetProperties itself was added under. `clip.groupId` is purely additive (absent
  // = ungrouped, the state every pre-existing clip already has) — resolveSelectionOnClick
  // (timelineUtils.js) is what makes a click on any member re-select the whole group, and
  // handleClipDragStart is what makes dragging any member move the whole group together.
  function handleGroupSelection() {
    if (selectedIds.length < 2) return;
    const groupId = crypto.randomUUID();
    const changes = [];
    for (const id of selectedIds) {
      const loc = findClipLocation(projectState, id);
      if (!loc) continue;
      if (loc.track.locked) { setDropError('Một clip trong lựa chọn nằm trên track đang khoá — mở khoá để nhóm.'); return; }
      const trackIndex = projectState.tracks.findIndex((t) => t.id === loc.track.id);
      // `from` must match exactly what SetProperties' getAtPath()/Object.is stale-check will read
      // — a clip that was never grouped has NO `groupId` key at all (`undefined`, not `null`); `??
      // null` here would make every FIRST-time group silently fail the stale-check and get
      // swallowed by the catch below with no visible crash, only a `dropError` banner this test
      // wouldn't see unless it looked for it (real bug, caught writing the e2e test, not assumed).
      changes.push({ path: ['tracks', trackIndex, 'clips', loc.index, 'groupId'], from: loc.clip.groupId, to: groupId });
    }
    if (changes.length < 2) return;
    try {
      execute('SetProperties', { changes });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // handleUngroupSelection() — dissolves the WHOLE group any selected clip belongs to, not just the
  // selected subset (standard NLE convention: selecting 1 member and choosing Ungroup releases
  // every member).
  function handleUngroupSelection() {
    const groupIds = new Set();
    for (const id of selectedIds) {
      const loc = findClipLocation(projectState, id);
      if (loc?.clip.groupId) groupIds.add(loc.clip.groupId);
    }
    if (groupIds.size === 0) return;
    const changes = [];
    for (let trackIndex = 0; trackIndex < projectState.tracks.length; trackIndex++) {
      const track = projectState.tracks[trackIndex];
      for (let index = 0; index < track.clips.length; index++) {
        const clip = track.clips[index];
        if (!clip.groupId || !groupIds.has(clip.groupId)) continue;
        // A real `return` (not a forEach-callback one) — must abort the WHOLE ungroup, not just
        // skip this one clip, so a locked track anywhere in the group blocks it entirely.
        if (track.locked) { setDropError('Một clip trong nhóm nằm trên track đang khoá — mở khoá để bỏ nhóm.'); return; }
        changes.push({ path: ['tracks', trackIndex, 'clips', index, 'groupId'], from: clip.groupId, to: null });
      }
    }
    if (changes.length === 0) return;
    try {
      execute('SetProperties', { changes });
    } catch (err) {
      setDropError(err.message);
    }
  }

  const canGroup = projectState && selectedIds.length >= 2;
  const canUngroup = projectState && selectedIds.some((id) => findClipLocation(projectState, id)?.clip.groupId);

  // handleOpenNestedTimeline/handleUnpackCompoundClip — 08-F F5 / ADR 0034 (docs/decisions/0034-
  // compound-clip-minimal-slice.md): the only 2 clip-level actions specific to a compound clip
  // (`clip.compoundRef` present). The store validates trim/retime and compositing
  // compatibility against the exact pinned nested revision before any mutation.
  function handleOpenNestedTimeline(clip) {
    openNestedTimeline(clip.compoundRef.timelineProjectId, clip.compoundRef.timelineProjectName || 'Timeline lồng');
  }

  function canUnpackClip(clip) {
    return !!clip.compoundRef && (clip.speed ?? 1) !== 0;
  }

  function handleUnpackCompoundClip(track, clip) {
    if (track.locked) { setDropError('Track đang khoá — mở khoá để bung timeline lồng.'); return; }
    unpackCompoundClip(track.id, clip.id).catch((err) => setDropError(err.message));
  }

  // 08.2.2 §3 (Trim): mousedown-driven drag on a clip's left/right edge handle, NOT native HTML5
  // DnD (that only reports position on dragover, too coarse for a smooth trim preview) — same
  // window-listener lifecycle as handleScrubStart/handleBackgroundMouseDown above. Clamp order:
  // snap the raw pointer position to a nearby candidate first, THEN clamp to the neighbor clip's
  // boundary, the 1-frame minimum (assertMinClipDuration, invariants.js) and the asset's real
  // source duration (when known) — hard constraints always win over a snap suggestion since they
  // run last. sourceIn/OutMs shift with `speed` using the exact same `elapsedMs * (speed ?? 1)`
  // convention SplitClip.js uses (freeze-frame speed:0 correctly leaves the source untouched).
  //
  // Deliberately does NOT stopPropagation on mousedown: the handle sits inside the clip's own div,
  // so a plain click on it must still bubble up to handleClipMouseDown and select the clip exactly
  // like clicking anywhere else on it (a real regression caught by the existing e2e suite — every
  // test clicking near a clip's edge lost selection entirely until this was fixed). A trim only
  // actually starts once the pointer moves past MARQUEE_THRESHOLD_PX, the same click-vs-drag
  // threshold handleMarqueeMove already uses.
  function handleTrimStart(track, clip, edge, e) {
    e.preventDefault();
    if (track.locked) { setDropError('Track đang khoá — mở khoá để trim.'); return; }
    stickySnapRef.current = null; // 08.2.2 §2: fresh gesture, no leftover sticky candidate

    const startClientX = e.clientX;
    const asset = assets.find((a) => a.id === clip.assetId);
    const sorted = [...track.clips].sort((a, b) => a.timelineInMs - b.timelineInMs);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    const prevClip = idx > 0 ? sorted[idx - 1] : null;
    const nextClip = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const fps = projectState.fps || 30;
    const minDurationMs = 1000 / fps;
    const speed = clip.speed ?? 1;
    const original = {
      sourceInMs: clip.sourceInMs, sourceOutMs: clip.sourceOutMs,
      timelineInMs: clip.timelineInMs, timelineOutMs: clip.timelineOutMs,
    };
    let latestBounds = original;

    function computeBounds(clientX, shiftHeld) {
      const deltaMs = pxToMs(clientX - startClientX);
      if (edge === 'left') {
        const { ms: snappedMs, candidate } = computeSnappedMs(track, original.timelineInMs + deltaMs, [clip.id], shiftHeld);
        const lowerBoundMs = prevClip ? prevClip.timelineOutMs : 0;
        let timelineInMs = Math.max(lowerBoundMs, Math.min(snappedMs, original.timelineOutMs - minDurationMs));
        let sourceInMs = original.sourceInMs + (timelineInMs - original.timelineInMs) * speed;
        if (sourceInMs < 0 && speed !== 0) {
          timelineInMs = Math.max(lowerBoundMs, Math.min(original.timelineInMs - original.sourceInMs / speed, original.timelineOutMs - minDurationMs));
          sourceInMs = original.sourceInMs + (timelineInMs - original.timelineInMs) * speed;
        }
        // Only show the guide if the snap candidate actually survived the hard clamps above —
        // otherwise the boundary/min-duration/source-bounds constraint won, not the snap.
        const guide = candidate && timelineInMs === candidate.ms ? candidate : null;
        return { bounds: { sourceInMs, sourceOutMs: original.sourceOutMs, timelineInMs, timelineOutMs: original.timelineOutMs }, guide };
      }
      const { ms: snappedMs, candidate } = computeSnappedMs(track, original.timelineOutMs + deltaMs, [clip.id], shiftHeld);
      const upperBoundMs = nextClip ? nextClip.timelineInMs : Infinity;
      let timelineOutMs = Math.min(upperBoundMs, Math.max(snappedMs, original.timelineInMs + minDurationMs));
      let sourceOutMs = original.sourceOutMs + (timelineOutMs - original.timelineOutMs) * speed;
      if (asset?.durationMs != null && sourceOutMs > asset.durationMs && speed !== 0) {
        timelineOutMs = Math.min(upperBoundMs, Math.max(original.timelineOutMs + (asset.durationMs - original.sourceOutMs) / speed, original.timelineInMs + minDurationMs));
        sourceOutMs = original.sourceOutMs + (timelineOutMs - original.timelineOutMs) * speed;
      }
      const guide = candidate && timelineOutMs === candidate.ms ? candidate : null;
      return { bounds: { sourceInMs: original.sourceInMs, sourceOutMs, timelineInMs: original.timelineInMs, timelineOutMs }, guide };
    }

    let dragStarted = false;
    function onMove(ev) {
      if (!dragStarted) {
        if (Math.abs(ev.clientX - startClientX) < MARQUEE_THRESHOLD_PX) return;
        dragStarted = true;
      }
      const { bounds, guide } = computeBounds(ev.clientX, ev.shiftKey);
      latestBounds = bounds;
      setTrimPreview({ clipId: clip.id, edge, ...latestBounds });
      setSnapGuide(guide);
    }
    function removeTrimListeners() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onCancel);
    }
    function onUp() {
      removeTrimListeners();
      setTrimPreview(null);
      setSnapGuide(null);
      if (!dragStarted) return; // plain click — selection already handled by the bubbled clip mousedown
      const changed = Object.keys(original).some((key) => original[key] !== latestBounds[key]);
      if (!changed) return;
      try {
        execute('TrimClip', { trackId: track.id, clipId: clip.id, from: original, to: latestBounds });
      } catch (err) {
        setDropError(err.message);
      }
    }
    // 08-L L4 (specs/ai-creative-operations-platform/08-v2/08-l-4-selection-focus-and-gesture-
    // grammar.md §4-§5): audit found trim was the ONE gesture with no Escape-cancel at all (marquee
    // and TransformOverlay already had it) and, like every gesture, no recovery if the window lost
    // focus mid-drag. `onCancel` drops the gesture with NO commit — distinct from `onUp`, which
    // always commits whatever bounds the drag reached.
    function onCancel() {
      removeTrimListeners();
      setTrimPreview(null);
      setSnapGuide(null);
    }
    function onKeyDown(ev) {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onCancel);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // 08.2.1 §1: plain click replaces selection; Mod+click toggles; Shift+click selects the
  // chronological run between the current primary and this clip on the SAME track (falls back to
  // plain single-select if there's no valid same-track anchor — the spec doesn't define that case).
  // 08.2.2 §1: a plain mousedown (no modifier) on a clip that's ALREADY part of a multi-selection
  // must NOT immediately collapse the selection to just that clip — the same mousedown may be the
  // start of a multi-select DRAG, and handleClipDragStart (native HTML5 dragstart, fired from this
  // same gesture) needs to see the FULL selection still intact to know it's a multi-move at all.
  // Deferred to handleClipClick below: the browser only fires a 'click' event when the gesture
  // did NOT turn into a real drag, which is exactly the "genuine click, not a drag" signal needed
  // to finally collapse the selection.
  function handleClipMouseDown(track, clip, e) {
    e.stopPropagation();
    setInsertionTrackId(track.id);
    const action = resolveSelectionOnClick(projectState, track, clip, primaryId, { mod: isMod(e), shift: e.shiftKey });
    if (action.type === 'toggle') { toggleClipSelection(action.clipId); return; }
    if (!isMod(e) && !e.shiftKey && selectedIds.length > 1 && selectedIds.includes(clip.id)) return;
    setSelection(action.ids, action.primaryId);
  }

  // 08-F F4: was a hardcoded `setSelection([clip.id], clip.id)` — bypassed resolveSelectionOnClick
  // entirely, so a genuine click that collapses an EXISTING multi-selection down to "just this
  // clip" (the deferred-from-mousedown case, see this function's own doc above) ignored group
  // membership: clicking one member of an already-multi-selected group collapsed to that ONE clip
  // instead of re-selecting the whole group (caught by tests/e2e/ui/video-group-clips.spec.js, not
  // assumed). Now resolves through the SAME shared function handleClipMouseDown already uses.
  function handleClipClick(track, clip, e) {
    if (!isMod(e) && !e.shiftKey && selectedIds.length > 1 && selectedIds.includes(clip.id)) {
      const action = resolveSelectionOnClick(projectState, track, clip, primaryId, { mod: false, shift: false });
      setSelection(action.ids, action.primaryId);
    }
  }

  // 08-L L3 §2 finding #1 (now patched): right-click an unselected clip selects it first — same
  // "select on right-click if not already part of the selection" rule MediaBin.jsx's
  // handleAssetContextMenu already established for assets — so Delete/Ripple-delete below act on
  // the clip the user actually right-clicked, while right-clicking a clip that's already part of a
  // multi-selection keeps the whole selection (batch delete via the menu works the same as the
  // Delete key does on an existing multi-select).
  function handleClipContextMenu(track, clip, e) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(clip.id)) selectClip(clip.id);
    setClipContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }

  // Phase 13 (§0): a caption "clip" (cue) has no asset to drag from MediaBin — double-clicking
  // empty space on a caption track creates one directly, reusing the exact same snap/overlap
  // checks + InsertClip command handleDropAsset already uses for real media. Double-click (not a
  // single click, which handleBackgroundMouseDown already uses for marquee/clear) on the clip
  // itself is excluded via the `data-clip` check, same pattern handleBackgroundMouseDown uses.
  const DEFAULT_CAPTION_DURATION_MS = 2000;
  function handleTrackDoubleClick(track, e) {
    if (track.type !== 'caption' || e.target.closest('[data-clip]')) return;
    if (track.locked) { setDropError('Track đang khoá — mở khoá để thêm cue.'); return; }
    const rawStartMs = xToMs(e.clientX);
    const candidates = e.shiftKey ? [] : buildSnapCandidates(projectState, track, playheadMs, []);
    const { ms: startMs } = resolveSnap(candidates, rawStartMs, pxToMs(SNAP_PX), null);
    const endMs = startMs + DEFAULT_CAPTION_DURATION_MS;
    if (clipsOverlap(track, startMs, endMs)) {
      setDropError('Vị trí này chồng lấn cue khác trên cùng track — nhấp đúp sang vị trí trống.');
      return;
    }
    const index = computeInsertIndex(track, null, startMs);
    const clip = {
      id: crypto.randomUUID(), sourceInMs: 0, sourceOutMs: DEFAULT_CAPTION_DURATION_MS,
      timelineInMs: startMs, timelineOutMs: endMs, speed: 1,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
      text: { content: 'Phụ đề mới' },
    };
    try {
      execute('InsertClip', { trackId: track.id, index, clip });
      selectClip(clip.id);
    } catch (err) {
      setDropError(err.message);
    }
  }

  function handleAddTrack(type) {
    const order = orderForNewTrack(projectState.tracks, type, findClipLocation(projectState, primaryId)?.track.id);
    const track = { id: crypto.randomUUID(), type, order, locked: false, muted: false, visible: true, clips: [] };
    try {
      execute('AddTrack', { track });
    } catch (err) {
      setDropError(err.message);
    }
  }

  function handleAddVector(type) {
    const start = playheadMs;
    const clip = { id: crypto.randomUUID(), sourceInMs: 0, sourceOutMs: 3000,
      timelineInMs: start, timelineOutMs: start + 3000, speed: 1,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
      [type]: { ...(type === 'shape' ? SHAPE_DEFAULTS : TEXT_DEFAULTS) } };
    const track = { id: crypto.randomUUID(), type, order: orderForNewTrack(projectState.tracks, type, findClipLocation(projectState, primaryId)?.track.id), locked: false, muted: true, visible: true, clips: [clip] };
    execute('AddTrack', { track });
    selectClip(clip.id);
  }

  // handleToggleVisible/Muted/Locked — revisiting a Phase 4/6 deferred item: `track.visible`/
  // `track.muted`/`track.locked` have existed in the schema since Phase 6 and are already fully
  // respected by preview/export for visible/muted (canvasEngine.js, Player.jsx's CaptionOverlay,
  // renderPlanner.js) — `locked` (08.2.1) is newly ENFORCED by this pass's own drag/drop/keyboard/
  // Inspector guards, see this file's other handlers + EffectsPanel.jsx/TransformOverlay.jsx.
  // Generic SetProperty (same pattern every other single-field toggle in this codebase already
  // uses), not a dedicated command.
  function handleToggleVisible(track) {
    const trackIndex = projectState.tracks.findIndex((t) => t.id === track.id);
    execute('SetProperty', { path: ['tracks', trackIndex, 'visible'], from: track.visible, to: !track.visible });
  }
  function handleToggleMuted(track) {
    const trackIndex = projectState.tracks.findIndex((t) => t.id === track.id);
    execute('SetProperty', { path: ['tracks', trackIndex, 'muted'], from: track.muted, to: !track.muted });
  }
  function handleToggleLocked(track) {
    const trackIndex = projectState.tracks.findIndex((t) => t.id === track.id);
    execute('SetProperty', { path: ['tracks', trackIndex, 'locked'], from: !!track.locked, to: !track.locked });
  }

  function handleRemoveTrack(track) {
    const index = projectState.tracks.findIndex((t) => t.id === track.id);
    if (index === -1) return;
    try {
      execute('RemoveTrack', { track, index });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // Removes every keyframe object in `marker.keyframes` (all properties keyframed at that exact
  // clip-relative time — see timelineUtils.js's keyframeMarkersForClip) — 1 RemoveKeyframe command
  // per keyframe, mirroring handleAddKeyframe/Timeline's own 'k' shortcut writing all 6 at once.
  function handleRemoveKeyframeMarker(track, clip, marker) {
    for (const keyframe of marker.keyframes) {
      execute('RemoveKeyframe', { trackId: track.id, clipId: clip.id, keyframe });
    }
  }

  // 08-G G5 (easing picker): right-click a marker -> pick an easing for EVERY keyframe the marker
  // groups, the same bulk-at-marker-granularity semantics add/remove/move already use — a marker
  // has no per-property sub-UI today, so "set this marker's easing" reads naturally as "set the
  // outgoing segment's easing for everything keyed at this instant". 1 SetKeyframeEasing command
  // PER keyframe (N commands for the gesture), mirroring handleRemoveKeyframeMarker's own N-commands
  // choice above rather than inventing a new batched command for this.
  function handleSetKeyframeEasing(track, clip, marker, easing) {
    for (const keyframe of marker.keyframes) {
      if (keyframe.easing === easing) continue;
      execute('SetKeyframeEasing', { trackId: track.id, clipId: clip.id, keyframeId: keyframe.id, from: keyframe.easing, to: easing });
    }
    setKeyframeContextMenu(null);
  }
  function handleKeyframeMarkerContextMenu(track, clip, marker, e) {
    e.preventDefault();
    e.stopPropagation();
    setKeyframeContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id, timeMs: marker.timeMs });
  }

  // 08-G G5 (ADR 0036): commits a custom bezier curve to EVERY keyframe the marker groups — same
  // bulk-at-marker semantics as handleSetKeyframeEasing above. Each keyframe gets its OWN correct
  // `from` values read fresh at commit time (not a value snapshotted when the popover first opened)
  // since the popover can stay open across 2 separate drags (p1 then p2), each its own command.
  function handleCommitBezierEasing(track, clip, marker, next) {
    for (const kf of marker.keyframes) {
      const changes = [
        { field: 'easing', from: kf.easing, to: 'custom' },
        { field: 'easingX1', from: kf.easingX1, to: next.x1 },
        { field: 'easingY1', from: kf.easingY1, to: next.y1 },
        { field: 'easingX2', from: kf.easingX2, to: next.x2 },
        { field: 'easingY2', from: kf.easingY2, to: next.y2 },
      ].filter((c) => !Object.is(c.from, c.to));
      if (changes.length === 0) continue;
      try {
        execute('SetKeyframeFields', { trackId: track.id, clipId: clip.id, keyframeId: kf.id, changes });
      } catch (err) {
        setDropError(err.message);
      }
    }
  }

  // 08-G Graph Editor V1 (ADR 0037): unlike handleCommitBezierEasing above (bulk across every
  // keyframe a MARKER groups, i.e. every property keyed at that instant), the Graph Editor edits
  // exactly ONE property's ONE segment at a time — GraphEditorPanel already resolved which
  // keyframe/segment, this just dispatches the single SetKeyframeFields command.
  function handleCommitGraphEditorTangents(track, clip, keyframeId, changes) {
    try {
      execute('SetKeyframeFields', { trackId: track.id, clipId: clip.id, keyframeId, changes });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // 08-G G4: drag a keyframe marker (diamond) to a new clip-relative time — one MoveKeyframe
  // command per gesture, batched across every keyframe the marker groups (mirrors
  // handleTrimStart's own mousedown/mousemove/mouseup/Escape/blur drag skeleton, the established
  // pattern for every other Timeline drag gesture). Snaps to the clip's own start/end, the
  // playhead, and every OTHER marker's time on this clip; a candidate that would collide with an
  // existing keyframe for one of the SAME properties this marker carries is shown as blocked and
  // refused on drop (MoveKeyframe.js's own assertNoDuplicateKeyframeTime is the authoritative
  // backstop — this is purely the interactive preview of that same rule).
  function handleKeyframeMarkerMouseDown(track, clip, marker, e) {
    // e.preventDefault() (not just stopPropagation) — matches handleTrimStart's own mousedown
    // below. Without it, the browser's native drag-and-drop detection still activates on the
    // NEXT mousemove even though this button itself is draggable={false}: a mousedown that isn't
    // prevented lets the ancestor clip (draggable={true}) become the drag source once the pointer
    // moves, since draggable={false} only opts the marker itself out of BEING a drag source, it
    // doesn't cancel the browser's default "start dragging the nearest draggable ancestor" search
    // triggered by an unprevented mousedown+move. Found via a real e2e run (mousemove/mouseup never
    // reached the window listeners at all — dragstart fired on the CLIP element instead).
    e.preventDefault();
    e.stopPropagation();
    if (track.locked) { setDropError('Track đang khoá — mở khoá để sửa keyframe.'); return; }
    const startClientX = e.clientX;
    const durationMs = clip.timelineOutMs - clip.timelineInMs;
    const originalMs = marker.timeMs;
    const movingIds = marker.keyframes.map((kf) => kf.id);
    const otherMarkerTimes = keyframeMarkersForClip(clip).filter((m) => m.timeMs !== marker.timeMs).map((m) => m.timeMs);
    const playheadRelativeMs = playheadMs - clip.timelineInMs;
    const snapTargets = [0, durationMs, ...otherMarkerTimes];
    if (playheadRelativeMs >= 0 && playheadRelativeMs <= durationMs) snapTargets.push(playheadRelativeMs);
    const snapThresholdMs = pxToMs(SNAP_PX);

    function collidesAt(targetMs) {
      const movingPaths = new Set(marker.keyframes.map((kf) => kf.propertyPath));
      return (clip.keyframes || []).some((kf) => !movingIds.includes(kf.id) && movingPaths.has(kf.propertyPath) && kf.timeMs === targetMs);
    }

    let dragStarted = false;
    let latestMs = originalMs;
    let latestBlocked = false;

    function onMove(ev) {
      if (!dragStarted) {
        if (Math.abs(ev.clientX - startClientX) < MARQUEE_THRESHOLD_PX) return;
        dragStarted = true;
        keyframeDragSuppressClickRef.current = true;
      }
      const rawMs = Math.max(0, Math.min(durationMs, originalMs + pxToMs(ev.clientX - startClientX)));
      let snappedMs = rawMs;
      let nearestDist = snapThresholdMs;
      for (const t of snapTargets) {
        const d = Math.abs(t - rawMs);
        if (d <= nearestDist) { snappedMs = t; nearestDist = d; }
      }
      latestMs = snappedMs;
      latestBlocked = collidesAt(snappedMs);
      setKeyframeDragPreview({ clipId: clip.id, originalMs, timeMs: snappedMs, blocked: latestBlocked });
    }
    function removeListeners() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onCancel);
    }
    function onUp() {
      removeListeners();
      setKeyframeDragPreview(null);
      if (!dragStarted) return; // plain click — the marker's own onClick handles delete
      if (latestBlocked) { setDropError('Đã có keyframe khác tại vị trí này — thả sang chỗ khác.'); return; }
      if (latestMs === originalMs) return;
      try {
        execute('MoveKeyframe', { trackId: track.id, clipId: clip.id, keyframeIds: movingIds, from: originalMs, to: latestMs });
      } catch (err) {
        setDropError(err.message);
      }
    }
    function onCancel() {
      removeListeners();
      setKeyframeDragPreview(null);
    }
    function onKeyDown(ev) {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onCancel);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Phase 9: toggles a crossfade transition at the boundary between 2 ADJACENT clips (§9's own
  // "chỉ 2 clip touching, không overlap" scope decision — see shared/video-commands/invariants.js's
  // assertTransitionsReferenceAdjacentClips). Default 500ms, capped to the shorter clip's own
  // duration (AddTransition.validate() would reject anything longer anyway).
  const DEFAULT_TRANSITION_MS = 500;
  function handleToggleTransition(track, fromClip, toClip) {
    const existing = (projectState.transitions || []).find((t) => t.fromClipId === fromClip.id && t.toClipId === toClip.id);
    if (existing) {
      execute('RemoveTransition', { transition: existing });
      return;
    }
    const fromDurationMs = fromClip.timelineOutMs - fromClip.timelineInMs;
    const toDurationMs = toClip.timelineOutMs - toClip.timelineInMs;
    const durationMs = Math.min(DEFAULT_TRANSITION_MS, fromDurationMs, toDurationMs);
    try {
      execute('AddTransition', { transition: { id: crypto.randomUUID(), fromClipId: fromClip.id, toClipId: toClip.id, durationMs, params: {} } });
    } catch (err) {
      setDropError(err.message);
    }
  }

  // Phase 13 (§0): import an .srt/.vtt file's cues into `track` (a caption track) — 1 InsertClip
  // per cue (no batch-import command, same "no batch command type" precedent Phase 7/11 already
  // used). A cue that would overlap an existing one on this track is SKIPPED, not rejected outright
  // — the rest of the file still imports; the skipped count is surfaced via the existing
  // dropError banner rather than aborting the whole import over 1 bad cue.
  function handleImportSubtitleFile(track, e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    file.text().then((text) => {
      const cues = parseSubtitle(text);
      let skipped = 0;
      for (const cue of cues) {
        if (clipsOverlap(track, cue.startMs, cue.endMs)) { skipped++; continue; }
        const index = computeInsertIndex(track, null, cue.startMs);
        const clip = {
          id: crypto.randomUUID(), sourceInMs: 0, sourceOutMs: cue.endMs - cue.startMs,
          timelineInMs: cue.startMs, timelineOutMs: cue.endMs, speed: 1,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
          text: { content: cue.content },
        };
        try {
          execute('InsertClip', { trackId: track.id, index, clip });
        } catch {
          skipped++;
        }
      }
      if (skipped > 0) setDropError(`Đã import ${cues.length - skipped}/${cues.length} cue — ${skipped} cue bị bỏ qua (chồng lấn thời gian).`);
    }).catch((err) => setDropError(`Không đọc được file: ${err.message}`));
  }

  // downloadTextFile: standard Blob + <a download> pattern — this is the real browser app (not an
  // Artifact sandbox), so a plain anchor download works fine here.
  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportSubtitleFile(track, format) {
    const cues = sortedCaptionCues(track).map((c) => ({ startMs: c.timelineInMs, endMs: c.timelineOutMs, content: c.text?.content || '' }));
    const text = format === 'vtt' ? formatVtt(cues) : formatSrt(cues);
    downloadTextFile(`captions.${format}`, text);
  }

  function sortedCaptionCues(track) {
    return [...track.clips].sort((a, b) => a.timelineInMs - b.timelineInMs);
  }

  // 08.2.6 §2 (Visual Zone luôn ở trên Audio Zone): getTimelineRows() groups by zone first — this
  // flat track list (placeholder rows filtered out) is what actually renders below; the map itself
  // stays untouched (its JSX never used a raw array-index for clip positioning — verified before
  // this change), only its SOURCE order changed from raw `.order` to zone-then-order.
  const timelineRows = getTimelineRows(projectState);
  const sortedTracksForRender = timelineRows.filter((r) => r.kind === 'track').map((r) => r.track);
  const visualZoneEmpty = timelineRows[0]?.kind === 'empty-zone' && timelineRows[0].zone === 'visual';
  const audioZoneEmpty = timelineRows.some((r) => r.kind === 'empty-zone' && r.zone === 'audio');
  const firstAudioTrackId = sortedTracksForRender.find((t) => getTrackZone(t.type) === 'audio')?.id;
  // 08-UI §6.4: track schema has no `name` field (không đổi schema cho việc thuần visual) — tính
  // "Video 1/Audio 2/..." theo thứ tự xuất hiện trong cùng loại, chỉ ở render.
  const trackTypeSeen = {};
  const trackDisplayName = {};
  for (const t of sortedTracksForRender) {
    trackTypeSeen[t.type] = (trackTypeSeen[t.type] || 0) + 1;
    trackDisplayName[t.id] = `${TRACK_TYPE_LABEL[t.type] || t.type} ${trackTypeSeen[t.type]}`;
  }

  // 08-UI Priority 0 bước 2 (nguyên tắc icon-button + tooltip): moved from VideoToolbar.jsx's own
  // `iconBtn` helper, same shape (36px, title+aria-label đóng vai trò tooltip, disabled state) —
  // giờ là helper DUY NHẤT của 1 toolbar Timeline, không còn 2 gu control khác nhau giữa 2 file.
  function iconBtn(icon, label, onClick, disabled = false, extraProps = {}) {
    return (
      <button
        key={label}
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        {...extraProps}
      >
        {icon}
      </button>
    );
  }

  // 08.2.6 §2 (Empty zone có CTA tạo compatible track): rendered as a real h-16 row (same height
  // as a track row, `TRACK_HEIGHT_PX` in timelineUtils.js) — NOT a shorter placeholder — because
  // getTimelineRows() already counted it as one row when computing marquee hit-test indices (see
  // that function's own comment); a different height here would desync the two.
  function emptyZoneRow(zone) {
    const label = zone === 'visual' ? 'video' : 'audio';
    return (
      <div className="h-16 border-b border-[var(--card-border,#f3f4f6)] flex items-center gap-2 px-3 text-xs text-[var(--n600,#4b5563)]">
        <span>Chưa có track {label} nào trong {zone === 'visual' ? 'Visual Zone' : 'Audio Zone'}</span>
        {iconBtn(<Plus size={14} />, `Thêm track ${label}`, () => handleAddTrack(zone === 'visual' ? 'video' : 'audio'))}
      </div>
    );
  }

  return (
    <div role="region" aria-label="Timeline" className="flex flex-col flex-1 min-h-0 bg-[var(--card,#fff)]">
      {/* pr-8: chừa chỗ cho nút "Thu gọn Timeline" của VideoWorkspace.jsx (absolute top-1 right-1
          w-6 h-6, đè lên panel cha) — bug thật bắt được qua e2e thật (nút Fit project mới đủ rộng
          để chạm đúng góc đó, nút "Fit project" text cũ trước đây không). */}
      <div className="flex items-center gap-1 px-2 pr-9 min-h-9 shrink-0 overflow-x-auto border-b border-[var(--card-border,#f3f4f6)] text-xs">
        <span className="font-mono tabular-nums text-[var(--text,#111827)] px-1 shrink-0">{formatTimecode(playheadMs)}</span>
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<Undo2 size={16} />, `Undo (${SHORTCUTS.undo})`, undo, !canUndo)}
        {iconBtn(<Redo2 size={16} />, `Redo (${SHORTCUTS.redo})`, redo, !canRedo)}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<Scissors size={16} />, `Split tại playhead (${SHORTCUTS.split})`, handleSplitAtPlayhead, !splitTarget || splitTarget.track.locked)}
        {iconBtn(<Trash2 size={16} />, `Xoá clip đã chọn (${SHORTCUTS.delete}) — giữ Shift để ripple delete (${SHORTCUTS.rippleDelete})`, (e) => handleDeleteSelection(e.shiftKey), selectedIds.length === 0)}
        {iconBtn(<Copy size={16} />, `Nhân bản clip (${SHORTCUTS.duplicate})`, () => duplicateTarget && handleDuplicateClip(duplicateTarget.track, duplicateTarget.clip), !duplicateTarget || duplicateTarget.track.locked)}
        {iconBtn(<GroupIcon size={16} />, `Nhóm clip đã chọn (${SHORTCUTS.group})`, handleGroupSelection, !canGroup)}
        {iconBtn(<Ungroup size={16} />, `Bỏ nhóm (${SHORTCUTS.ungroup})`, handleUngroupSelection, !canUngroup)}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<Diamond size={16} />, `Thêm keyframe tại playhead (${SHORTCUTS.addKeyframe})`, handleAddKeyframeAtPlayhead, !canAddKeyframe)}
        {iconBtn(<ChevronLeft size={16} />, `Keyframe trước (${SHORTCUTS.prevKeyframe})`, () => handleJumpToKeyframe(prevKeyframeMarker), !prevKeyframeMarker)}
        {iconBtn(<ChevronRight size={16} />, `Keyframe sau (${SHORTCUTS.nextKeyframe})`, () => handleJumpToKeyframe(nextKeyframeMarker), !nextKeyframeMarker)}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        <select
          title="Tốc độ clip đã chọn"
          aria-label="Tốc độ clip đã chọn"
          value={speedTarget ? speedTarget.clip.speed ?? 1 : 1}
          onChange={handleSpeedChange}
          disabled={!speedTarget || speedTarget.track.locked}
          className="h-8 shrink-0 text-xs rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] disabled:opacity-30 px-1 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        >
          {SPEED_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <div className="flex-1" />
        {iconBtn(<Film size={16} />, 'Thêm track video', () => handleAddTrack('video'), false, { 'data-add-track': 'video' })}
        {iconBtn(<ImageIcon size={16} />, 'Thêm track ảnh', () => handleAddTrack('image'), false, { 'data-add-track': 'image' })}
        {iconBtn(<Music size={16} />, 'Thêm track audio', () => handleAddTrack('audio'), false, { 'data-add-track': 'audio' })}
        {iconBtn(<Captions size={16} />, 'Thêm track phụ đề', () => handleAddTrack('caption'), false, { 'data-add-track': 'caption' })}
        {iconBtn(<Type size={16} />, 'Thêm chữ', () => handleAddVector('text'))}
        {iconBtn(<Square size={16} />, 'Thêm shape', () => handleAddVector('shape'))}
        {iconBtn(<Sticker size={16} />, 'Thêm track sticker', () => handleAddTrack('sticker'), false, { 'data-add-track': 'sticker' })}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<Layers size={16} />, 'Ghép timeline khác (compound clip)', () => setShowEmbedDialog(true), false, { 'data-embed-timeline': 'true' })}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<ZoomOut size={16} />, 'Thu nhỏ timeline', () => zoomBy(1 / 1.25))}
        {iconBtn(<ZoomIn size={16} />, 'Phóng to timeline', () => zoomBy(1.25))}
        {iconBtn(<Frame size={16} />, 'Fit theo lựa chọn', handleFitToSelection, selectedIds.length === 0)}
        {iconBtn(<Scan size={16} />, 'Fit toàn bộ project', handleFitToProject)}
        <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
        {iconBtn(<Keyboard size={16} />, 'Phím tắt (?)', () => setShowShortcutHelp(true))}
      </div>

      {dropError && <div role="alert" className="shrink-0 flex items-start justify-between gap-3 px-3 py-2 text-xs text-[var(--video-error)] bg-[var(--card)] border-b border-[var(--card-border)]">
        <span className="break-words">{dropError}</span><button onClick={() => setDropError(null)} className="shrink-0 underline">Đóng thông báo</button>
      </div>}
      {trackMenu && <div ref={trackMenuRef} role="menu" aria-label="Track height" className="fixed z-50 rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-xl text-xs" style={{ left: trackMenu.x, top: trackMenu.y }}>
        <div className="px-2 py-1 text-[var(--n600)]">Track height</div>
        {['short', 'default', 'tall'].map(height => <button key={height} role="menuitemradio" aria-checked={(projectState.tracks.find(t => t.id === trackMenu.id)?.height || 'default') === height} className="block w-full px-3 py-2 text-left hover:bg-[var(--accent-tint)]" onClick={() => {
          const index = projectState.tracks.findIndex(t => t.id === trackMenu.id);
          execute('SetProperty', { path: ['tracks', index, 'height'], from: projectState.tracks[index].height, to: height }); setTrackMenu(null);
        }}>{height === 'short' ? 'Short' : height === 'tall' ? 'Tall' : 'Default'}</button>)}
      </div>}
      <div
        ref={scrollRef}
        onCopy={e => handleCopyClips(e)}
        onCut={e => handleCopyClips(e, true)}
        onPaste={e => {
          if (e.target.matches('input,textarea') || e.target.isContentEditable) return;
          if (e.clipboardData.files.length) { e.preventDefault(); importExternalFiles([...e.clipboardData.files], { atMs: playheadMs, aboveTrackId: insertionTrackId }); }
          else {
            const text = e.clipboardData.getData('text/plain');
            const raw = e.clipboardData.getData('application/x-space-flow-clips') || (text.startsWith('SpaceFlow clips:') ? text.slice(16) : '');
            try {
              const clipboard = raw ? JSON.parse(raw) : !text && useVideoStore.getState().timelineClipboard;
              if (clipboard) { e.preventDefault(); handlePasteClips(insertionTrackId || findClipLocation(projectState, primaryId)?.track.id, clipboard); }
            } catch { setDropError('Nội dung clipboard không hợp lệ.'); }
          }
        }}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files') || isInternalMediaDrag(e.dataTransfer)) e.preventDefault(); }}
        onDrop={e => {
          if (e.target.closest('[data-track-id]')) return;
          e.preventDefault();
          if (e.dataTransfer.types.includes('application/x-video-asset')) {
            const asset = assets.find(a => a.id === e.dataTransfer.getData('application/x-video-asset'));
            if (!asset) return;
            const track = { id: crypto.randomUUID(), type: asset.kind, clips: [], locked: false, muted: false, visible: true,
              order: orderForNewTrack(projectState.tracks, asset.kind, insertionTrackId || findClipLocation(projectState, primaryId)?.track.id) };
            handleDropAsset(track, e, true);
          }
          else if (!isInternalMediaDrag(e.dataTransfer) && e.dataTransfer.files.length) importExternalFiles([...e.dataTransfer.files], { atMs: playheadMs, aboveTrackId: insertionTrackId });
          else if (dragGestureRef.current) {
            const gesture = dragGestureRef.current;
            const clipboard = captureClips(projectState, gesture.clipIds);
            if (gesture.duplicate) { handlePasteClips(insertionTrackId, clipboard); return; }
            try {
              const sources = clipboard.tracks;
              const whole = sources.every(source => projectState.tracks.find(t => t.id === source.id).clips.length === source.clips.length);
              if (whole) {
                const changes = trackReorderChanges(projectState, sources, null);
                if (changes.length) execute('SetProperties', { changes });
              } else {
                const start = Math.min(...sources.flatMap(t => t.clips.map(c => c.timelineInMs)));
                const args = buildPaste(projectState, clipboard, start, insertionTrackId);
                const moves = sources.flatMap(source => source.clips.map(clip => ({ clipId: clip.id, fromTrackId: source.id,
                  toTrackId: args.newTracks[sources.length - 1 - sources.indexOf(source)].id, fromIndex: projectState.tracks.find(t => t.id === source.id).clips.findIndex(c => c.id === clip.id), fromTimelineInMs: clip.timelineInMs, toTimelineInMs: clip.timelineInMs })));
                execute('MoveClips', { newTracks: args.newTracks, moves });
              }
            } catch (err) { setDropError(err.message); }
          }
        }}
        tabIndex={-1}
        // 08.3.1 (canvas arrow-key nudge focus-scoping, Player.jsx's own `containerRef`): a plain
        // non-focusable click target does NOT reliably blur whatever else currently has focus in
        // every browser/interaction path (verified empirically — the assumption that it would was
        // wrong), so reclaiming focus back to the timeline on ANY interaction here has to be
        // explicit. Capture phase so it runs BEFORE handleClipMouseDown/handleBackgroundMouseDown/
        // the ruler's scrub-start (bubble-phase handlers below), regardless of which one fires.
        onMouseDownCapture={() => scrollRef.current?.focus()}
        className="flex-1 overflow-auto relative select-none outline-none"
        style={{ scrollPaddingLeft: TRACK_HEADER_WIDTH_PX }}
        onMouseDown={handleBackgroundMouseDown}
        onScroll={(e) => setViewport({ scrollLeft: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
      >
        <div className="relative" style={{ width: totalWidthPx, minHeight: '100%' }}>
          <div
            className="sticky top-0 z-30 bg-[var(--card,#fff)] border-b border-[var(--card-border,#e5e7eb)] cursor-text focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            style={{ height: RULER_HEIGHT_PX }}
            onMouseDown={handleScrubStart}
            role="slider"
            aria-label="Kéo để tua nhanh (scrub)"
            aria-valuenow={Math.round(playheadMs)}
            aria-valuemin={0}
            aria-valuemax={Math.round(Math.max(maxClipEndMs, playheadMs))}
            // 08-L L6: role="slider" trước đây có tabIndex={-1} — không bao giờ nhận focus thật,
            // vi phạm WAI-ARIA slider pattern (widget phải focusable). Không cần thêm onKeyDown ở
            // đây: ArrowLeft/Right frame-step đã là global window listener (xem Player.jsx's
            // containerRef comment) nên đã hoạt động đúng bất kể ruler có đang focus hay không.
            tabIndex={0}
          >
            {rulerTicks.map((ms) => (
              <span key={ms} aria-hidden="true" className="absolute top-0 h-full border-l border-[var(--n300,#d1d5db)] pl-1 text-[10px] text-[var(--n600,#4b5563)] pointer-events-none" style={{ left: timeToX(ms) }}>
                {formatTimecode(ms)}
              </span>
            ))}
            <span aria-hidden="true" className="sticky left-0 block h-full bg-[var(--card,#fff)] border-r border-[var(--card-border,#e5e7eb)]" style={{ width: TRACK_HEADER_WIDTH_PX }} />
          </div>
          {visualZoneEmpty && emptyZoneRow('visual')}
          {sortedTracksForRender.map((track, trackIndex) => (
            <div
              key={track.id}
              data-track-id={track.id}
              data-track-type={track.type}
              style={{ height: trackHeight(track) }}
              onMouseDown={(e) => { setInsertionTrackId(track.id); if (!e.target.closest('[data-clip]')) e.currentTarget.closest('[aria-label="Timeline"]')?.focus(); }}
              // 08.2.6 §2: a 2px top border marks the Visual/Audio Zone divider on the first
              // audio-zone row — no separate divider element (would add its own height and desync
              // clipScreenRect()'s uniform-row-height math, see getTimelineRows()'s own comment).
              className={`relative h-16 border-b border-[var(--card-border,#f3f4f6)] ${track.id === firstAudioTrackId ? 'border-t-2 border-t-[var(--card-border,#d1d5db)]' : ''} ${dragOverTrackId === track.id ? 'bg-[var(--accent-tint,#EDE9FE)]' : ''}`}
              onDragOver={(e) => handleDragOverTrack(track, e)}
              onDragLeave={() => setDragOverTrackId((id) => (id === track.id ? null : id))}
              onDrop={(e) => handleDropTrack(track, e)}
              onDoubleClick={(e) => handleTrackDoubleClick(track, e)}
            >
              <div
                data-track-header="true"
                onContextMenu={e => { if (track.type === 'audio') { e.preventDefault(); e.stopPropagation(); setTrackMenu({ id: track.id, x: e.clientX, y: e.clientY }); } }}
                onMouseDown={(e) => e.stopPropagation()}
                className="sticky left-0 top-0 h-16 z-20 bg-[var(--card,#fff)] border-r border-[var(--card-border,#e5e7eb)]"
                style={{ width: TRACK_HEADER_WIDTH_PX, height: trackHeight(track) }}
              >
              {/* Nội dung tương tác nhốt trong 1 dải cao 28px SÁT TRÊN (không center theo cả
                  h-16) + overflow-hidden: hit-area mở rộng dọc của các nút lock/visible/mute
                  (py-3 -my-3, kỹ thuật WCAG 32px có sẵn từ trước) nếu để center theo cả 64px sẽ
                  lấn đúng vùng clip (top-4 h-10) bên dưới — bug thật bắt được qua e2e thật
                  (auto-scroll test: mousedown ở giữa clip lại trúng nút lock-open ẩn phía sau do
                  hit-area nút đó tràn xuống). overflow-hidden cắt hit-area về đúng dải 28px này. */}
              <div className="absolute top-0 left-0 right-0 h-7 overflow-hidden flex items-center gap-1 px-2">
                {(() => {
                  const TypeIcon = TRACK_TYPE_ICON[track.type];
                  const typeColor = TRACK_TYPE_COLOR[track.type] || 'var(--n500,#6b7280)';
                  return TypeIcon ? <TypeIcon size={13} style={{ color: typeColor }} className="shrink-0" /> : null;
                })()}
                <span className="text-[11px] font-medium text-[var(--n600,#4b5563)] truncate flex-1">{trackDisplayName[track.id]}</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => handleToggleLocked(track)}
                  title={track.locked ? 'Mở khoá track' : 'Khoá track (chặn mọi chỉnh sửa)'}
                  aria-label={track.locked ? 'Mở khoá track' : 'Khoá track (chặn mọi chỉnh sửa)'}
                  className="pointer-events-auto text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] py-3 -my-3 px-0.5 -mx-0.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                >
                  {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => handleToggleVisible(track)}
                  title={track.visible ? 'Ẩn track (bỏ qua khi preview/render)' : 'Hiện lại track'}
                  aria-label={track.visible ? 'Ẩn track (bỏ qua khi preview/render)' : 'Hiện lại track'}
                  className="pointer-events-auto text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] py-3 -my-3 px-0.5 -mx-0.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                >
                  {track.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
                {(track.type === 'video' || track.type === 'audio') && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => handleToggleMuted(track)}
                    title={track.muted ? 'Bỏ tắt tiếng track' : 'Tắt tiếng track (bỏ qua audio khi preview/render)'}
                    aria-label={track.muted ? 'Bỏ tắt tiếng track' : 'Tắt tiếng track (bỏ qua audio khi preview/render)'}
                    className="pointer-events-auto text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] py-3 -my-3 px-0.5 -mx-0.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                  >
                    {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                  </button>
                )}
                {track.type === 'caption' && (
                  <>
                    <label
                      className="pointer-events-auto text-[10px] text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] underline cursor-pointer"
                      onMouseDown={(e) => e.stopPropagation()}
                      title="Import .srt/.vtt vào track này"
                    >
                      Import
                      <input type="file" accept=".srt,.vtt" aria-label="Import .srt/.vtt vào track này" className="hidden" onChange={(e) => handleImportSubtitleFile(track, e)} />
                    </label>
                    {track.clips.length > 0 && (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => handleExportSubtitleFile(track, 'srt')}
                          aria-label="Xuất track phụ đề dạng .srt"
                          className="pointer-events-auto text-[10px] text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                        >
                          .srt
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => handleExportSubtitleFile(track, 'vtt')}
                          aria-label="Xuất track phụ đề dạng .vtt"
                          className="pointer-events-auto text-[10px] text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                        >
                          .vtt
                        </button>
                      </>
                    )}
                  </>
                )}
                {track.clips.length === 0 && (
                  <button
                    type="button"
                    data-remove-track={track.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => handleRemoveTrack(track)}
                    className="pointer-events-auto text-[var(--n600,#4b5563)] hover:text-[var(--status-error,#ef4444)] leading-none py-3 -my-3 px-0.5 -mx-0.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
                    title="Xoá track (chỉ khi trống)"
                    aria-label="Xoá track (chỉ khi trống)"
                  >
                    ×
                  </button>
                )}
              </div>
              </div>
              {track.clips.filter(isClipVisible).map((clip) => {
                const asset = assets.find((a) => a.id === clip.assetId);
                const isSelected = selectedIds.includes(clip.id);
                const isPrimary = primaryId === clip.id;
                const displayedClip = trimPreview?.clipId === clip.id ? { ...clip, ...trimPreview } : clip;
                const clipWidthPx = msToPx(displayedClip.timelineOutMs - displayedClip.timelineInMs);
                // 08-UI §6.4: thumbnail thật (asset.thumbnailUrl có sẵn từ backend ffmpeg-thumbnail
                // lúc import, giống MediaBin.jsx) cho video/sticker; image asset dùng previewUrl()
                // fallback y hệt MediaBin. Chỉ hiện khi clip đủ rộng, không ép micro-thumbnail.
                // 08.2.6 §1: `image` track added to the same thumbnail-eligible set as video/sticker
                // — an image clip on it uses the same previewUrl() fallback sticker/image assets
                // already relied on.
                const showThumbnail = (track.type === 'video' || track.type === 'image' || track.type === 'sticker') && clipWidthPx > 40
                  && asset && (asset.thumbnailUrl || asset.kind === 'image');
                const thumbnailSrc = showThumbnail ? (asset.thumbnailUrl || previewUrl(asset.sourcePath)) : null;
                const showWaveform = track.type === 'audio' && asset?.sourcePath;
                const typeColor = TRACK_TYPE_COLOR[track.type] || null;
                return (
                  <div
                    key={clip.id}
                    data-clip="true"
                    data-clip-id={clip.id}
                    draggable={!track.locked}
                    onDragStart={(e) => handleClipDragStart(track, clip, e)}
                    onDragEnd={handleClipDragEnd}
                    onMouseDown={(e) => handleClipMouseDown(track, clip, e)}
                    onClick={(e) => handleClipClick(track, clip, e)}
                    onContextMenu={(e) => handleClipContextMenu(track, clip, e)}
                    className={`absolute top-4 h-10 rounded-md border overflow-hidden flex items-center px-2 ${track.locked ? 'cursor-not-allowed' : 'cursor-grab'}
                      ${isPrimary || isSelected ? 'border-[var(--accent,#7C5CFA)] bg-[var(--accent-tint,#EDE9FE)]' : 'border-[var(--card-border,#e5e7eb)] bg-[var(--n100,#f3f4f6)]'}
                      ${track.locked ? 'opacity-70' : ''}`}
                    style={{ left: timeToX(displayedClip.timelineInMs), width: Math.max(4, clipWidthPx), height: trackHeight(track) - 24 }}
                    title={`${track.locked ? '(Track đang khoá) ' : ''}${clip.shape ? `Shape · ${clip.shape.type}` : clip.text && !clip.assetId ? clip.text.content : (asset?.sourcePath || clip.assetId)}`}
                  >
                    {typeColor && <div className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none" style={{ backgroundColor: typeColor }} />}
                    {/* 08-F F5 / ADR 0034: compound clip marker — amber+warning icon instead of the
                        plain Layers icon when the embedded timeline has moved forward since this
                        clip was rendered (informational only, never blocks anything). */}
                    {clip.compoundRef && (
                      <div
                        className={`absolute top-0.5 right-0.5 pointer-events-none rounded-sm p-0.5 ${staleCompoundTimelineIds.has(clip.compoundRef.timelineProjectId) ? 'bg-amber-500/90 text-white' : 'bg-black/30 text-white'}`}
                        title={staleCompoundTimelineIds.has(clip.compoundRef.timelineProjectId)
                          ? `Timeline lồng "${clip.compoundRef.timelineProjectName || ''}" đã thay đổi — cần ghép lại để cập nhật`
                          : `Compound clip từ timeline "${clip.compoundRef.timelineProjectName || ''}"`}
                      >
                        {staleCompoundTimelineIds.has(clip.compoundRef.timelineProjectId) ? <AlertTriangle size={9} /> : <Layers size={9} />}
                      </div>
                    )}
                    {thumbnailSrc && <img draggable={false} src={thumbnailSrc} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none" />}
                    {showWaveform && <AudioWaveform assetId={clip.assetId} sourcePath={asset.sourcePath} clip={displayedClip} durationMs={asset.durationMs || clip.sourceOutMs} width={clipWidthPx} />}
                    <span className={`relative text-[10px] truncate pointer-events-none ${thumbnailSrc ? 'text-white drop-shadow' : 'text-[var(--n600,#4b5563)]'}`}>
                      {track.locked && <Lock size={9} className="inline mr-0.5 -mt-0.5" />}
                      {clip.shape ? `Shape · ${clip.shape.type}` : clip.text && !clip.assetId ? (clip.text.content || '(trống)') : (asset?.sourcePath?.split(/[\\/]/).pop() || clip.assetId)}
                    </span>
                    {keyframeMarkersForClip(clip).map((marker) => {
                      // 08-G G4: while THIS marker is mid-drag, render it at the live snapped
                      // candidate position instead of its (still-uncommitted) original timeMs —
                      // MoveKeyframe only fires once on mouseup, so `clip.keyframes` itself hasn't
                      // moved yet (same "preview state, not committed state" rule trimPreview uses).
                      const dragging = keyframeDragPreview?.clipId === clip.id && keyframeDragPreview.originalMs === marker.timeMs;
                      const displayMs = dragging ? keyframeDragPreview.timeMs : marker.timeMs;
                      return (
                        <button
                          key={marker.timeMs}
                          type="button"
                          data-keyframe-marker={marker.timeMs}
                          // 08-G G4: without an explicit draggable={false}, this button sits inside
                          // the clip's own draggable={true} element (handleClipDragStart) and the
                          // browser treats the CLIP as the drag source for a mousedown that starts
                          // here — same trap the trim handles below already guard against the exact
                          // same way (draggable={false} + onDragStart preventDefault).
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          onMouseDown={(e) => handleKeyframeMarkerMouseDown(track, clip, marker, e)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (keyframeDragSuppressClickRef.current) { keyframeDragSuppressClickRef.current = false; return; }
                            handleRemoveKeyframeMarker(track, clip, marker);
                          }}
                          onContextMenu={(e) => handleKeyframeMarkerContextMenu(track, clip, marker, e)}
                          title={dragging ? `Kéo tới ${Math.round(displayMs)}ms${keyframeDragPreview.blocked ? ' — đã có keyframe khác, thả sẽ bị huỷ' : ''}` : `Keyframe tại ${Math.round(marker.timeMs)}ms trong clip — kéo để đổi vị trí, bấm để xoá, phải-chuột để đổi easing`}
                          aria-label={`Keyframe tại ${Math.round(marker.timeMs)}ms trong clip — kéo để đổi vị trí, bấm để xoá, phải-chuột để đổi easing`}
                          className={`absolute bottom-0.5 w-2 h-2 rotate-45 border cursor-ew-resize focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 z-20 ${dragging && keyframeDragPreview.blocked ? 'bg-[var(--status-error,#ef4444)] border-[var(--status-error,#ef4444)]' : 'bg-[var(--accent,#7C5CFA)] border-[var(--accent-strong,#6B46F0)] hover:bg-[var(--status-error,#ef4444)]'}`}
                          style={{ left: msToPx(displayMs) - 4 }}
                        />
                      );
                    })}
                    {!track.locked && msToPx(clip.timelineOutMs - clip.timelineInMs) > MIN_CLIP_WIDTH_FOR_TRIM_PX && (
                      <>
                        <div
                          data-trim-handle="left"
                          role="separator"
                          aria-orientation="vertical"
                          draggable={false}
                          onMouseDown={(e) => handleTrimStart(track, clip, 'left', e)}
                          onDragStart={(e) => e.preventDefault()}
                          title="Kéo để trim mép trái"
                          aria-label="Kéo để trim mép trái"
                          className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-10 bg-[var(--n900,#111827)]/10 hover:bg-[var(--accent,#7C5CFA)]/40"
                          style={{ width: TRIM_HANDLE_PX }}
                        />
                        <div
                          data-trim-handle="right"
                          role="separator"
                          aria-orientation="vertical"
                          draggable={false}
                          onMouseDown={(e) => handleTrimStart(track, clip, 'right', e)}
                          onDragStart={(e) => e.preventDefault()}
                          title="Kéo để trim mép phải"
                          aria-label="Kéo để trim mép phải"
                          className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-10 bg-[var(--n900,#111827)]/10 hover:bg-[var(--accent,#7C5CFA)]/40"
                          style={{ width: TRIM_HANDLE_PX }}
                        />
                      </>
                    )}
                    {trimPreview && trimPreview.clipId === clip.id && (
                      <div
                        data-trim-preview="true"
                        className="absolute -top-6 whitespace-nowrap text-[10px] font-mono text-white bg-black/80 rounded px-1 py-0.5 pointer-events-none z-30"
                        style={trimPreview.edge === 'left' ? { left: 0 } : { right: 0 }}
                      >
                        {formatTimecode(trimPreview.timelineInMs)}–{formatTimecode(trimPreview.timelineOutMs)}
                      </div>
                    )}
                  </div>
                );
              })}
              {adjacentClipPairs(track).map(({ fromClip, toClip }) => {
                const transition = (projectState.transitions || []).find((t) => t.fromClipId === fromClip.id && t.toClipId === toClip.id);
                return (
                  <TimelineTransition key={`${fromClip.id}-${toClip.id}`} track={track} fromClip={fromClip} toClip={toClip} transition={transition}
                    timeToX={timeToX} pxToMs={pxToMs} msToPx={msToPx} onToggle={() => handleToggleTransition(track, fromClip, toClip)} />
                );
              })}
            </div>
          ))}
          {audioZoneEmpty && emptyZoneRow('audio')}

          <div data-playhead="true" className="absolute top-0 bottom-0 w-px bg-[var(--accent,#7C5CFA)] z-20 pointer-events-none" style={{ left: timeToX(playheadMs) }}>
            <svg aria-hidden="true" width="12" height="18" viewBox="0 0 12 18" style={{ position: 'sticky', top: 0, marginLeft: -5.5 }}><path d="M2 1H10V11L6 16L2 11Z" fill="var(--card)" stroke="var(--accent)" strokeWidth="2" /></svg>
          </div>
          {snapGuide && (
            <div
              data-snap-guide={snapGuide.type}
              className="absolute top-0 bottom-0 w-px bg-[var(--accent,#7C5CFA)] z-30 pointer-events-none"
              style={{ left: timeToX(snapGuide.ms) }}
            >
              <span className="absolute top-0 left-1 whitespace-nowrap text-[10px] font-mono text-white bg-[var(--accent,#7C5CFA)] rounded px-1">
                {SNAP_TYPE_LABEL[snapGuide.type] || snapGuide.type}
              </span>
            </div>
          )}
          {marqueeRect && (
            <div
              className="absolute border border-[var(--accent,#7C5CFA)] pointer-events-none z-40"
              style={{ left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height, backgroundColor: 'var(--accent-tint, #EDE9FE)', opacity: 0.5 }}
            />
          )}
        </div>
      </div>
      {showShortcutHelp && <ShortcutHelpDialog onClose={() => setShowShortcutHelp(false)} />}
      {showEmbedDialog && <EmbedTimelineDialog onClose={() => setShowEmbedDialog(false)} />}
      {clipContextMenu && (() => {
        // Re-resolve fresh from the LIVE projectState (not a stale closure from right-click time) —
        // the clip/track may have changed shape (e.g. an undo landed) between opening the menu and
        // a click inside it. Vanished entirely (deleted/undone away) → render nothing rather than
        // act on stale data.
        const found = findClipLocation(projectState, clipContextMenu.clipId);
        if (!found) return null;
        const { track, clip } = found;
        const canSplitHere = splitTarget?.clip.id === clip.id;
        const itemCls = 'w-full text-left px-3 py-1.5 text-xs rounded-lg inline-flex items-center gap-1.5 text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
        const dangerCls = 'w-full text-left px-3 py-1.5 text-xs rounded-lg inline-flex items-center gap-1.5 text-[var(--status-error,#ef4444)] hover:bg-[var(--status-error,#ef4444)]/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
        return (
          <div
            ref={clipContextMenuRef}
            data-testid="clip-context-menu"
            className="fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl py-1.5 px-1 min-w-[200px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-auto"
            style={{ left: clipContextMenu.x, top: clipContextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              disabled={!canSplitHere || track.locked}
              title={canSplitHere ? undefined : 'Playhead phải nằm trong clip này để split'}
              onClick={() => { handleSplitAtPlayhead(); setClipContextMenu(null); }}
              className={itemCls}
            >
              <Scissors size={12} /> Split tại playhead
            </button>
            <button
              type="button"
              disabled={track.locked}
              onClick={() => { handleDuplicateClip(track, clip); setClipContextMenu(null); }}
              className={itemCls}
            >
              <Copy size={12} /> Nhân bản clip
            </button>
            <button
              type="button"
              disabled={!canGroup}
              onClick={() => { handleGroupSelection(); setClipContextMenu(null); }}
              className={itemCls}
            >
              <GroupIcon size={12} /> Nhóm clip đã chọn
            </button>
            <button
              type="button"
              disabled={!canUngroup}
              onClick={() => { handleUngroupSelection(); setClipContextMenu(null); }}
              className={itemCls}
            >
              <Ungroup size={12} /> Bỏ nhóm
            </button>
            {clip.compoundRef && (
              <>
                <div className="h-px bg-[var(--n100,#f3f4f6)] my-1 mx-1" />
                <button
                  type="button"
                  onClick={() => { handleOpenNestedTimeline(clip); setClipContextMenu(null); }}
                  className={itemCls}
                >
                  <ExternalLink size={12} /> Mở timeline lồng
                </button>
                <button
                  type="button"
                  disabled={!canUnpackClip(clip)}
                  title={canUnpackClip(clip) ? undefined : 'Không thể bung clip đang giữ một khung hình'}
                  onClick={() => { handleUnpackCompoundClip(track, clip); setClipContextMenu(null); }}
                  className={itemCls}
                >
                  <PackageOpen size={12} /> Bung timeline lồng
                </button>
              </>
            )}
            <div className="h-px bg-[var(--n100,#f3f4f6)] my-1 mx-1" />
            <button
              type="button"
              onClick={() => { handleDeleteSelection(false); setClipContextMenu(null); }}
              className={dangerCls}
            >
              <Trash2 size={12} /> Xoá {selectedIds.length > 1 ? `${selectedIds.length} clip` : 'clip'} (giữ gap)
            </button>
            <button
              type="button"
              onClick={() => { handleDeleteSelection(true); setClipContextMenu(null); }}
              className={dangerCls}
            >
              <Trash2 size={12} /> Ripple delete (đóng gap)
            </button>
          </div>
        );
      })()}
      {keyframeContextMenu && (() => {
        // Re-resolve fresh from LIVE projectState, same "never trust a stale closure" rule
        // clipContextMenu above already follows — the keyframe/clip may have changed shape (drag,
        // undo, delete) between right-click time and now.
        const found = findClipLocation(projectState, keyframeContextMenu.clipId);
        if (!found) return null;
        const { track, clip } = found;
        const marker = keyframeMarkersForClip(clip).find((m) => m.timeMs === keyframeContextMenu.timeMs);
        if (!marker) return null;
        const commonEasing = marker.keyframes.every((kf) => kf.easing === marker.keyframes[0].easing) ? marker.keyframes[0].easing : null;
        const itemCls = 'w-full text-left px-3 py-1.5 text-xs rounded-lg inline-flex items-center justify-between gap-2 text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
        return (
          <div
            ref={keyframeContextMenuRef}
            data-testid="keyframe-context-menu"
            className="fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl py-1.5 px-1 min-w-[220px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-auto"
            style={{ left: keyframeContextMenu.x, top: keyframeContextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--n600,#4b5563)]">Easing</div>
            {EASING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={track.locked}
                onClick={() => handleSetKeyframeEasing(track, clip, marker, opt.value)}
                className={itemCls}
              >
                <span>{opt.label}</span>
                {commonEasing === opt.value && <span className="text-[var(--accent,#7C5CFA)]">✓</span>}
              </button>
            ))}
            {commonEasing === null && (
              <div className="px-3 pt-1 text-[10px] text-[var(--n600,#4b5563)]">Các property đang có easing khác nhau</div>
            )}
            <div className="h-px bg-[var(--n100,#f3f4f6)] my-1 mx-1" />
            <button
              type="button"
              disabled={track.locked}
              onClick={() => {
                setKeyframeContextMenu(null);
                setBezierEditor({ x: keyframeContextMenu.x, y: keyframeContextMenu.y, clipId: clip.id, timeMs: marker.timeMs });
              }}
              className={itemCls}
            >
              <span>Custom (Bezier)…</span>
              {commonEasing === 'custom' && <span className="text-[var(--accent,#7C5CFA)]">✓</span>}
            </button>
            <button
              type="button"
              disabled={track.locked}
              onClick={() => {
                setKeyframeContextMenu(null);
                if (useVideoStore.getState().graphDocked) {
                  useVideoStore.setState({ selectedIds: [clip.id], primaryId: clip.id, graphInspectorActive: true });
                  useVideoStore.getState().setGraphInspectorActive(true);
                  return;
                }
                setGraphEditor({
                  x: keyframeContextMenu.x, y: keyframeContextMenu.y, clipId: clip.id,
                  propertyKey: marker.keyframes[0].propertyPath.split('.').pop(),
                });
              }}
              className={itemCls}
            >
              <span>Graph Editor…</span>
            </button>
          </div>
        );
      })()}
      {bezierEditor && (() => {
        const found = findClipLocation(projectState, bezierEditor.clipId);
        if (!found) return null;
        const { track, clip } = found;
        const marker = keyframeMarkersForClip(clip).find((m) => m.timeMs === bezierEditor.timeMs);
        if (!marker) return null;
        // CSS's own `ease` curve as the starting point for a marker that isn't already custom —
        // a familiar, well-known shape rather than an arbitrary/degenerate default.
        const first = marker.keyframes[0];
        const current = first.easing === 'custom'
          ? { x1: first.easingX1, y1: first.easingY1, x2: first.easingX2, y2: first.easingY2 }
          : { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
        return (
          <div ref={bezierEditorRef}>
            <BezierEasingEditor
              x={bezierEditor.x}
              y={bezierEditor.y}
              value={current}
              onCommit={(next) => handleCommitBezierEasing(track, clip, marker, next)}
              onClose={() => setBezierEditor(null)}
            />
          </div>
        );
      })()}
      {graphEditor && (() => {
        const found = findClipLocation(projectState, graphEditor.clipId);
        if (!found) return null;
        const { track, clip } = found;
        return (
          <div ref={graphEditorRef}>
            <GraphEditorPanel
              x={graphEditor.x}
              y={graphEditor.y}
              clip={clip}
              initialPropertyKey={graphEditor.propertyKey}
              onDock={() => {
                useVideoStore.setState({ selectedIds: [clip.id], primaryId: clip.id });
                useVideoStore.getState().setGraphDocked(true);
                setGraphEditor(null);
              }}
              onCommitTangents={(keyframeId, changes) => handleCommitGraphEditorTangents(track, clip, keyframeId, changes)}
              onClose={() => setGraphEditor(null)}
            />
          </div>
        );
      })()}
    </div>
  );
}
