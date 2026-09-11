// MoveClips({ moves: [{ clipId, fromTrackId, toTrackId, fromTimelineInMs, toTimelineInMs }, ...] })
// — 08.2.2 §1 (specs/ai-creative-operations-platform/08-2-2-clip-placement-trim-and-ripple.md,
// multi-select move). Batched version of MoveClip.js: N clips move together as ONE atomic command
// (validate/apply/invert the whole batch on one cloned state — same pattern SetProperties.js
// established for the single-command-multi-field case).
//
// Unlike MoveClip, this does NOT take a caller-supplied array index. `track.clips` order isn't
// meaningful anywhere in the codebase (assertNoIllegalOverlap/adjacentClipPairs both re-sort by
// timelineInMs before using it) — a moved clip is simply spliced out of its old track and pushed
// onto its new one. This sidesteps the real staleness risk a positional index would have here: 2
// moves in the same batch landing on the same track would invalidate each other's pre-computed
// index the instant the first one runs.
const { cloneState, getTrack, getClipIndex } = require('./state');
const { assertAllInvariants } = require('./invariants');

function moveOne(state, clipId, fromTrackId, toTrackId, timelineInMs) {
  const fromTrack = getTrack(state, fromTrackId);
  const index = getClipIndex(fromTrack, clipId);
  const [clip] = fromTrack.clips.splice(index, 1);
  const durationMs = clip.timelineOutMs - clip.timelineInMs;
  clip.timelineInMs = timelineInMs;
  clip.timelineOutMs = timelineInMs + durationMs;
  getTrack(state, toTrackId).clips.push(clip);
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  for (const track of args.newTracks || []) next.tracks.push(cloneState(track));
  for (const move of args.moves) moveOne(next, move.clipId, move.fromTrackId, move.toTrackId, move.toTimelineInMs);
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  // Forward order (not reversed) on purpose: each move targets a DIFFERENT clip id (never the
  // same clip twice in one batch), so — unlike SetProperties, where 2 entries can share a path —
  // there's no cross-move ordering dependency for correctness. Processing in the SAME order apply()
  // used means each clip gets pushed back onto its origin track in the same sequence it was
  // originally pushed in, reproducing the EXACT prior array order (not just an equivalent set).
  for (const move of args.moves) {
    moveOne(prior, move.clipId, move.toTrackId, move.fromTrackId, move.fromTimelineInMs);
  }
  for (const move of [...args.moves].filter(m => Number.isInteger(m.fromIndex)).sort((a,b) => a.fromIndex - b.fromIndex)) {
    const track = getTrack(prior, move.fromTrackId), index = getClipIndex(track, move.clipId);
    const [clip] = track.clips.splice(index, 1); track.clips.splice(move.fromIndex, 0, clip);
  }
  if (args.newTracks?.length) prior.tracks = prior.tracks.filter(track => !args.newTracks.some(added => added.id === track.id));
  return prior;
}

module.exports = { validate, apply, invert };
