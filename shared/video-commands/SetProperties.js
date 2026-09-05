// SetProperties({ changes: [{ path, from, to }, ...] }) — Video Editor 08.1 (specs/
// ai-creative-operations-platform/08-1-editor-ux-foundation.md §5: "một gesture tạo một
// command"). Same generic path-addressed setter as SetProperty, batched: a single gesture that
// changes MORE THAN ONE field at once (e.g. dragging a transform handle diagonally changes both
// `x` and `y`) needs to land as exactly one undo entry, which SetProperty alone can't express.
// Applies/inverts every entry in order/reverse-order on the SAME cloned state, so this is still
// one atomic command as far as the command stack is concerned.
const { cloneState, getAtPath, setAtPath } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  for (const change of args.changes) {
    const current = getAtPath(state, change.path);
    if (!Object.is(current, change.from)) {
      throw new Error(`SetProperties: expected current value at path [${change.path.join('.')}] to be ${JSON.stringify(change.from)}, got ${JSON.stringify(current)} — state may have changed since this command was created`);
    }
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  let next = cloneState(state);
  for (const change of args.changes) next = setAtPath(next, change.path, change.to);
  return next;
}

function invert(state, args) {
  let prior = cloneState(state);
  for (let i = args.changes.length - 1; i >= 0; i--) {
    prior = setAtPath(prior, args.changes[i].path, args.changes[i].from);
  }
  return prior;
}

module.exports = { validate, apply, invert };
