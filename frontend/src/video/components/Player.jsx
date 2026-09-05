// Canvas composition uses the same source-aspect placement as FFmpeg output.
// WebCodecs is the primary decoder; native video decoding supplies a fallback.
// AudioMixer and the project clock remain independent of visual decoding.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVideoStore } from '../store.js';
import {
  CanvasEngine, isCanvasEngineSupported,
  findActiveVideoClips, findActiveStickerClips,
} from '../canvasEngine.js';
import { computeCanvasPlacement, normalizedCropFor } from '@shared/video-transform';
import { evaluateClipTransform, TRANSFORM_DEFAULTS } from '@shared/video-keyframes';
import { findClipLocation, resolveSelectionOnClick } from '../timelineUtils.js';
import { isMod, NUDGE_STEPS, stepFor } from '../shortcuts.js';
import { previewUrl } from '../../lib/api.js';
import TransformOverlay, { commitDrag } from './TransformOverlay.jsx';
import AudioMixer from './AudioMixer.jsx';
import { usePlaybackClock } from '../usePlaybackClock.js';
import { vectorSvg, vectorSize } from '@shared/video-vector';
import InlineTextEditor from './InlineTextEditor.jsx';
import { previewVisualEntries } from '../transitionPreview.js';

let textMeasureContext;
function measureTextWidth(line, p) {
  textMeasureContext ||= document.createElement('canvas').getContext('2d');
  textMeasureContext.font = `${p.italic ? 'italic' : 'normal'} ${p.bold ? 'bold' : 'normal'} ${p.fontSize}px "${String(p.fontFamily).replace(/["\\]/g, '')}"`;
  return textMeasureContext.measureText(line).width + Math.max(0, [...line].length - 1) * (p.letterSpacing || 0);
}

// applyLivePreviewPatch(state, patch) — merges store.js's ephemeral `livePreviewPatch` (see that
// field's own comment) onto `projectState` for rendering only. Immutable: only the touched
// track/clip/nested-object chain is cloned (matching shared/video-commands/state.js's `setAtPath`
// technique, just non-mutating), so this stays cheap to run on every rAF-driven re-render during
// a drag even on a project with many tracks/clips.
function applyLivePreviewPatch(state, patch) {
  if (!state || !patch || patch.entries.length === 0) return state;
  let next = state;
  let tracksCloned = false;
  for (const { clipId, transitionId, path, value } of patch.entries) {
    if (transitionId) {
      next = { ...next, transitions: next.transitions.map(t => t.id === transitionId ? { ...t, [path[0]]: value } : t) };
      continue;
    }
    const trackIndex = next.tracks.findIndex((t) => t.clips.some((c) => c.id === clipId));
    if (trackIndex === -1) continue;
    const clipIndex = next.tracks[trackIndex].clips.findIndex((c) => c.id === clipId);
    if (!tracksCloned) { next = { ...next, tracks: [...next.tracks] }; tracksCloned = true; }
    const track = { ...next.tracks[trackIndex], clips: [...next.tracks[trackIndex].clips] };
    let clip = { ...track.clips[clipIndex] };
    let node = clip;
    for (let i = 0; i < path.length - 1; i++) { node[path[i]] = { ...node[path[i]] }; node = node[path[i]]; }
    node[path[path.length - 1]] = value;
    track.clips[clipIndex] = clip;
    next.tracks[trackIndex] = track;
  }
  return next;
}

