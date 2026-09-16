// CommandStack — Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md).
// execute()/undo()/redo() over shared/video-commands (the SAME module
// backend/routes/video-projects.js requires) — imported from OUTSIDE frontend/src on purpose,
// verified to actually resolve through Vite (both `vite build` and the dev server) rather than
// falling back to the plan's accepted "duplicate the code + cross-check test" escape hatch (see
// tests/e2e/ui/command-stack.spec.js, which dynamic-imports this exact file through a running
// Vite dev server and drives it end-to-end — tooling was not actually a blocker here).
//
// No network/persistence here at all — this is purely the client-side optimistic apply/undo/redo
// layer. Phase 3's Timeline UI is what will call execute() from real user actions and separately
// POST the same {type, args} to /api/video-projects/:id/commands (backend/routes/
// video-projects.js) to persist it; reconciling an optimistic-apply vs. a server rejection is
// also Phase 3's concern, not built speculatively here.

import { runCommand, invertCommand } from '@shared/video-commands';

export function createCommandStack(initialState, { maxHistory = 100 } = {}) {
  let state = initialState;
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  function execute(type, args) {
    state = runCommand(state, type, args);
    undoStack.push({ type, args });
    if (undoStack.length > maxHistory) undoStack.shift();
    redoStack = [];
    notify();
    return state;
  }

  // 08-D D4: undo()/redo() now return the {type, args} that was just (un)done, alongside the new
  // state — the caller (frontend/src/video/store.js) needs it to durably record the same operation
  // on the server (an "Undo" command for undo; the ORIGINAL {type, args} re-posted for redo — see
  // shared/video-commands/UndoCommand.js's own header for why redo needs no separate command type).
  // Returns null when there's nothing to (un)do, so the caller knows not to persist anything.
  function undo() {
    if (undoStack.length === 0) return null;
    const cmd = undoStack.pop();
    state = invertCommand(state, cmd.type, cmd.args);
    redoStack.push(cmd);
    notify();
    return { state, undoneCommand: cmd };
  }

  function redo() {
    if (redoStack.length === 0) return null;
    const cmd = redoStack.pop();
    state = runCommand(state, cmd.type, cmd.args);
    undoStack.push(cmd);
    notify();
    return { state, redoneCommand: cmd };
  }

  return {
    execute,
    undo,
    redo,
    getState: () => state,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    historyLength: () => undoStack.length,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
