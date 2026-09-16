// Pure monotonic accounting. Visibility/focus is observable; attention is not.
export function createPresenceClock({ mono, wall, flags, idleMs = 60000 }) {
  let previous = mono, wallPrevious = wall, lastInput = -Infinity, state = flags;
  return {
    advance(nextMono, nextWall, nextFlags = state, input = false) {
      const delta = nextMono - previous, elapsedWall = nextWall - wallPrevious;
      const intervals = [];
      // Suspended timers/sleep are unknown time, never silently counted as activity.
      if (delta > 0 && delta <= 5000 && Math.abs(delta - elapsedWall) < 1000) {
        const engagedEnd = Math.max(previous, Math.min(nextMono, lastInput + idleMs));
        const boundary = engagedEnd > previous && engagedEnd < nextMono ? [engagedEnd, nextMono] : [nextMono];
        let start = previous;
        for (const end of boundary) {
          intervals.push({ start: Math.round(nextWall - (nextMono - start)), end: Math.round(nextWall - (nextMono - end)),
            visible: !!state.visible, focused: !!(state.visible && state.focused),
            pointer: !!(state.visible && state.focused && state.pointer),
            engaged: !!(state.visible && state.focused && start < lastInput + idleMs),
            viewing: !!(state.visible && state.focused && state.viewing), waiting: !!(state.visible && state.focused && state.waiting) });
          start = end;
        }
      }
      previous = nextMono; wallPrevious = nextWall; state = nextFlags;
      if (input && state.visible && state.focused) lastInput = nextMono;
      return { intervals, missingMs: delta > 5000 || Math.abs(delta-elapsedWall)>=1000 ? Math.max(0,delta) : 0 };
    },
  };
}
