// RemoveKeyframe({ trackId, clipId, keyframe }) — Video Editor Phase 1. Removes a keyframe by
// id. `keyframe` is the full caller-supplied object (read from state before removal) so invert()
// can restore it exactly, including its original position in the array.
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  const index = (clip.keyframes || []).findIndex((kf) => kf.id === args.keyframe.id);
  if (index === -1) throw new Error(`Keyframe not found: ${args.keyframe.id} on clip ${args.clipId}`);
  clip.keyframes.splice(index, 1);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const clip = getClip(prev, args.trackId, args.clipId);
  clip.keyframes = clip.keyframes || [];
  // Re-insert in sorted timeMs order — good enough for Phase 1 (no UI position to preserve yet,
  // and a keyframe list is conceptually a set ordered by time, not by insertion order).
  const insertAt = clip.keyframes.findIndex((kf) => kf.timeMs > args.keyframe.timeMs);
  clip.keyframes.splice(insertAt === -1 ? clip.keyframes.length : insertAt, 0, args.keyframe);
  return prev;
}

module.exports = { validate, apply, invert };
