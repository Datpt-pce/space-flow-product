// UndoCommand({ originalType, originalArgs }) — 08-D D4 (specs/.../08-v2/08-d-durable-editing-
// transactions.md): the durable half of undo. `frontend/src/video/commands/CommandStack.js`'s
// undo() already knows how to invert LOCALLY via invertCommand() — this registers that same
// inversion as its own command type so it can be POSTed to `POST /api/video-projects/:id/commands`
// (which only ever accepts a KNOWN command type, never a generic "undo the last thing") and land in
// the durable command log, per §3 "Undo tạo inverse command dựa trên committed before-state".
// Redo does NOT need a matching "RedoCommand" — replaying the ORIGINAL {originalType, originalArgs}
// as a brand-new forward command through the normal path already IS "redo là durable command mới"
// (§3), since apply() is a pure function of (state, args).
//
// originalCommand() requires('./index') LAZILY (inside the function, not at module top-level) to
// break the circular reference: index.js requires this file while building its own `commands` map,
// so a top-level require here would observe an incomplete module.exports. By the time validate/
// apply/invert are actually CALLED at runtime, index.js has finished loading.
function originalCommand(args) {
  const { commands } = require('./index');
  const command = commands[args?.originalType];
  if (!command) throw new Error(`UndoCommand: unknown originalType "${args?.originalType}"`);
  return command;
}

function validate(state, args) {
  // invert() only ever reconstructs a state the original command already produced once — same
  // reasoning invertCommand()'s own header comment gives for why undo has no separate invariant
  // check of its own beyond "is this even a known command type".
  originalCommand(args);
}

function apply(state, args) {
  return require('./index').invertCommand(state, args.originalType, args.originalArgs);
}

// invert() of an Undo = redo the original command. Kept correct for symmetry even though today's
// client redo() posts {originalType, originalArgs} directly as a new forward command instead of
// ever inverting an Undo entry.
function invert(state, args) {
  return require('./index').runCommand(state, args.originalType, args.originalArgs);
}

module.exports = { validate, apply, invert };
