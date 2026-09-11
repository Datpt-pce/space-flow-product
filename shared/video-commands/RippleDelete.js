// RippleDelete({ trackId, index, clip }) — Video Editor Phase 1. Removes `clip` (full object, at
// `index` in `trackId`) and shifts every OTHER clip in the SAME track that starts at or after the
// removed clip's end earlier by the removed clip's duration — the "ripple" (everything downstream
// closes the gap). Scoped to a single track (not cross-track sync) for Phase 1/MVP.
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function shiftClipsFrom(track, thresholdMs, deltaMs) {
  for (const clip of track.clips) {
    if (clip.timelineInMs >= thresholdMs) {
      clip.timelineInMs += deltaMs;
      clip.timelineOutMs += deltaMs;
    }
  }
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const track = getTrack(next, args.trackId);
  const durationMs = args.clip.timelineOutMs - args.clip.timelineInMs;
  track.clips.splice(args.index, 1);
  shiftClipsFrom(track, args.clip.timelineOutMs, -durationMs);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const track = getTrack(prev, args.trackId);
  const durationMs = args.clip.timelineOutMs - args.clip.timelineInMs;
  // Reverse order vs apply(): un-shift first (thresholdMs is the POST-delete timeline position
  // downstream clips are currently sitting at), then restore the removed clip.
  shiftClipsFrom(track, args.clip.timelineInMs, durationMs);
  track.clips.splice(args.index, 0, args.clip);
  return prev;
}

// shiftClipsFrom exported for RippleDeleteClips.js (08.2.2 §5, multi-select ripple delete) to
// reuse the exact same shift logic per merged interval — no duplicated implementation.
module.exports = { validate, apply, invert, shiftClipsFrom };
