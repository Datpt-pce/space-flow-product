// RemoveTrack({ track, index }) — Video Editor Phase 6 (specs/space-flow-master-plan/04-video-editor.md
// §5): removes a track. `track` (full object, for invert) and `index` (its position in
// state.tracks, so invert re-inserts at the exact same spot — same pattern SplitClip/InsertClip use)
// are both caller-supplied. validate() refuses to remove a track that still has clips — this is a
// data-loss guard, not an invariant `assertAllInvariants` itself would ever catch (an empty vs.
// non-empty track is equally "valid" state on its own); the caller (Timeline.jsx) is expected to
// disable the remove-track UI whenever `track.clips.length > 0` rather than let this throw in
// practice, but validate() still enforces it so a stale/race UI state can't silently drop clips.
const { cloneState } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  if (args.track.clips.length > 0) {
    throw new Error(`Track ${args.track.id} still has ${args.track.clips.length} clip(s) — remove them before deleting the track`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  next.tracks = next.tracks.filter((t) => t.id !== args.track.id);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  prev.tracks.splice(args.index, 0, args.track);
  return prev;
}

module.exports = { validate, apply, invert };
