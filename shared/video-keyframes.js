// Video Editor Phase 7 (specs/space-flow-master-plan/04-video-editor.md §5): keyframe
// interpolation for `clip.transform`'s sub-properties (x/y/scaleX/scaleY/rotation/opacity, plus
// pivotX/pivotY added by 08-G G3/ADR 0035) — the only animatable target so far (clip.keyframes'
// `propertyPath` values this module reads are
// exactly `transform.<key>`, matching shared/video-commands/AddKeyframe.js's existing schema, no
// new command needed). Lives at repo root next to shared/video-transform.js (Phase 5) and
// shared/video-commands/ for the same reason both of those do: ONE evaluation formula shared by
// preview (frontend/src/video/canvasEngine.js, Player.jsx) and export
// (backend/video/renderPlanner.js) — the whole point of Phase 5's shared/video-transform.js split
// was avoiding exactly the kind of preview/export drift 2 independently-written interpolators
// would risk.

const { applyEasing } = require('./video-easing');

// pivotX/pivotY (08-G G3 rotation pivot, ADR 0035): normalized 0-1 fraction of the clip's OWN
// destWidth/destHeight box that ROTATION is measured around — 0.5/0.5 (center) is today's existing
// behavior for every clip that never sets this. Deliberately flat scalars, not a nested {x,y}
// object, matching every other transform field's shape here — see EffectsPanel.jsx's
// commitCropField comment (G3 crop/mask) for why a nested object field is fragile with
// SetProperty's `Object.is` (reference-equality for objects, value-equality for primitives).
const TRANSFORM_DEFAULTS = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, pivotX: 0.5, pivotY: 0.5 };
const TRANSFORM_KEYS = Object.keys(TRANSFORM_DEFAULTS);

function keyframesForProperty(clip, propertyPath) {
  return (clip.keyframes || [])
    .filter((kf) => kf.propertyPath === propertyPath)
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs);
}

function isPropertyAnimated(clip, key) {
  return keyframesForProperty(clip, `transform.${key}`).length > 0;
}

// interpolateAtTime(keyframes, timeMs) -> number | undefined. `keyframes` must already be sorted
// by timeMs (keyframesForProperty() guarantees this). undefined only when `keyframes` is empty —
// the caller's signal to fall back to the clip's static transform[key] instead.
function interpolateAtTime(keyframes, timeMs) {
  if (keyframes.length === 0) return undefined;
  const first = keyframes[0];
  if (keyframes.length === 1 || timeMs <= first.timeMs) return first.value;
  const last = keyframes[keyframes.length - 1];
  if (timeMs >= last.timeMs) return last.value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
      const span = b.timeMs - a.timeMs;
      const t = span === 0 ? 1 : (timeMs - a.timeMs) / span;
      // segment's easing lives on its STARTING keyframe. ADR 0036: 'custom' routes to a's own
      // bezier control points instead of a preset name — applyEasing() accepts both shapes.
      const easingArg = a.easing === 'custom'
        ? { name: 'custom', x1: a.easingX1, y1: a.easingY1, x2: a.easingX2, y2: a.easingY2 }
        : a.easing;
      const eased = applyEasing(easingArg, t);
      return a.value + (b.value - a.value) * eased;
    }
  }
  /* istanbul ignore next -- unreachable: the timeMs<=first/timeMs>=last checks above cover every
     value outside [first,last], and the loop covers every value inside it. */
  return last.value;
}

// evaluateClipTransform(clip, clipRelativeTimeMs) -> full {x,y,scaleX,scaleY,rotation,opacity}.
// Each of the 6 keys is independently either its interpolated keyframe value (if that ONE
// property has any keyframes at all) or clip.transform's static value — never a partial mix
// within a single property, and a property with zero keyframes is byte-identical to today's
// pre-Phase-7 static behavior (no keyframes anywhere -> this function is a no-op passthrough of
// clip.transform, so every caller that adopts it is safe for existing non-animated clips).
function evaluateClipTransform(clip, clipRelativeTimeMs) {
  const base = { ...TRANSFORM_DEFAULTS, ...(clip.transform || {}) };
  const result = { ...base };
  for (const key of TRANSFORM_KEYS) {
    const kfs = keyframesForProperty(clip, `transform.${key}`);
    if (kfs.length === 0) continue;
    result[key] = interpolateAtTime(kfs, clipRelativeTimeMs);
  }
  return result;
}

// evaluateClipTransformForExport(clip, clipRelativeTimeMs) -> like evaluateClipTransform() above,
// but deliberately does NOT interpolate scaleX/scaleY/rotation — always their STATIC
// clip.transform value, even if those specific properties happen to have keyframes.
// backend/video/renderPlanner.js's own deliberate export-side scope cut (see its header comment
// and the Phase 7 entry in 04-video-editor.md §0): animating scale or rotation would make that
// clip's rendered content frame size vary every frame (ffmpeg's `scale`/`rotate` filters both
// require `eval=frame` + a matching `ow`/`oh` expression to do this, verified against real
// ffmpeg), which the render planner's static black-canvas + `overlay` composite was never built
// to receive as its 2nd input. Only x/y (position) and opacity are keyframe-rendered in the
// exported MP4 — PREVIEW (evaluateClipTransform, no such limitation) still shows all 6.
//
// pivotX/pivotY (ADR 0035) join scaleX/scaleY/rotation here for the identical reason — the
// pad/crop pivot-rotation ffmpeg technique (renderPlanner.js) computes fixed pad dimensions from a
// single static pivot per clip, same frame-size-must-be-constant constraint as scale/rotation.
function evaluateClipTransformForExport(clip, clipRelativeTimeMs) {
  const full = evaluateClipTransform(clip, clipRelativeTimeMs);
  const base = { ...TRANSFORM_DEFAULTS, ...(clip.transform || {}) };
  return { ...full, scaleX: base.scaleX, scaleY: base.scaleY, rotation: base.rotation, pivotX: base.pivotX, pivotY: base.pivotY };
}

module.exports = {
  TRANSFORM_KEYS, TRANSFORM_DEFAULTS,
  keyframesForProperty, isPropertyAnimated, interpolateAtTime, evaluateClipTransform,
  evaluateClipTransformForExport,
};
