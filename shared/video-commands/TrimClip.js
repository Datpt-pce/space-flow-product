// TrimClip({ trackId, clipId, from: {sourceInMs,sourceOutMs,timelineInMs,timelineOutMs},
// to: {...same 4 fields...} }) — Video Editor Phase 1. Changes a clip's in/out points on both
// the source (which part of the asset plays) and the timeline (where/how long it sits). `from`
// is the caller-supplied pre-trim values (not derived internally, see index.js header).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

// 08-G (specs/.../08-v2/08-g-canvas-motion-text-and-audio.md, acceptance §4 "Trim/split/retime
// remap keyframe deterministic") — a keyframe's `timeMs` is CLIP-RELATIVE (invariants.js's own
// assertKeyframeWithinClip comment: "so it moves with the clip when trimmed"), but this function
// used to just `Object.assign(clip, bounds)` and leave `clip.keyframes` untouched. Trimming the
// LEFT edge (timelineInMs moves forward) shifts the clip-relative origin without this — a keyframe
// that used to fire at absolute time `oldTimelineInMs + kf.timeMs` silently drifted to fire at
// `newTimelineInMs + kf.timeMs` instead (off by exactly the trimmed amount), the opposite of what
// SplitClip.js already does correctly for its own second-half rebase (`kf.timeMs -
// elapsedTimelineMs`). Fixed the same way here: shift every keyframe by the SAME delta
// `timelineInMs` itself moved, so its ABSOLUTE fire time is preserved. A keyframe that lands
// outside the new [0, newDuration] range this way (its source content got trimmed away entirely)
// is left for assertKeyframeWithinClip (invariants.js) to reject via validate() below — NOT
// silently dropped here, because apply()/invert() share this exact function and dropping data in
// apply() would make invert() unable to restore it (real, not hypothetical: this app's undo/redo
// is a durable command whose invert() must reproduce the prior state exactly, per 08-D D4).
function setBounds(state, args, bounds) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  const deltaMs = bounds.timelineInMs - clip.timelineInMs;
  const keyframes = deltaMs === 0 ? clip.keyframes
    : (clip.keyframes || []).map((kf) => ({ ...kf, timeMs: kf.timeMs - deltaMs }));
  Object.assign(clip, bounds, { keyframes });
  return next;
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return setBounds(state, args, args.to);
}

function invert(state, args) {
  return setBounds(state, args, args.from);
}

module.exports = { validate, apply, invert };
