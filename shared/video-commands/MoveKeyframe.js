// MoveKeyframe({ trackId, clipId, keyframeIds, from, to }) — 08-G G4 (specs/.../08-v2/
// 08-g-canvas-motion-text-and-audio.md, keyframe navigation/remap): moves N keyframes (identified
// by id) on ONE clip from clip-relative timeMs `from` to `to`, as ONE durable command.
// Timeline.jsx's marker-drag gesture moves every keyframe object that shares the marker's
// original timeMs together (timelineUtils.js's keyframeMarkersForClip groups them for display) —
// they're really one user gesture ("drag this marker"), so this batches them the way
// SetProperties.js batches a multi-field gesture into one undo entry, rather than N separate
// AddKeyframe/RemoveKeyframe pairs the way the marker's own add/remove buttons do (those aren't a
// single continuous gesture the way a drag is).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  const clip = getClip(state, args.trackId, args.clipId);
  for (const id of args.keyframeIds) {
    const kf = (clip.keyframes || []).find((k) => k.id === id);
    if (!kf) throw new Error(`MoveKeyframe: keyframe ${id} not found on clip ${args.clipId}`);
    if (kf.timeMs !== args.from) {
      throw new Error(`MoveKeyframe: expected keyframe ${id} at timeMs ${args.from}, got ${kf.timeMs} — state may have changed since this command was created`);
    }
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  for (const id of args.keyframeIds) {
    clip.keyframes.find((k) => k.id === id).timeMs = args.to;
  }
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  const clip = getClip(prior, args.trackId, args.clipId);
  for (const id of args.keyframeIds) {
    clip.keyframes.find((k) => k.id === id).timeMs = args.from;
  }
  return prior;
}

module.exports = { validate, apply, invert };
