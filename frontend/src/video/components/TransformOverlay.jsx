// Video Editor Phase 14 (specs/space-flow-master-plan/04-video-editor.md §5): the first UI
// anywhere in the video editor to actually SET a clip's transform — every prior phase (5-13) only
// ever READ `clip.transform`/keyframes (preview/export), or captured whatever the CURRENT value
// already was into a keyframe ('k' shortcut) — there was never a way to author a new value. Built
// for stickers (a freshly-dropped sticker needs to be moved/resized to be useful at all — see the
// phase's own write-up for why this couldn't just be deferred) but works for ANY non-caption clip,
// since `clip.transform` means the same thing everywhere (shared/video-transform.js).
//
// Drag-to-move and drag-to-resize write via the generic SetProperty/SetProperties commands every
// other per-property control in this codebase uses (EffectsPanel.jsx's color-grade sliders, LUT
// path). 08.1 (specs/ai-creative-operations-platform/08-1-editor-ux-foundation.md §5: "một
// gesture tạo một command... không tạo hàng trăm undo step") replaced the earlier per-tick-commit
// design: every pointermove now only updates the store's ephemeral `livePreviewPatch` (no undo
// entry, no network write — see store.js's own comment on that field); Player.jsx merges it onto
// `projectState` purely for rendering, so the canvas/overlay still track the drag live. The ACTUAL
// command — one SetProperty if only one axis changed, one SetProperties if both did — is committed
// exactly once, in handleUp(), diffed against the values captured at pointerdown.
//
// Resize is anchored at the CENTER, not a fixed opposite corner — computeCanvasPlacement() derives
// destX/destY from `(canvasSize - destSize)/2 + offset`, i.e. content is always centered around its
// own (x,y) offset, so growing destWidth/destHeight necessarily moves BOTH edges outward. There is
// no separate crop/anchor field to change this (shared/video-transform.js's own header comment:
// "No crop field yet"), so the drag handle intentionally behaves this way rather than faking a
// fixed-corner resize the data model doesn't actually support.
//
import { useRef, useState } from 'react';
import { useVideoStore } from '../store.js';
import { computeCanvasPlacement, normalizedCropFor } from '@shared/video-transform';
import { evaluateClipTransform, TRANSFORM_DEFAULTS } from '@shared/video-keyframes';
import { findClipLocation } from '../timelineUtils.js';

const MIN_SCALE = 0.02;
const MAX_SCALE = 4;
// 08-G G3 ("corner scale"): all 4 corners, each with the (signX, signY) `handleMove`'s resize
// branch needs to know which drag direction means "grow" FOR THAT corner (see that branch's own
// comment) — 'br' is the original single handle this feature already had (unflipped, (1,1)).
const RESIZE_CORNERS = [
  { key: 'br', h: 'right', v: 'bottom', cursor: 'nwse-resize', signX: 1, signY: 1 },
  { key: 'tl', h: 'left', v: 'top', cursor: 'nwse-resize', signX: -1, signY: -1 },
  { key: 'tr', h: 'right', v: 'top', cursor: 'nesw-resize', signX: 1, signY: -1 },
  { key: 'bl', h: 'left', v: 'bottom', cursor: 'nesw-resize', signX: -1, signY: 1 },
];
// 08-G G3 (specs/.../08-v2/08-g-canvas-motion-text-and-audio.md, "rotation handle"): a small handle
// above the box's own top-center, connected by a thin line — same convention every design/video
// tool (Figma, Photoshop, CapCut) uses, chosen as a clean-room behavior match, not a copied asset.
// `transform.rotation` (shared/video-transform.js's `computeCanvasPlacement`) is stored in DEGREES
// directly, so no unit conversion is needed between this file's drag math and the schema value.
// The handle is a CHILD of the box's own rotated div, so it inherits the box's current `rotate()`
// CSS transform automatically — dragging it always starts from wherever the handle visually is
// right now, and `handleMove`'s delta-based math (new = startRotation + (currentAngle -
// startAngle), never an absolute recompute) keeps the drag feeling continuous with no jump at
// grab time, matching the move/resize handles' own "delta from drag-start, not from `lastX`" rule.
// Shift constrains to 15° increments — the same modifier key move-drag already uses for axis-lock,
// consistent single-key convention across every gesture in this file.
const ROTATE_SNAP_DEG = 15;
// 08-G G3 rotation pivot (ADR 0035, docs/decisions/0035-clip-rotation-pivot-minimal-slice.md): a
// small diamond handle, draggable anywhere WITHIN the box, sets `transform.pivotX/pivotY` (0-1
// fraction of the box, default 0.5/0.5 = center) — the point rotation is measured around. It is a
// CHILD of the box's own rotated div (same as the resize/rotate handles), so it visually tracks the
// box's CURRENT rotation automatically via CSS `transformOrigin` (set to the pivot fraction itself
// below) — dragging it, however, must translate the raw screen-space pointer delta THROUGH the
// box's current rotation to land in the box's own unrotated local frame (a rotated box's local x/y
// axes are tilted relative to the screen) — `pivotFractionAt()` below does that with a standard
// inverse-rotation matrix, verified against a real drag at both rotation=0 (identity case) and a
// non-zero rotation (tests/e2e/ui/video-transform-pivot.spec.js).
const PIVOT_HANDLE_SIZE = 14;

