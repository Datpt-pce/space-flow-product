// AddKeyframe({ trackId, clipId, keyframe }) — Video Editor Phase 1. Adds a keyframe (full
// object, including its own id) to a clip. keyframe.timeMs is clip-relative (invariants.js).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  clip.keyframes = clip.keyframes || [];
  clip.keyframes.push(args.keyframe);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const clip = getClip(prev, args.trackId, args.clipId);
  clip.keyframes = (clip.keyframes || []).filter((kf) => kf.id !== args.keyframe.id);
  return prev;
}

module.exports = { validate, apply, invert };
