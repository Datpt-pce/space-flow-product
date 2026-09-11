// SetProperty({ path: [...pathParts], from, to }) — Video Editor Phase 1. Generic property
// setter for anything addressable by a path into the project JSON (transform fields, effect
// params, track lock/mute/visible, etc.) — one command instead of a dozen single-purpose
// setters. `from` (the pre-change value) is caller-supplied, read from state at command-creation
// time, not re-derived here.
const { cloneState, getAtPath, setAtPath } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  const current = getAtPath(state, args.path);
  if (!Object.is(current, args.from)) {
    throw new Error(`SetProperty: expected current value at path [${args.path.join('.')}] to be ${JSON.stringify(args.from)}, got ${JSON.stringify(current)} — state may have changed since this command was created`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return setAtPath(cloneState(state), args.path, args.to);
}

function invert(state, args) {
  return setAtPath(cloneState(state), args.path, args.from);
}

module.exports = { validate, apply, invert };
