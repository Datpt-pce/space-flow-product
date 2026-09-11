// SetKeyframeEasing({ trackId, clipId, keyframeId, from, to }) — 08-G G5 (easing picker): updates
// ONE keyframe's `easing` field in place (its `timeMs`/`propertyPath`/`value` untouched). Separate
// small command rather than generalizing SetKeyframeValue.js into a field-agnostic setter — same
// shape, same Object.is staleness check, kept as its own file to match this codebase's existing
// per-purpose command convention (SetProperty/SetProperties already cover the fully generic
// path-addressed case; a keyframe needs ID-based lookup instead of array-index addressing because
// its position in `clip.keyframes` isn't stable across commands — see MoveKeyframe.js/
// SetKeyframeValue.js's own headers for the same reasoning).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  const clip = getClip(state, args.trackId, args.clipId);
  const kf = (clip.keyframes || []).find((k) => k.id === args.keyframeId);
  if (!kf) throw new Error(`SetKeyframeEasing: keyframe ${args.keyframeId} not found on clip ${args.clipId}`);
  if (!Object.is(kf.easing, args.from)) {
    throw new Error(`SetKeyframeEasing: expected keyframe ${args.keyframeId}'s easing to be ${JSON.stringify(args.from)}, got ${JSON.stringify(kf.easing)} — state may have changed since this command was created`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  clip.keyframes.find((k) => k.id === args.keyframeId).easing = args.to;
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  const clip = getClip(prior, args.trackId, args.clipId);
  clip.keyframes.find((k) => k.id === args.keyframeId).easing = args.from;
  return prior;
}

module.exports = { validate, apply, invert };