function CanvasPlayer({ projectState, assets, playheadMs, isPlaying, mediaRef, onSelectTopClip, zoomMode, previewVolume }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  useEffect(() => {
    engineRef.current = new CanvasEngine();
    return () => engineRef.current?.dispose();
  }, []);

  // Redraw whenever the composited frame at the playhead could have changed — every active
  // video-track clip's own proxy at its own mapped source time, independent of whichever clip is
  // driving the audio clock above (they can differ: e.g. a video clip with no matching audio-track
  // clip still composites visually while some OTHER clip's audio plays).
  const visualEntries = previewVisualEntries(projectState, playheadMs);
  const activeVideoClips = visualEntries.map(entry => entry.clip);
  useEffect(() => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    if (!engine || !canvas || !projectState) return;
    const entries = visualEntries.map((entry) => {
      const { clip } = entry;
      if (clip.shape || (clip.text && !clip.assetId)) return { ...entry, kind: 'image', proxyUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(vectorSvg(clip, measureTextWidth))}` };
      const asset = assets.find((a) => a.id === clip.assetId);
      return { ...entry, kind: asset?.kind, proxyUrl: asset?.kind === 'image'
        ? (asset.thumbnailUrl || previewUrl(asset.sourcePath)) : asset?.proxyUrl };
    });
    const ctx = canvas.getContext('2d');
    engine.drawActiveClips(ctx, entries, playheadMs, projectState.resolution).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectState, assets, playheadMs]);

  const resolution = projectState?.resolution || { width: 1920, height: 1080 };
  const hasResolvedAsset = activeVideoClips.some((clip) => clip.shape || (clip.text && !clip.assetId) || assets.find((a) => a.id === clip.assetId && (a.proxyUrl || a.kind === 'image')));

  return (
    <div className="relative w-full h-full bg-[var(--canvas)] flex items-center justify-center overflow-hidden p-4">
      {activeVideoClips.length === 0 ? (
        <p className="text-xs text-[var(--n600)]">Không có clip nào tại vị trí playhead</p>
      ) : !hasResolvedAsset ? (
        <p className="text-xs text-[var(--n600)]">Asset chưa sẵn sàng (đang xử lý hoặc offline)</p>
      ) : (
        <canvas
          ref={(el) => { canvasRef.current = el; mediaRef?.(el); }}
          width={resolution.width} height={resolution.height}
          className={zoomMode === '100' ? 'cursor-pointer shrink-0' : 'max-w-full max-h-full cursor-pointer'}
          style={zoomMode === '100' ? { width: resolution.width, height: resolution.height } : undefined}
          onClick={onSelectTopClip}
        />
      )}
    </div>
  );
}

// Phase 13 (§0): DOM overlay approximation of the caption burn — same "preview vẫn là DOM overlay
// xấp xỉ" precedent Phase 4's own `clip.text` header comment already established, not a new
// pattern. Active cue(s) across every visible 'caption' track at `playheadMs`, bottom-anchored to
// roughly match backend/video/renderPlanner.js's own default position (not pixel-exact — same
// "không sa vào vòng lặp chase pixel-perfect" precedent this spec's golden-test suite already
// states outright). pointer-events-none so it never blocks click-to-seek on the player beneath it.
function CaptionOverlay({ projectState, playheadMs, mediaRect }) {
  if (!projectState) return null;
  const activeCues = (projectState.tracks || [])
    .filter((t) => t.type === 'caption' && t.visible !== false)
    .flatMap((t) => t.clips)
    .filter((c) => playheadMs >= c.timelineInMs && playheadMs < c.timelineOutMs && c.text?.content);
  if (activeCues.length === 0) return null;
  return (
    <div className="absolute pointer-events-none" style={mediaRect ? { left: mediaRect.left, top: mediaRect.top, width: mediaRect.width, height: mediaRect.height } : { inset: 0 }}>
    <div className="absolute left-0 right-0 bottom-[8%] flex flex-col items-center gap-1 px-4">
      {activeCues.map((cue) => (
        <span key={cue.id} className="bg-black/50 text-white text-sm px-2 py-1 rounded whitespace-pre-line text-center">
          {cue.text.content}
        </span>
      ))}
    </div>
    </div>
  );
}

// useMediaRect() -> [refCallback, rect | null]. `rect` is the actual rendered canvas/`<video>`
// element's box (left/top/width/height), measured relative to ITS OWN parentElement — which is
// exactly the `relative` div CanvasPlayer/VideoTagPlayer already wrap it in — rather than
// restructuring either component's existing flex-centered `max-w-full max-h-full` layout (already
// tested, no reason to risk it) into a percentage-friendly stage box instead. StickerOverlay/
// TransformOverlay then position themselves in plain pixels using this + a resolution->px scale
// factor, so they track the media element exactly regardless of container size/letterboxing.
// `useState` (not a plain ref) for `node` is required: the DOM node only becomes available via the
// callback ref AFTER CanvasPlayer/VideoTagPlayer mount, and only a state update reliably triggers
// the effect below to (re-)attach its ResizeObserver once that happens.
function useMediaRect() {
  const [node, setNode] = useState(null);
  const [rect, setRect] = useState(null);
  const refCallback = useCallback((el) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node || !node.parentElement) { setRect(null); return undefined; }
    const update = () => {
      const elRect = node.getBoundingClientRect();
      const parentRect = node.parentElement.getBoundingClientRect();
      setRect({ left: elRect.left - parentRect.left, top: elRect.top - parentRect.top, width: elRect.width, height: elRect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [node]);

  return [refCallback, rect];
}

// Hit targets only: sticker pixels are composed with video/text/shape in Canvas.
function StickerOverlay({ projectState, assets, playheadMs, mediaRect, onSelect }) {
  if (!projectState || !mediaRect) return null;
  const resolution = projectState.resolution || { width: 1920, height: 1080 };
  const scale = mediaRect.width / resolution.width;
  const stickers = findActiveStickerClips(projectState, playheadMs);
  return (
    <>
      {stickers.map((clip) => {
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset?.width || !asset?.height) return null;

        const effective = evaluateClipTransform(clip, playheadMs - clip.timelineInMs);
        const placement = computeCanvasPlacement(effective, resolution, asset, normalizedCropFor(clip));

        return (
          <div
            key={clip.id}
            data-sticker-hitbox={clip.id}
            // Resolve the topmost visual at the click, respecting layer order.
            className="absolute cursor-pointer"
            onClick={(e) => onSelect?.(e, clip)}
            style={{
              left: mediaRect.left + placement.destX * scale,
              top: mediaRect.top + placement.destY * scale,
              width: placement.destWidth * scale,
              height: placement.destHeight * scale,
              transform: placement.rotationDeg ? `rotate(${placement.rotationDeg}deg)` : undefined,
              transformOrigin: 'center',
            }}
          />
        );
      })}
    </>
  );
}

// MultiSelectBounds — §2 "multi-select, canvas hiển thị bounds tổng": axis-aligned union of every
// selected clip's own placement rect at the playhead. Approximation, same class as every other
// preview shortcut this file already documents (e.g. StickerOverlay's blend-mode-preview-only
// note): a rotated clip's TRUE bounds are larger than its unrotated destX/destY/destWidth/
// destHeight box, so the union can under-draw slightly for a rotated selection.
//
// 08.3.1 §3/mục 3 (multi-select move): dragging the bounds moves every selected non-caption clip
// by the SAME screen delta, mirroring TransformOverlay.jsx's single-clip move gesture — one
// SetProperties commit for the whole batch on pointerup, never a partial commit (any locked track
// among the selection disables the whole gesture, matching EffectsPanel.jsx's `anyLocked` "all or
// nothing" precedent for multi-select edits). Scale/rotate stay whatever they already were
// (informational-only) — no atomic multi-transform command yet, per the acceptance criteria's own
// "disable thay vì commit một phần" rule.
function MultiSelectBounds({ projectState, resolution, mediaRect, selectedIds, playheadMs, containerRef }) {
  const dragStateRef = useRef(null);
  const execute = useVideoStore((s) => s.execute);
  const setLivePreviewPatch = useVideoStore((s) => s.setLivePreviewPatch);
  const clearLivePreviewPatch = useVideoStore((s) => s.clearLivePreviewPatch);

  if (!projectState || !mediaRect || selectedIds.length < 2) return null;
  const scale = mediaRect.width / resolution.width;
  const locations = selectedIds
    .map((id) => findClipLocation(projectState, id))
    .filter((loc) => loc && !['caption', 'audio'].includes(loc.track.type));
  if (locations.length < 2) return null;
  const placements = locations.map((loc) => computeCanvasPlacement(evaluateClipTransform(loc.clip, playheadMs - loc.clip.timelineInMs), resolution, loc.clip.sourceSize, normalizedCropFor(loc.clip)));
  const left = Math.min(...placements.map((p) => p.destX));
  const top = Math.min(...placements.map((p) => p.destY));
  const right = Math.max(...placements.map((p) => p.destX + p.destWidth));
  const bottom = Math.max(...placements.map((p) => p.destY + p.destHeight));
  const anyLocked = locations.some((loc) => loc.track.locked);

  function handleDown(e) {
    if (anyLocked) return;
    e.preventDefault();
    e.stopPropagation();
    containerRef?.current?.focus();
    dragStateRef.current = {
      startClientX: e.clientX, startClientY: e.clientY,
      bases: locations.map((loc) => ({
        clipId: loc.clip.id,
        x: (loc.clip.transform || {}).x ?? 0,
        y: (loc.clip.transform || {}).y ?? 0,
      })),
      lastDx: 0, lastDy: 0,
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelGesture);
  }

  function handleMove(e) {
    const st = dragStateRef.current;
    if (!st) return;
    st.lastDx = Math.round((e.clientX - st.startClientX) / scale);
    st.lastDy = Math.round((e.clientY - st.startClientY) / scale);
    setLivePreviewPatch(st.bases.flatMap((b) => [
      { path: ['transform', 'x'], value: b.x + st.lastDx, clipId: b.clipId },
      { path: ['transform', 'y'], value: b.y + st.lastDy, clipId: b.clipId },
    ]));
  }

  function removeDragListeners() {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', cancelGesture);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('blur', cancelGesture);
  }

  function handleUp() {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    removeDragListeners();
    clearLivePreviewPatch();
    if (!st || (st.lastDx === 0 && st.lastDy === 0)) return;
    // Re-resolve every clip's live location fresh (not the closed-over `locations`, which can be
    // stale by pointerup) — same rule TransformOverlay.jsx's commitDrag() follows.
    const { projectState: liveState } = useVideoStore.getState();
    const changes = [];
    for (const b of st.bases) {
      const loc = findClipLocation(liveState, b.clipId);
      if (!loc) continue; // clip vanished mid-gesture (e.g. undo raced it) — drop just that one
      const trackIndex = liveState.tracks.indexOf(loc.track);
      const clipIndex = loc.track.clips.indexOf(loc.clip);
      changes.push({ path: ['tracks', trackIndex, 'clips', clipIndex, 'transform', 'x'], from: b.x, to: b.x + st.lastDx });
      changes.push({ path: ['tracks', trackIndex, 'clips', clipIndex, 'transform', 'y'], from: b.y, to: b.y + st.lastDy });
    }
    if (changes.length === 0) return;
    try {
      execute('SetProperties', { changes });
    } catch (err) {
      console.warn('MultiSelectBounds: dropped multi-move commit, state changed mid-gesture:', err.message);
    }
  }

  // 08-L L4 (specs/ai-creative-operations-platform/08-v2/08-l-4-selection-focus-and-gesture-
  // grammar.md §5): shared by Escape, window-`blur` and `pointercancel` — same fix as
  // TransformOverlay.jsx's own cancelGesture().
  function cancelGesture() {
    dragStateRef.current = null;
    removeDragListeners();
    clearLivePreviewPatch();
  }

  function handleKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    cancelGesture();
  }

  return (
    <div
      onPointerDown={handleDown}
      className="absolute"
      style={{
        left: mediaRect.left + left * scale, top: mediaRect.top + top * scale,
        width: (right - left) * scale, height: (bottom - top) * scale,
        border: '1.5px dashed var(--accent, #7C5CFA)', boxSizing: 'border-box',
        cursor: anyLocked ? 'not-allowed' : 'move', pointerEvents: 'auto',
      }}
    />
  );
}

export default function Player({ zoomMode = 'fit', previewVolume = 1 }) {
  const [editingTextId, setEditingTextId] = useState(null);
  usePlaybackClock();
  const rawProjectState = useVideoStore((s) => s.projectState);
  const livePreviewPatch = useVideoStore((s) => s.livePreviewPatch);
  const assets = useVideoStore((s) => s.assets);
  const playheadMs = useVideoStore((s) => s.playheadMs);
  const setPlayheadMs = useVideoStore((s) => s.setPlayheadMs);
  const isPlaying = useVideoStore((s) => s.isPlaying);
  const selectedIds = useVideoStore((s) => s.selectedIds);
  const primaryId = useVideoStore((s) => s.primaryId);
  const setSelection = useVideoStore((s) => s.setSelection);
  const toggleClipSelection = useVideoStore((s) => s.toggleClipSelection);
  useEffect(() => {
    // Legacy image rows had no dimensions. Hydrate only images currently on
    // screen so existing projects also preserve source aspect without reimport.
    const activeIds = new Set(rawProjectState?.tracks.flatMap(track => track.clips.filter(clip => clip.timelineInMs <= playheadMs && clip.timelineOutMs > playheadMs).map(clip => clip.assetId)) || []);
    const missing = assets.filter(asset => activeIds.has(asset.id) && asset.kind === 'image' && (!asset.width || !asset.height));
    let cancelled = false;
    for (const asset of missing) {
      const image = new Image(); image.src = asset.thumbnailUrl || previewUrl(asset.sourcePath);
      image.decode().then(() => { if (!cancelled) useVideoStore.setState(s => ({ assets: s.assets.map(a => a.id === asset.id ? { ...a, width: image.naturalWidth, height: image.naturalHeight } : a) })); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [rawProjectState, assets, playheadMs]);

  // 08.1 (§5, "một gesture tạo một command"): TransformOverlay/EffectsPanel write in-progress
  // drag/slider values to `livePreviewPatch` instead of committing a real command per tick — this
  // is the ONE place that patch gets merged back in, so every consumer below (canvas/video
  // preview, sticker overlay, the transform handle itself) renders the live value without any of
  // them needing to know the patch exists. Only clones the touched clip, not the whole project.
  const projectState = useMemo(() => {
    const state = applyLivePreviewPatch(rawProjectState, livePreviewPatch);
    if (!state) return state;
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    return { ...state, tracks: state.tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
      if (track.type === 'text' || track.type === 'shape') return { ...clip, sourceSize: vectorSize(clip) };
      const asset = byId.get(clip.assetId);
      return asset?.width && asset?.height ? { ...clip, sourceSize: { width: asset.width, height: asset.height } } : clip;
    }) })) };
  }, [rawProjectState, livePreviewPatch, assets]);

  const [mediaRef, mediaRect] = useMediaRect();
  const resolution = projectState?.resolution || { width: 1920, height: 1080 };
  // 08.3.1 ref 31 (canvas arrow-key nudge) — FOCUS-SCOPED on purpose: Timeline.jsx's own
  // ArrowLeft/Right playhead frame-step listener is global (window, regardless of focus). Making
  // nudge global too would fire BOTH on every arrow press. Instead this container is a real
  // keyboard focus target (tabIndex) that a canvas/sticker click naturally receives (the browser's
  // default mousedown->focus delegation walks up to the nearest focusable ancestor when the click
  // target itself isn't focusable) and TransformOverlay/MultiSelectBounds explicitly re-grab via
  // `containerRef` when they preventDefault() their own pointerdown. Clicking a Timeline clip has
  // no focusable ancestor of its own, so the browser's default action blurs this container back to
  // <body> — arrow keys then fall through to Timeline's listener again, unchanged.
  const containerRef = useRef(null);

  const selectedLocation = primaryId && projectState ? findClipLocation(projectState, primaryId) : null;
  // Only a clip actually VISIBLE at the playhead gets a transform handle — dragging a box for
  // content that isn't drawn anywhere on screen right now would be confusing. Captions have no
  // transform-driven visual (CaptionOverlay is fixed-position, see its own comment) so are excluded.
  const showTransformOverlay = selectedLocation
    && !['caption', 'audio'].includes(selectedLocation.track.type)
    && playheadMs >= selectedLocation.clip.timelineInMs && playheadMs < selectedLocation.clip.timelineOutMs;
  // 08.2.1 §2: "Go to clip" — the primary selection exists and has a canvas-relevant transform
  // (non-caption), but the playhead currently sits outside its range so no handle is drawn.
  const showGoToClip = selectedLocation && !['caption', 'audio'].includes(selectedLocation.track.type) && !showTransformOverlay;
  const isHiddenTrack = selectedLocation?.track.visible === false;

  // 08.2.1 §2 (reverse canvas→timeline sync): resolves Mod/Shift the same way Timeline.jsx does
  // (resolveSelectionOnClick, shared helper) for a click on the canvas/video element or a sticker.
  function dispatchSelectionAction(action) {
    if (action.type === 'toggle') toggleClipSelection(action.clipId);
    else setSelection(action.ids, action.primaryId);
  }
  function handleSelectTopClip(e) {
    if (!projectState) return;
    const activeVideoClips = findActiveVideoClips(projectState, playheadMs);
    const container = containerRef.current?.getBoundingClientRect();
    const x = mediaRect && container ? (e.clientX - container.left - mediaRect.left) * resolution.width / mediaRect.width : 0;
    const y = mediaRect && container ? (e.clientY - container.top - mediaRect.top) * resolution.height / mediaRect.height : 0;
    const topClip = [...activeVideoClips].reverse().find(clip => {
      const t = evaluateClipTransform(clip, playheadMs - clip.timelineInMs), p = computeCanvasPlacement(t, resolution, clip.sourceSize, normalizedCropFor(clip));
      const cx = p.destX + p.destWidth * (t.pivotX ?? .5), cy = p.destY + p.destHeight * (t.pivotY ?? .5);
      const c = Math.cos(-p.rotationRadians), s = Math.sin(-p.rotationRadians);
      const localX = cx + (x - cx) * c - (y - cy) * s, localY = cy + (x - cx) * s + (y - cy) * c;
      return localX >= p.destX && localX <= p.destX + p.destWidth && localY >= p.destY && localY <= p.destY + p.destHeight;
    });
    if (!topClip) return;
    const location = findClipLocation(projectState, topClip.id);
    if (!location) return;
    dispatchSelectionAction(resolveSelectionOnClick(projectState, location.track, location.clip, primaryId, { mod: isMod(e), shift: e.shiftKey }));
    if (location.clip.text && !location.clip.assetId && !location.track.locked && !isMod(e) && !e.shiftKey) setEditingTextId(location.clip.id);
  }

  // 08.3.1 ref 31: single-object nudge only (mirrors the plan's own scope — multi-select move is a
  // drag-only gesture on MultiSelectBounds, no keyboard equivalent this pass). Gated on
  // `showTransformOverlay` (same condition the handle itself uses: primary selected, non-caption,
  // visible at the playhead, and — via TransformOverlay's own `locked` prop precedent — a locked
  // track's clip never gets a drag/nudge path either).
  function handleContainerKeyDown(e) {
    if (e.target.matches('input,textarea') || e.target.isContentEditable) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    if (!showTransformOverlay || selectedLocation.track.locked) return;
    e.preventDefault();
    e.stopPropagation(); // keep Timeline.jsx's global frame-step listener from ALSO firing
    const step = stepFor(NUDGE_STEPS.position, e);
    // Re-resolve fresh from the LIVE store, not this render's `selectedLocation` closure — unlike
    // a drag gesture (start/end within one continuous pointer interaction, nothing else can commit
    // in between), a keyboard nudge can fire the instant after some OTHER state change lands, and
    // `from` here must match the store's real current value or SetProperty's validate() rejects it
    // (silently dropped by commitDrag's own catch). Same rule commitDrag() already applies to the
    // track/clip INDEX resolution — extended here to the VALUE too.
    const liveLocation = findClipLocation(useVideoStore.getState().projectState, selectedLocation.clip.id);
    if (!liveLocation) return;
    const base = { ...TRANSFORM_DEFAULTS, ...(liveLocation.clip.transform || {}) };
    const changes = [];
    if (e.key === 'ArrowLeft') changes.push({ key: 'x', from: base.x, to: base.x - step });
    else if (e.key === 'ArrowRight') changes.push({ key: 'x', from: base.x, to: base.x + step });
    else if (e.key === 'ArrowUp') changes.push({ key: 'y', from: base.y, to: base.y - step });
    else changes.push({ key: 'y', from: base.y, to: base.y + step });
    commitDrag(selectedLocation.clip.id, changes);
  }

  const props = { projectState, assets, playheadMs, isPlaying, mediaRef, onSelectTopClip: handleSelectTopClip, zoomMode, previewVolume };
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
      onDoubleClick={() => { if (showTransformOverlay && selectedLocation.clip.text && !selectedLocation.clip.assetId && !selectedLocation.track.locked) setEditingTextId(selectedLocation.clip.id); }}
      className="relative w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent,#7C5CFA)]"
    >
      {isCanvasEngineSupported() ? <CanvasPlayer {...props} /> : <p>Trình duyệt không hỗ trợ canvas preview.</p>}
      <AudioMixer {...props} />
      <StickerOverlay projectState={projectState} assets={assets} playheadMs={playheadMs} mediaRect={mediaRect} onSelect={handleSelectTopClip} />
      <CaptionOverlay projectState={projectState} playheadMs={playheadMs} mediaRect={mediaRect} />
      {showTransformOverlay && (
        <TransformOverlay
          mediaRect={mediaRect} resolution={resolution} clip={selectedLocation.clip} playheadMs={playheadMs}
          locked={!!selectedLocation.track.locked} hidden={isHiddenTrack} containerRef={containerRef}
          onEditText={selectedIds.length === 1 && selectedLocation.clip.text && !selectedLocation.clip.assetId ? () => setEditingTextId(selectedLocation.clip.id) : undefined}
        />
      )}
      <MultiSelectBounds
        projectState={projectState} resolution={resolution} mediaRect={mediaRect} selectedIds={selectedIds}
        playheadMs={playheadMs} containerRef={containerRef}
      />
      {editingTextId && selectedIds.length === 1 && selectedLocation?.clip.id === editingTextId && showTransformOverlay && !isHiddenTrack && <InlineTextEditor key={editingTextId} clip={selectedLocation.clip} mediaRect={mediaRect} resolution={resolution} playheadMs={playheadMs} onClose={() => setEditingTextId(null)} />}
      {showGoToClip && (
        <button
          type="button"
          onClick={() => setPlayheadMs(selectedLocation.clip.timelineInMs)}
          className="absolute top-2 right-2 text-xs px-2 py-1 rounded-lg bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] text-[var(--text,#111827)] shadow hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        >
          Đi tới clip
        </button>
      )}
    </div>
  );
}
