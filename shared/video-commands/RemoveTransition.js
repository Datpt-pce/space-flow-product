// RemoveTransition({ transition }) — Video Editor Phase 9 (specs/space-flow-master-plan/
// 04-video-editor.md §5). §2's original 11 commands included AddTransition but no removal
// counterpart (the same gap AddTrack/RemoveTrack's own header noted for tracks in Phase 6) —
// mirrors RemoveKeyframe.js's exact shape: `transition` is the full caller-supplied object so
// invert() can restore it exactly.
const { cloneState } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  next.transitions = (next.transitions || []).filter((t) => t.id !== args.transition.id);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  prev.transitions = prev.transitions || [];
  prev.transitions.push(args.transition);
  return prev;
}

module.exports = { validate, apply, invert };