// commitDrag(clipId, changes) -> exactly ONE SetProperty/SetProperties call for the whole
// gesture, fired from handleUp() below. `changes` is [{key, from, to}] with any no-op entry
// already filtered out by the caller. Re-resolves the clip's CURRENT location from the live
// store (not a prop/ref, which can be stale by the time the user releases) — see file header.
// Exported for reuse by Player.jsx's arrow-key nudge (08.3.1 ref 31) — a keyboard nudge is a
// same-shape "gesture" of exactly one commit, just without a pointer drag driving it.
export function commitDrag(clipId, changes) {
  if (changes.length === 0) return;
  const { projectState, execute } = useVideoStore.getState();
  const location = findClipLocation(projectState, clipId);
  if (!location) return;
  const trackIndex = projectState.tracks.indexOf(location.track);
  const clipIndex = location.track.clips.indexOf(location.clip);
  const pathFor = (key) => ['tracks', trackIndex, 'clips', clipIndex, 'transform', key];
  try {
    if (changes.length === 1) {
      const c = changes[0];
      execute('SetProperty', { path: pathFor(c.key), from: c.from, to: c.to });
    } else {
      execute('SetProperties', { changes: changes.map((c) => ({ path: pathFor(c.key), from: c.from, to: c.to })) });
    }
  } catch (err) {
    // State moved under us since drag-start (e.g. an undo fired mid-drag) — drop the commit
    // rather than throw; the live preview is already cleared by the caller regardless.
    console.warn('TransformOverlay: dropped drag commit, state changed mid-gesture:', err.message);
  }
}

// 08.3.1 ref 30: Shift locks the move drag to whichever axis had the larger delta once the
// gesture clears a small threshold — decided ONCE per gesture (not recomputed every tick, which
// would jitter between axes near the diagonal) and re-armed if Shift is released and re-pressed.
const AXIS_LOCK_THRESHOLD_PX = 4;
// 08-G G3 ("guides/snap"): move-drag snaps to `x=0`/`y=0` — i.e. exactly canvas-centered on that
// axis, the ONE alignment every design/video tool treats as a default snap target (clean-room
// convention, same class of decision as the rotation handle's own placement/15°-snap). Center-only
// on purpose for this first slice: snapping to other clips' edges or a rule-of-thirds grid needs
// its own separate threshold/target decision, deferred (see 08-g Project Status). Pure frontend —
// `x`/`y` are already the schema fields move-drag writes; no new field, no renderer/preview change,
// so no preview/export parity risk the way anchor/pivot or crop would carry.
const SNAP_THRESHOLD_PX = 6;
// 08-G G3 ("safe zone", 08-H8 acceptance §5): a fixed reference rectangle inset from every canvas
// edge by 5% — the "action-safe" fraction broadcast/video convention uses as its single most common
// default (title-safe at 10% is the OTHER common convention; picking just one for this first slice,
// same class of decision as guides/snap's own "center-only, not rule-of-thirds too" scoping).
// VIEW-ONLY reference, same as this file's center-snap guide lines: purely a canvas-space overlay
// div, never touches `clip.transform` or any renderer/preview code path, so it carries zero
// preview/export parity risk. Deliberately NOT wired into move-drag's own snap-to-0 logic yet
// (snapping a box's EDGE to this boundary needs `placement.destWidth/destHeight`, a materially
// different computation than the existing center-offset snap) — left as a separate, deferred
// decision, same as "snap to other clips' edges" already is (see SNAP_THRESHOLD_PX's own comment).
const SAFE_ZONE_MARGIN_FRACTION = 0.05;

