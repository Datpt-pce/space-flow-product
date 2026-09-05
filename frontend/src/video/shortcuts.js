// 08.1 (specs/ai-creative-operations-platform/08-1-editor-ux-foundation.md §5: "Ctrl trên Windows/
// Linux và Cmd trên macOS được mô tả chung là Mod trong shortcut registry"). Small, shared by
// Timeline.jsx's keydown handler (the actual shortcut logic) and VideoToolbar.jsx's button titles
// (the visible labels) — previously `e.ctrlKey || e.metaKey` was inlined twice in Timeline.jsx and
// the label strings were duplicated as plain text in VideoToolbar.jsx.

export function isMod(e) {
  return e.ctrlKey || e.metaKey;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
export const MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';

// Labels only — Timeline.jsx's handleKeyDown still owns the actual key comparisons (`e.key`),
// since those also carry non-shortcut logic (guard conditions, `preventDefault`, etc.) that
// doesn't belong in a static label map.
export const SHORTCUTS = {
  undo: `${MOD_LABEL}+Z`,
  redo: `${MOD_LABEL}+Shift+Z`,
  split: 'S',
  // 08.2.2 §5: NLE convention (Premiere/DaVinci) — plain Delete keeps the gap, Shift+Delete closes
  // it. Was RippleDelete-only on plain Delete before this pass (the only delete flavor that
  // existed then) — a deliberate behavior change, not a bugfix.
  delete: 'Delete',
  rippleDelete: 'Shift+Delete',
  addKeyframe: 'K',
  // 08-G G4: Alt (not plain Arrow, already frame-step; not Mod, already undo/redo/duplicate/group)
  // was the only unclaimed modifier left on Left/Right — After Effects/Premiere use a similar
  // Alt+Shift convention for prev/next keyframe, close enough to read as familiar without
  // colliding with anything already bound here.
  prevKeyframe: 'Alt+←',
  nextKeyframe: 'Alt+→',
  // 08-L L3 §2 finding #3, now patched: Space is the near-universal NLE play/pause convention.
  togglePlay: 'Space',
  // 08.2.2 §6: Alt+drag on a clip does the same thing, no separate label needed for it — it's a
  // drag-gesture modifier, not a keystroke shortcut.
  duplicate: `${MOD_LABEL}+D`,
  // 08-F F4: standard NLE convention (Premiere/DaVinci/CapCut) — plain Mod+G groups, Mod+Shift+G
  // ungroups, mirroring Mod+Z/Mod+Shift+Z's undo/redo pairing above.
  group: `${MOD_LABEL}+G`,
  ungroup: `${MOD_LABEL}+Shift+G`,
  // 08.2.2 §2/§6: 2 drag-gesture modifiers, not keystroke shortcuts — no on-screen label needed,
  // documented here for the registry's own completeness. Read at 2 DIFFERENT times on purpose:
  // Alt is read ONCE at dragstart (decides the gesture's TYPE, move vs duplicate — see
  // handleClipDragStart), Shift is read on EVERY dragover/mousemove (toggles snap for the current
  // pointer position only, never a persisted setting — see computeSnappedMs). They never conflict
  // since neither reads the other's key.
  disableSnap: 'Shift (giữ khi kéo)',
};

// 08.3.1 §1/§2 (Inspector keyboard nudge + canvas arrow-key nudge): base/coarse/fine step per
// field family — Shift = coarse, Alt = fine, plain = base. Position is canvas/resolution pixels;
// scale is a ratio (1 = 100%); rotation is degrees. Shared by EffectsPanel.jsx's Inspector fields
// and Player.jsx's canvas arrow-nudge so both feel the same, not independently-tuned magic numbers.
export const NUDGE_STEPS = {
  position: { base: 1, coarse: 10, fine: 0.1 },
  scale: { base: 0.01, coarse: 0.1, fine: 0.001 },
  rotation: { base: 1, coarse: 15, fine: 0.1 },
  opacity: { base: 0.01, coarse: 0.1, fine: 0.001 },
};

// stepFor(steps, e) -> the right magnitude for a keyboard nudge event, Shift taking priority over
// Alt if somehow both are held (an arbitrary but deterministic tie-break, never expected in
// practice since they're opposite ends of the precision spectrum).
export function stepFor(steps, e) {
  if (e.shiftKey) return steps.coarse;
  if (e.altKey) return steps.fine;
  return steps.base;
}
