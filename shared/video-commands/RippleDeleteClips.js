// RippleDeleteClips({ perTrack: [{ trackId, intervals: [{startMs, endMs, removals: [{index,
// clip}, ...]}, ...] }, ...] }) — 08.2.2 §5 (specs/ai-creative-operations-platform/
// 08-2-2-clip-placement-trim-and-ripple.md, multi-select ripple delete). Batched ripple delete
// across possibly-multiple tracks/intervals — each track ripples INDEPENDENTLY (never
// cross-track), matching RippleDelete.js's own single-track scope. `perTrack` is fully
// caller-computed (mergeRippleIntervals, timelineUtils.js) so apply() stays a pure function of
// its args.
//
// Per track: apply() removes every clip first (descending original index, so no not-yet-removed
// item's index shifts underneath it), THEN shifts each interval's downstream content left
// (descending startMs, so a leftward interval's own endMs threshold is never invalidated by a
// shift that already happened to its right). invert() mirrors this in reverse: shifts everything
// back right first (ascending startMs), THEN reinserts every removed clip in one pass (ascending
// original index — NOT grouped by interval, since 2 different intervals' removals can interleave
// in the original array).
const { cloneState, getTrack } = require('./state');
const { shiftClipsFrom } = require('./RippleDelete');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  for (const { trackId, intervals } of args.perTrack) {
    const track = getTrack(next, trackId);
    const allRemovals = intervals.flatMap((iv) => iv.removals).sort((a, b) => b.index - a.index);
    for (const { index } of allRemovals) track.clips.splice(index, 1);

    const sortedIntervals = [...intervals].sort((a, b) => b.startMs - a.startMs);
    for (const interval of sortedIntervals) {
      shiftClipsFrom(track, interval.endMs, -(interval.endMs - interval.startMs));
    }
  }
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  for (const { trackId, intervals } of args.perTrack) {
    const track = getTrack(prior, trackId);
    const sortedIntervals = [...intervals].sort((a, b) => a.startMs - b.startMs);
    for (const interval of sortedIntervals) {
      shiftClipsFrom(track, interval.startMs, interval.endMs - interval.startMs);
    }

    const allRemovals = intervals.flatMap((iv) => iv.removals).sort((a, b) => a.index - b.index);
    for (const { index, clip } of allRemovals) track.clips.splice(index, 0, clip);
  }
  return prior;
}

module.exports = { validate, apply, invert };
