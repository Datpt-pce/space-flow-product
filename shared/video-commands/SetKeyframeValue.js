// SetKeyframeValue({ trackId, clipId, keyframeId, from, to }) — 08-G G4 auto-key: updates ONE
// keyframe's `value` field in place (its `timeMs`/`propertyPath`/`easing` untouched). Half of the
// auto-key behavior — editing a property AT an existing keyframe's exact clip-relative time updates
// that keyframe (this command); editing at any other time inserts a brand new one instead (the
// existing AddKeyframe.js). Same Object.is staleness check as SetProperty.js.
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  const clip = getClip(state, args.trackId, args.clipId);
  const kf = (clip.keyframes || []).find((k) => k.id === args.keyframeId);
  if (!kf) throw new Error(`SetKeyframeValue: keyframe ${args.keyframeId} not found on clip ${args.clipId}`);
  if (!Object.is(kf.value, args.from)) {
    throw new Error(`SetKeyframeValue: expected keyframe ${args.keyframeId}'s value to be ${JSON.stringify(args.from)}, got ${JSON.stringify(kf.value)} — state may have changed since this command was created`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  clip.keyframes.find((k) => k.id === args.keyframeId).value = args.to;
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  const clip = getClip(prior, args.trackId, args.clipId);
  clip.keyframes.find((k) => k.id === args.keyframeId).value = args.from;
  return prior;
}

module.exports = { validate, apply, invert };
