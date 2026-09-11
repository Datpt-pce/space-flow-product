import { useEffect } from 'react';
import { useVideoStore } from './store.js';
// Timeline time advances independently of media timeupdate frequency, silence,
// gaps and reverse clips. Media follows this clock and never writes back to it.
export function usePlaybackClock() {
  const playing = useVideoStore(s => s.isPlaying);
  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    let previous = performance.now();
    const tick = now => {
      const state = useVideoStore.getState();
      if (!state.isPlaying) return;
      const duration = Math.max(0, ...(state.projectState?.tracks || []).flatMap(t => t.clips.map(c => c.timelineOutMs)));
      const next = Math.min(duration, state.playheadMs + now - previous);
      previous = now;
      state.setPlayheadMs(next);
      if (next >= duration) { state.pause(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
