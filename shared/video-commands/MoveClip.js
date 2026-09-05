// MoveClip({ clipId, from: {trackId,index,timelineInMs}, to: {trackId,index,timelineInMs} }) —
// Video Editor Phase 1 (caller added Phase 6 — Timeline.jsx's existing-clip drag). Moves a clip to
// a new track/position/time, preserving its own duration (timelineOutMs shifts by the same delta
// as timelineInMs). `from`/`to` are supplied by the caller (who already has the pre-move state)
// rather than derived internally — see this directory's index.js header comment for the general
// apply/invert contract.
//
// Index contract (the thing Phase 2's review flagged as a same-track off-by-one risk, unresolved
// until Phase 6 wrote the first real caller): `from.index`/`to.index` are each the clip's FINAL
// index in its (destination) track's clips array, i.e. splice()-ready as-is against that array
// AFTER the clip has already been removed from wherever it started. A caller must NOT compute
// `to.index` by counting positions in a snapshot that still includes the clip being moved at its
// OLD position — for a same-track move that counts the moving clip itself and is off by one.
// frontend/src/video/timelineUtils.js's computeInsertIndex(track, excludeClipId, ms) exists
// specifically to get this right (it excludes the moving clip from the count).
const { cloneState, getTrack, getClipIndex } = require('./state');
const { assertAllInvariants } = require('./invariants');

function moveTo(state, clipId, fromLoc, toLoc) {
  const next = cloneState(state);
  const fromTrack = getTrack(next, fromLoc.trackId);
  const index = getClipIndex(fromTrack, clipId);
  const [clip] = fromTrack.clips.splice(index, 1);

  const durationMs = clip.timelineOutMs - clip.timelineInMs;
  clip.timelineInMs = toLoc.timelineInMs;
  clip.timelineOutMs = toLoc.timelineInMs + durationMs;

  const toTrack = getTrack(next, toLoc.trackId);
  toTrack.clips.splice(toLoc.index, 0, clip);
  return next;
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return moveTo(state, args.clipId, args.from, args.to);
}

function invert(state, args) {
  return moveTo(state, args.clipId, args.to, args.from);
}

// moveTo exported for MoveClips.js (08.2.2 §1, multi-select move) to reuse the exact same
// splice/reposition logic per clip in a batch — no duplicated implementation.
module.exports = { validate, apply, invert, moveTo };