export default function TransformOverlay({ mediaRect, resolution, clip, playheadMs, locked, hidden, containerRef, onEditText }) {
  const dragStateRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const setLivePreviewPatch = useVideoStore((s) => s.setLivePreviewPatch);
  const clearLivePreviewPatch = useVideoStore((s) => s.clearLivePreviewPatch);

  if (!mediaRect) return null;
  const base = { ...TRANSFORM_DEFAULTS, ...(clip.transform || {}) };
  const effective = evaluateClipTransform(clip, playheadMs - clip.timelineInMs);
  const placement = computeCanvasPlacement(effective, resolution, clip.sourceSize ? { ...clip.sourceSize, padding: 0 } : undefined, normalizedCropFor(clip));
  const scale = mediaRect.width / resolution.width;

  // 08.2.1 §2/§5 (locked track): inspectable/selectable, edit disabled with a visible reason — no
  // drag listeners attached at all, so a locked clip's handle is purely decorative.
  function handleMoveDown(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    // preventDefault() above suppresses the browser's own default mousedown->focus delegation, so
    // the canvas keyboard-nudge/Escape scope (Player.jsx's containerRef) needs an explicit grab —
    // see that file's own comment on why arrow-key nudge is focus-scoped at all.
    containerRef?.current?.focus();
    dragStateRef.current = {
      mode: 'move', startClientX: e.clientX, startClientY: e.clientY,
      startX: base.x, startY: base.y, lastX: base.x, lastY: base.y, axisLock: null,
    };
    setIsDragging(true);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelGesture);
  }

  // 08-G G3 ("corner scale"): all 4 corners share this ONE handler, parameterized by which
  // direction growing away from center means for THAT corner — bottom-right (the original, only
  // handle before this) is (signX:1, signY:1): dragging right/down grows. The opposite corner
  // (top-left) is (-1,-1): dragging left/up grows, since "away from center" is the opposite
  // direction there. Still center-anchored (file header comment's own reasoning: no crop/anchor
  // field exists to resize from a fixed opposite corner instead) — every corner is just a
  // different VIEW onto the exact same center-anchored scale, not 4 independent resize behaviors.
  function handleResizeDown(e, signX, signY) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    containerRef?.current?.focus();
    dragStateRef.current = {
      mode: 'resize', startClientX: e.clientX, startClientY: e.clientY, signX, signY,
      startScaleX: base.scaleX, startScaleY: base.scaleY, lastScaleX: base.scaleX, lastScaleY: base.scaleY,
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelGesture);
  }

  // angleDegAt(clientX, clientY) -> degrees clockwise from "straight up" as seen from the box's own
  // center in VIEWPORT space (matching PointerEvent.clientX/Y, which are always viewport-relative
  // regardless of any ancestor's own position) — 0° means the pointer is directly above center,
  // matching where the handle itself sits at rotation=0. `mediaRect.left/top` (Player.jsx's
  // `useMediaRect()`, its own header comment) is deliberately measured relative to the media
  // element's PARENT, not the viewport — correct for the `style.left/top` CSS assignment below
  // (that parent is this whole overlay's own `position:relative` ancestor), but WRONG to compare
  // directly against `clientX/clientY` without first re-adding that parent's own viewport offset —
  // `containerRef` is that same parent (Player.jsx passes the identical ref to both), so its own
  // `getBoundingClientRect()` supplies the missing offset. The box's center is otherwise stable
  // across a pure rotate gesture (rotation never changes destX/destY/destWidth/destHeight), so
  // everything here is computed fresh from the CURRENT render's props, not cached at drag-start.
  // 08-G G3 rotation pivot (ADR 0035): rotation is measured around `pivotX/pivotY` (0-1 fraction
  // of the box, default 0.5/0.5 = center — this line used to hardcode `destWidth/2`/`destHeight/2`
  // before the pivot feature existed) instead of always the box's own geometric center.
  function angleDegAt(clientX, clientY) {
    const originRect = containerRef?.current?.getBoundingClientRect();
    const originLeft = originRect ? originRect.left : 0;
    const originTop = originRect ? originRect.top : 0;
    const centerClientX = originLeft + mediaRect.left + (placement.destX + placement.destWidth * effective.pivotX) * scale;
    const centerClientY = originTop + mediaRect.top + (placement.destY + placement.destHeight * effective.pivotY) * scale;
    return (Math.atan2(clientX - centerClientX, -(clientY - centerClientY)) * 180) / Math.PI;
  }

  // pivotFractionAt(clientX, clientY) -> {x, y} clamped 0-1, the pivot fraction the pointer is
  // currently over. Converts the viewport-space pointer to canvas-space (same as angleDegAt), then
  // un-rotates the delta from the box's own (unrotated) center by the box's CURRENT rotation before
  // reading it as a fraction of destWidth/destHeight — otherwise a rotated box's tilted local axes
  // would make the dragged point land somewhere else on screen than the box's own top-left-relative
  // fraction the pivot is stored as. Uses `base.rotation` (the STATIC value, not `effective` at some
  // interpolated mid-drag instant) since pivot itself is a static per-clip field, matching how
  // resize/move already read `base.*` for their own drag-start snapshot.
  function pivotFractionAt(clientX, clientY) {
    const originRect = containerRef?.current?.getBoundingClientRect();
    const originLeft = originRect ? originRect.left : 0;
    const originTop = originRect ? originRect.top : 0;
    const canvasX = (clientX - originLeft - mediaRect.left) / scale;
    const canvasY = (clientY - originTop - mediaRect.top) / scale;
    const boxCenterX = placement.destX + placement.destWidth / 2;
    const boxCenterY = placement.destY + placement.destHeight / 2;
    const dx = canvasX - boxCenterX;
    const dy = canvasY - boxCenterY;
    const rad = (base.rotation * Math.PI) / 180;
    // Inverse of the forward (local -> screen) rotation CSS `rotate(deg)` applies — rotating BACK
    // by the box's own current angle recovers the point's position in the box's UNROTATED frame.
    const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
    const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
    const localX = boxCenterX + localDx;
    const localY = boxCenterY + localDy;
    return {
      x: Math.min(1, Math.max(0, (localX - placement.destX) / placement.destWidth)),
      y: Math.min(1, Math.max(0, (localY - placement.destY) / placement.destHeight)),
    };
  }

  function handleRotateDown(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    containerRef?.current?.focus();
    dragStateRef.current = {
      mode: 'rotate', startAngle: angleDegAt(e.clientX, e.clientY),
      startRotation: base.rotation, lastRotation: base.rotation,
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelGesture);
  }

  // 08-G G3 rotation pivot (ADR 0035): dragging SETS the pivot to an ABSOLUTE fraction under the
  // pointer each tick (via `pivotFractionAt`), unlike move/resize/rotate which are all DELTA-based
  // from a drag-start snapshot — there is no meaningful "delta" for a point you're placing directly
  // under the cursor, and every other absolute-value control in this codebase (EffectsPanel.jsx's
  // slider/typed fields) already commits an absolute target the same way.
  function handlePivotDown(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    containerRef?.current?.focus();
    // `from`/`startPivotX` MUST be the RAW stored value (clip.transform?.pivotX — genuinely
    // `undefined` on any clip created before this field's own commands were touched, e.g. every
    // clip InsertClip creates today, which never sets pivotX/pivotY at all), NOT `base.pivotX`
    // (already defaulted to 0.5 for DISPLAY purposes above). SetProperty's validate() strict-
    // equality-checks `from` against the ACTUAL current state — using the defaulted 0.5 here would
    // falsely claim the clip already HAS pivotX=0.5 and throw "expected ... to be 0.5, got
    // undefined" on the very first drag (found via a real e2e run, not code review) — same class of
    // bug this file's own setClipField-equivalent in EffectsPanel.jsx already documents for volume/
    // fades, now hit for the first time in THIS file since pivotX/pivotY is the first transform key
    // added after clip-creation code was written (rotation/scaleX/etc. are all populated at
    // creation time, so this gap never showed up for them).
    dragStateRef.current = {
      mode: 'pivot', startPivotX: clip.transform?.pivotX, startPivotY: clip.transform?.pivotY,
      lastPivotX: clip.transform?.pivotX, lastPivotY: clip.transform?.pivotY,
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', cancelGesture);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelGesture);
  }

  // Double-click resets the pivot straight back to center — same "quick reset" affordance
  // EffectsPanel.jsx's per-field "↺" buttons give every other transform property, just via a
  // different gesture since the pivot handle has no adjacent Inspector row of its own in this slice.
  // Same raw-value rule as handlePivotDown above — `rawX`/`rawY` genuinely `undefined` means the
  // clip never had a pivot set at all, already effectively centered, nothing to commit.
  function handlePivotDoubleClick(e) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const rawX = clip.transform?.pivotX;
    const rawY = clip.transform?.pivotY;
    commitDrag(clip.id, [
      rawX !== undefined && rawX !== 0.5 && { key: 'pivotX', from: rawX, to: 0.5 },
      rawY !== undefined && rawY !== 0.5 && { key: 'pivotY', from: rawY, to: 0.5 },
    ].filter(Boolean));
  }

  // handleMove: every new target is derived from the FIXED drag-start value + total delta so far
  // (never from `lastX`/`lastY`, which would compound rounding error tick-over-tick). Only ever
  // writes the store's EPHEMERAL `livePreviewPatch` (Player.jsx merges it in for rendering) — no
  // undo entry, no network write per tick; `lastX`/`lastY` track the latest value purely so
  // handleUp() knows the gesture's final result.
  function handleMove(e) {
    const st = dragStateRef.current;
    if (!st) return;
    if (st.mode === 'rotate') {
      const rawRotation = st.startRotation + (angleDegAt(e.clientX, e.clientY) - st.startAngle);
      st.lastRotation = e.shiftKey ? Math.round(rawRotation / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG : Math.round(rawRotation);
      setLivePreviewPatch([{ path: ['transform', 'rotation'], value: st.lastRotation, clipId: clip.id }]);
      return;
    }
    if (st.mode === 'pivot') {
      const frac = pivotFractionAt(e.clientX, e.clientY);
      st.lastPivotX = Math.round(frac.x * 100) / 100;
      st.lastPivotY = Math.round(frac.y * 100) / 100;
      setLivePreviewPatch([
        { path: ['transform', 'pivotX'], value: st.lastPivotX, clipId: clip.id },
        { path: ['transform', 'pivotY'], value: st.lastPivotY, clipId: clip.id },
      ]);
      return;
    }
    const dxCanvas = (e.clientX - st.startClientX) / scale;
    const dyCanvas = (e.clientY - st.startClientY) / scale;
    if (st.mode === 'move') {
      if (!e.shiftKey) {
        st.axisLock = null; // releasing Shift mid-drag re-arms free movement immediately
      } else if (!st.axisLock && Math.max(Math.abs(dxCanvas), Math.abs(dyCanvas)) >= AXIS_LOCK_THRESHOLD_PX) {
        st.axisLock = Math.abs(dxCanvas) >= Math.abs(dyCanvas) ? 'x' : 'y';
      }
      st.lastX = st.axisLock === 'y' ? st.startX : Math.round(st.startX + dxCanvas);
      st.lastY = st.axisLock === 'x' ? st.startY : Math.round(st.startY + dyCanvas);
      // Snap to canvas-centered (x=0 / y=0) — see SNAP_THRESHOLD_PX's own comment. Only for
      // whichever axis is actually free to move: an axis-locked-away axis just holds `startX`/
      // `startY` unchanged (not necessarily near 0), and must not be force-snapped just because
      // that untouched value happens to already be small.
      if (st.axisLock !== 'y' && Math.abs(st.lastX) <= SNAP_THRESHOLD_PX) st.lastX = 0;
      if (st.axisLock !== 'x' && Math.abs(st.lastY) <= SNAP_THRESHOLD_PX) st.lastY = 0;
      setLivePreviewPatch([
        { path: ['transform', 'x'], value: st.lastX, clipId: clip.id },
        { path: ['transform', 'y'], value: st.lastY, clipId: clip.id },
      ]);
    } else {
      // Resize from center (see file header): destWidth/Height grows by 2x the drag delta since
      // BOTH edges move outward together. `signX`/`signY` (set at drag-start, see
      // handleResizeDown's own comment) flip which drag direction means "grow" for whichever of
      // the 4 corners is being dragged — bottom-right (1,1) is the original, unflipped behavior.
      const delta = Math.abs(dxCanvas) >= Math.abs(dyCanvas)
        ? st.signX * (2 * dxCanvas) / placement.baseWidth
        : st.signY * (2 * dyCanvas) / placement.baseHeight;
      const factor = Math.max(MIN_SCALE, 1 + delta / st.startScaleX);
      st.lastScaleX = Math.min(MAX_SCALE, Math.max(MIN_SCALE, st.startScaleX * factor));
      st.lastScaleY = Math.min(MAX_SCALE, Math.max(MIN_SCALE, st.startScaleY * factor));
      setLivePreviewPatch([
        { path: ['transform', 'scaleX'], value: st.lastScaleX, clipId: clip.id },
        { path: ['transform', 'scaleY'], value: st.lastScaleY, clipId: clip.id },
      ]);
    }
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
    setIsDragging(false);
    if (!st) return;
    if (st.mode === 'move' && st.lastX === st.startX && st.lastY === st.startY && onEditText) { onEditText(); return; }
    const changes = st.mode === 'move'
      ? [
        st.lastX !== st.startX && { key: 'x', from: st.startX, to: st.lastX },
        st.lastY !== st.startY && { key: 'y', from: st.startY, to: st.lastY },
      ]
      : st.mode === 'rotate'
        ? [st.lastRotation !== st.startRotation && { key: 'rotation', from: st.startRotation, to: st.lastRotation }]
        : st.mode === 'pivot'
          ? [
            st.lastPivotX !== st.startPivotX && { key: 'pivotX', from: st.startPivotX, to: st.lastPivotX },
            st.lastPivotY !== st.startPivotY && { key: 'pivotY', from: st.startPivotY, to: st.lastPivotY },
          ]
          : [
            st.lastScaleX !== st.startScaleX && { key: 'scaleX', from: st.startScaleX, to: st.lastScaleX },
            st.lastScaleY !== st.startScaleY && { key: 'scaleY', from: st.startScaleY, to: st.lastScaleY },
          ];
    commitDrag(clip.id, changes.filter(Boolean));
  }

  // 08.3.1 §4 ("Cancel/Escape trả về snapshot trước gesture") + 08-L L4 (specs/ai-creative-
  // operations-platform/08-v2/08-l-4-selection-focus-and-gesture-grammar.md §5, "loss of pointer
  // capture có recovery xác định" — audit found NO gesture anywhere had this): drops the
  // in-progress drag with NO commit at all — distinct from handleUp(), which always commits
  // whatever the gesture reached. Wired to Escape (explicit user cancel), `blur` (window loses
  // focus mid-drag — Alt+Tab, an OS/browser permission popup) and `pointercancel` (the browser
  // itself aborts the pointer sequence, e.g. a touch interrupted by a system gesture) — before this,
  // NONE of these 3 ever fired any cleanup, leaving `dragStateRef`/the window listeners/
  // `livePreviewPatch` stuck until the user happened to move the pointer again and release it.
  function cancelGesture() {
    dragStateRef.current = null;
    removeDragListeners();
    clearLivePreviewPatch();
    setIsDragging(false);
  }

  function handleKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    cancelGesture();
  }

  // 08.2.1 §2: hidden-track clip keeps its handle (still selectable/inspectable) but styled muted
  // + dashed-differently, with a badge — never pretends the content is visible normally. Locked
  // clip loses the move cursor (no drag is possible) and gets its own badge instead.
  const style = {
    position: 'absolute',
    left: mediaRect.left + placement.destX * scale,
    top: mediaRect.top + placement.destY * scale,
    width: placement.destWidth * scale,
    height: placement.destHeight * scale,
    transform: placement.rotationDeg ? `rotate(${placement.rotationDeg}deg)` : undefined,
    // 08-G G3 rotation pivot (ADR 0035): CSS `transformOrigin` IS the rotation center — pointing it
    // at the pivot fraction (default 50% 50% = 'center', byte-identical to before this feature)
    // makes the box AND every one of its handle children rotate around the pivot automatically,
    // with no extra per-child math needed beyond `angleDegAt`'s own pivot-aware drag computation.
    transformOrigin: `${effective.pivotX * 100}% ${effective.pivotY * 100}%`,
    // 08-UI §6.2 Priority 0 bước 3: solid cho selection bình thường (rõ ràng hơn dashed, đúng
    // guideline "border 1-2px"); giữ dashed riêng cho trạng thái hidden — vẫn cần phân biệt được
    // "đang chọn bình thường" khỏi "đang chọn 1 track ẩn" bằng silhouette, không chỉ badge góc.
    border: hidden ? '1.5px dashed var(--n400, #9ca3af)' : '1.5px solid var(--accent, #7C5CFA)',
    opacity: hidden ? 0.6 : 1,
    boxSizing: 'border-box',
    cursor: locked ? 'not-allowed' : 'move',
  };
  const badge = locked ? 'Khoá' : hidden ? 'Ẩn' : null;

  return (
    <>
      {/* 08-G G3 ("guides/snap"): center guide lines, positioned against `mediaRect` directly (NOT
          nested inside the box's own rotated div above — a canvas-space alignment line must stay
          axis-aligned regardless of the clip's own rotation). Shown only while actively move-
          dragging AND currently snapped (`base.x`/`base.y` reads the live-preview-patched value
          each tick, same as the box itself, since Player.jsx merges the patch before passing
          `clip` down — no separate "am I snapped" state needed). */}
      {isDragging && base.x === 0 && (
        <div data-snap-guide="x" style={{ position: 'absolute', left: mediaRect.left + (resolution.width / 2) * scale, top: mediaRect.top, width: 1, height: mediaRect.height, background: 'var(--accent, #7C5CFA)', pointerEvents: 'none' }} />
      )}
      {isDragging && base.y === 0 && (
        <div data-snap-guide="y" style={{ position: 'absolute', left: mediaRect.left, top: mediaRect.top + (resolution.height / 2) * scale, width: mediaRect.width, height: 1, background: 'var(--accent, #7C5CFA)', pointerEvents: 'none' }} />
      )}
      {/* 08-G G3 / 08-H8 ("safe zone"): a fixed 5%-inset reference rectangle, shown only while
          actively dragging (same visibility gate as the center-snap guides above) — a static
          composition aid, not tied to this clip's own position the way the center guides are. */}
      {isDragging && (
        <div
          data-safe-zone-guide
          style={{
            position: 'absolute',
            left: mediaRect.left + resolution.width * SAFE_ZONE_MARGIN_FRACTION * scale,
            top: mediaRect.top + resolution.height * SAFE_ZONE_MARGIN_FRACTION * scale,
            width: resolution.width * (1 - 2 * SAFE_ZONE_MARGIN_FRACTION) * scale,
            height: resolution.height * (1 - 2 * SAFE_ZONE_MARGIN_FRACTION) * scale,
            border: '1px dashed var(--accent, #7C5CFA)',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={style} onPointerDown={handleMoveDown}>
      {badge && (
        <span
          className="absolute -top-5 left-0 text-[10px] px-1 rounded bg-[var(--n700,#374151)] text-white leading-tight"
          style={{ pointerEvents: 'none' }}
        >
          {badge}
        </span>
      )}
      {!locked && RESIZE_CORNERS.map((corner) => (
        // 08-UI §6.2 Priority 0 bước 3: handle hiển thị vẫn 10×10 (dot con ở giữa), nhưng vùng bấm
        // thật (div ngoài) rộng 20×20 — handle nhỏ nhưng hit-area lớn hơn, đúng guideline. 08-G G3
        // ("corner scale"): 4 handle thay vì 1 (bottom-right, handle gốc) — cùng 1 `handleResizeDown`
        // duy nhất, chỉ khác `signX`/`signY` truyền vào (file header của hàm đó giải thích tại sao
        // vẫn center-anchored, không phải 4 hành vi resize độc lập).
        <div
          key={corner.key}
          onPointerDown={(e) => handleResizeDown(e, corner.signX, corner.signY)}
          style={{
            position: 'absolute', [corner.h]: -10, [corner.v]: -10, width: 20, height: 20, cursor: corner.cursor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 10, height: 10,
              background: 'var(--accent, #7C5CFA)', border: '1px solid #fff', borderRadius: 2,
            }}
          />
        </div>
      ))}
      {!locked && (
        // Rotation handle — both children of the box's own rotated div, so they inherit
        // `style.transform` above and always visually sit at the box's current top-center
        // regardless of rotation (file header comment has the full drag-math rationale). Fixed
        // screen-space offsets (not canvas-scaled), same convention the resize handle's 20×20
        // hit-area already uses: an 8px connector line flush against the box's own top edge, then
        // a 20×20 hit-area (10×10 visible circle) immediately above it — the two are positioned to
        // meet with no visual gap.
        <>
          <div style={{ position: 'absolute', left: '50%', top: -8, width: 1, height: 8, background: 'var(--accent, #7C5CFA)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
          <div
            onPointerDown={handleRotateDown}
            style={{
              position: 'absolute', left: '50%', top: -28, width: 20, height: 20,
              transform: 'translateX(-50%)', cursor: 'grab',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 10, height: 10, borderRadius: '50%',
                background: 'var(--accent, #7C5CFA)', border: '1px solid #fff',
              }}
            />
          </div>
        </>
      )}
      {!locked && (
        // 08-G G3 rotation pivot (ADR 0035): positioned as a PLAIN fraction of the box's own
        // (unrotated) layout — `left`/`top` in % here are resolved BEFORE `style.transform`'s
        // `rotate()` is applied to the whole box (same layering every other handle in this file
        // already relies on), so this handle visually tracks the pivot through any rotation with no
        // extra math. Diamond shape (not a circle like rotate, not a square like resize) so it
        // reads as a distinct third kind of handle at a glance. `data-pivot-handle` — a dedicated
        // test attribute, not inferred from style, same convention `data-snap-guide` already uses.
        <div
          data-pivot-handle
          onPointerDown={handlePivotDown}
          onDoubleClick={handlePivotDoubleClick}
          title="Kéo để đặt tâm xoay — nhấp đúp để về giữa"
          style={{
            position: 'absolute',
            left: `${effective.pivotX * 100}%`, top: `${effective.pivotY * 100}%`,
            width: PIVOT_HANDLE_SIZE + 10, height: PIVOT_HANDLE_SIZE + 10,
            transform: 'translate(-50%, -50%)', cursor: 'move',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: PIVOT_HANDLE_SIZE, height: PIVOT_HANDLE_SIZE,
              background: 'var(--accent, #7C5CFA)', border: '1px solid #fff',
              transform: 'rotate(45deg)',
            }}
          />
        </div>
      )}
      </div>
    </>
  );
}
