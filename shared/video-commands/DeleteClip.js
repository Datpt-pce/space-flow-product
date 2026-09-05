// DeleteClip({ trackId, index, clip }) — Video Editor 08.2.2 §5 (specs/ai-creative-operations-
// platform/08-2-2-clip-placement-trim-and-ripple.md). Removes `clip` (full object, at `index` in
// `trackId`) WITHOUT touching any other clip on the track — the "keep the gap" counterpart to
// RippleDelete.js (which closes it). Same args shape/splice convention as RippleDelete.
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const track = getTrack(next, args.trackId);
  track.clips.splice(args.index, 1);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const track = getTrack(prev, args.trackId);
  track.clips.splice(args.index, 0, args.clip);
  return prev;
}

module.exports = { validate, apply, invert };
