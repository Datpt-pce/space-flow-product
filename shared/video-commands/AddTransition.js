// AddTransition({ transition }) — Video Editor Phase 1. Adds a transition (full object,
// including its own id) between 2 clips to state.transitions. §2 schema:
// transition(between-clips/duration/params).
const { cloneState } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  next.transitions = next.transitions || [];
  next.transitions.push(args.transition);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  prev.transitions = (prev.transitions || []).filter((t) => t.id !== args.transition.id);
  return prev;
}

module.exports = { validate, apply, invert };
