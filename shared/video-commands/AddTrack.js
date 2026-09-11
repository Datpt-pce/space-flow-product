// AddTrack({ track }) — Video Editor Phase 6 (specs/space-flow-master-plan/04-video-editor.md
// §5): appends a new, empty track (`track` is the full object — caller decides id/type/order, same
// "apply is a pure function of its args" contract every command in this directory follows). Not
// one of the original 11 commands §2 named, but the SAME contract — Timeline.jsx (Phase 6) is the
// first real caller, needing a way to add a 2nd video track so canvasEngine.js's existing
// multi-track composite (Phase 5) has more than 1 track to actually composite.
const { cloneState } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  next.tracks.push(cloneState(args.track));
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  prev.tracks = prev.tracks.filter((t) => t.id !== args.track.id);
  return prev;
}

module.exports = { validate, apply, invert };
