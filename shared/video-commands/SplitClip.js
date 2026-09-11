// SplitClip({ trackId, index, originalClip, splitAtMs, newClipId }) — Video Editor Phase 1.
// Splits 1 clip into 2 at absolute timeline time `splitAtMs` (must fall strictly inside the
// clip). `originalClip` (full object) and `newClipId` (the second half's id) are caller-supplied
// so apply() stays a pure, deterministic function of its args — it never generates an id itself,
// which the general apply/invert round-trip contract (index.js) requires.
//
// Keyframe time is clip-relative (invariants.js) — a keyframe at or before the split point stays
// on the first half unchanged; one after it moves to the second half with its time re-based to
// the new clip's own start. transform/effects are shallow-copied onto both halves as-is (Phase 1
// scope: splitting the data model correctly, not deciding what "split transform" ought to mean
// beyond "both halves keep the same transform their parent had").
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function splitParts(originalClip, splitAtMs, newClipId) {
  const elapsedTimelineMs = splitAtMs - originalClip.timelineInMs;
  // `?? 1`, not `|| 1` — a freeze-frame clip (speed: 0) must map EVERY split point to the same
  // frozen sourceInMs (elapsedSourceMs = 0), and `0 || 1` would wrongly coerce that 0 to 1. Only
  // an actually-missing speed (undefined/null, old data) should default to 1.
  const elapsedSourceMs = elapsedTimelineMs * (originalClip.speed ?? 1);
  const keyframes = originalClip.keyframes || [];

  const first = {
    ...originalClip,
    timelineOutMs: splitAtMs,
    sourceOutMs: originalClip.sourceInMs + elapsedSourceMs,
    keyframes: keyframes.filter((kf) => kf.timeMs <= elapsedTimelineMs),
  };
  const second = {
    ...originalClip,
    id: newClipId,
    timelineInMs: splitAtMs,
    sourceInMs: originalClip.sourceInMs + elapsedSourceMs,
    keyframes: keyframes
      .filter((kf) => kf.timeMs > elapsedTimelineMs)
      .map((kf) => ({ ...kf, timeMs: kf.timeMs - elapsedTimelineMs })),
  };
  return [first, second];
}

function validate(state, args) {
  if (args.splitAtMs <= args.originalClip.timelineInMs || args.splitAtMs >= args.originalClip.timelineOutMs) {
    throw new Error(`splitAtMs (${args.splitAtMs}) must be strictly inside clip ${args.originalClip.id}'s timeline range (${args.originalClip.timelineInMs}-${args.originalClip.timelineOutMs})`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const track = getTrack(next, args.trackId);
  const [first, second] = splitParts(args.originalClip, args.splitAtMs, args.newClipId);
  track.clips.splice(args.index, 1, first, second);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const track = getTrack(prev, args.trackId);
  track.clips.splice(args.index, 2, args.originalClip);
  return prev;
}

module.exports = { validate, apply, invert };
