// New batch timelines opt into centered cuts. Existing transitions keep their
// legacy export timing until explicitly authored with this mode.
const CENTERED_TIMING = 'centered-v1';
function transitionFrames(transition, fps) {
  const total = Math.round(transition.durationMs * fps / 1000);
  return { total, before: Math.floor(total / 2), after: total - Math.floor(total / 2) };
}
function transitionWindow(transition, cutMs, fps) {
  if (transition.timingMode !== CENTERED_TIMING) return { startMs: cutMs - transition.durationMs / 2, durationMs: transition.durationMs };
  const frames = transitionFrames(transition, fps);
  return { startMs: cutMs - frames.before * 1000 / fps, durationMs: frames.total * 1000 / fps };
}
module.exports = { CENTERED_TIMING, transitionFrames, transitionWindow };
