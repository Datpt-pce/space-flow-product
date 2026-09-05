// InsertClip({ trackId, index, clip }) — Video Editor Phase 1
// (specs/space-flow-master-plan/04-video-editor.md). Inserts `clip` (a full clip object,
// including its own id — the caller decides the id, so apply() stays a pure function of its
// args, never generating anything random itself) at `index` in `trackId`'s clips array.
//
// Contract for every command module in this directory: apply(state, args) -> state after;
// invert(state, args) -> state before, given the SAME args and the state AFTER apply ran. This
// is what "round-trip apply->invert->apply" (Phase 1 task checklist) literally tests: apply(),
// invert() must reconstruct the exact original, and apply() again must reproduce the same
// "after" state — see shared/video-commands/index.test.js.
const { cloneState, getTrack, getClipIndex } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const track = getTrack(next, args.trackId);
  track.clips.splice(args.index, 0, args.clip);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const track = getTrack(prev, args.trackId);
  const index = getClipIndex(track, args.clip.id);
  track.clips.splice(index, 1);
  return prev;
}

module.exports = { validate, apply, invert };
