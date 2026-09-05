// Video Editor Phase 7 (specs/space-flow-master-plan/04-video-editor.md §5): easing curves for
// keyframe interpolation. `t` is normalized position within a segment (0..1); every function
// returns eased `t` (0..1), which shared/video-keyframes.js then applies to the actual value range.
//
// 08-G G5 (ADR 0036, docs/decisions/0036-keyframe-custom-bezier-easing-minimal-slice.md): a fixed
// preset set (below) PLUS one custom-curve escape hatch — `applyEasing()` also accepts an object
// `{ name: 'custom', x1, y1, x2, y2 }` (CSS `cubic-bezier(x1,y1,x2,y2)` semantics) instead of a
// plain preset-name string, for keyframes whose `easing === 'custom'`. Every EXISTING call site
// that passes a plain string is completely unaffected — this is a strict superset of the prior
// contract, not a breaking one.

function linear(t) { return t; }
function easeIn(t) { return t * t; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; }
// hold (08-G G5): a step function, not a curve — the segment's value stays at its STARTING
// keyframe's value for the entire span and only reaches the ending keyframe's value at t=1 exactly
// (the instant the next keyframe's own timeMs is reached). Correct on its own with no special-
// casing needed in shared/video-keyframes.js's interpolateAtTime: that formula is always
// `a.value + (b.value - a.value) * eased`, so `eased=0` everywhere except exactly at t=1 already
// produces "hold a's value, then jump to b's value right at b's time" — the classic NLE "Hold"
// keyframe behavior.
function hold(t) { return t >= 1 ? 1 : 0; }

const EASINGS = {
  linear,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  hold,
};

// cubicBezierAt(x1, x2, u) — the bezier's X component at parameter u, with fixed anchors (0,0) and
// (1,1) (CSS cubic-bezier's own convention — only the 2 control points are free). x1/x2 constrained
// to [0,1] by assertValidCustomEasing (shared/video-commands/invariants.js) — that constraint is
// exactly what guarantees this is a monotonic function of u, which solveBezierU below depends on.
function cubicBezierAt(p1, p2, u) {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}
// solveBezierU(x1, x2, targetX) -> the u in [0,1] where cubicBezierAt(x1,x2,u) === targetX. Binary
// search rather than Newton-Raphson — this domain's precision needs (a video editor's frame-time
// granularity) are far below what 20 bisection steps already give (~1e-6), and bisection can't
// diverge the way a derivative-based method could near a flat tangent, so it's the simpler correct
// choice here over the marginally-faster alternative.
function solveBezierU(x1, x2, targetX) {
  let lo = 0;
  let hi = 1;
  let u = targetX;
  // 28 steps: 2^-28 ≈ 3.7e-9, well past this domain's precision needs (frame-time granularity),
  // with enough margin that the ~1e-6-scale float noise from repeated bisection never surfaces in
  // an interior point the way a tighter budget did during this ADR's own testing.
  for (let i = 0; i < 28; i++) {
    u = (lo + hi) / 2;
    if (cubicBezierAt(x1, x2, u) < targetX) lo = u; else hi = u;
  }
  return u;
}
// cubicBezierY(x1, y1, x2, y2, t) — the CSS cubic-bezier() timing function itself: `t` is the
// linear time fraction (0..1), the return value is the eased progress at that time. y1/y2 are
// deliberately UNCONSTRAINED (unlike x1/x2) — CSS allows Y outside [0,1] on purpose, to express
// overshoot/bounce curves, and there's no reason to be stricter here. t=0/t=1 are special-cased to
// return EXACTLY 0/1 (matching every preset function's own exact-endpoint contract) rather than
// relying on the bisection search's approximation at the boundary.
function cubicBezierY(x1, y1, x2, y2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = solveBezierU(x1, x2, t);
  return cubicBezierAt(y1, y2, u);
}

// applyEasing(easing, t) — `easing` is either a plain preset-name STRING (unknown/missing name
// falls back to linear rather than throwing: an easing string is free-form data on a keyframe
// object, no schema enum enforces it, and a typo'd or future/unsupported name degrading to linear
// is a safer failure mode than crashing mid-interpolation for every clip that references it), or an
// OBJECT `{ name: 'custom', x1, y1, x2, y2 }` (ADR 0036) for a per-segment custom bezier curve.
function applyEasing(easing, t) {
  const clamped = Math.max(0, Math.min(1, t));
  if (easing && typeof easing === 'object' && easing.name === 'custom') {
    return cubicBezierY(easing.x1, easing.y1, easing.x2, easing.y2, clamped);
  }
  const fn = EASINGS[easing] || linear;
  return fn(clamped);
}

module.exports = { applyEasing, EASINGS };
