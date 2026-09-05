// AddEffect({ trackId, clipId, effect }) — Video Editor Phase 10 (specs/space-flow-master-plan/
// 04-video-editor.md §5). Generic add for ANY entry in `clip.effects` (§2 schema:
// effect(type/params/enabled/order)) — not chroma-key/blend-mode specific, so Phase 11/12's own
// effect types (color grading, filters) can reuse this exact command instead of each needing their
// own. Mirrors AddKeyframe.js's shape precisely; updating an existing effect's params uses the
// already-generic SetProperty (a path into `effects[i].params`), only add/remove need dedicated
// commands (array-splice semantics SetProperty doesn't do).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  clip.effects = clip.effects || [];
  clip.effects.push(args.effect);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const clip = getClip(prev, args.trackId, args.clipId);
  clip.effects = (clip.effects || []).filter((e) => e.id !== args.effect.id);
  return prev;
}

module.exports = { validate, apply, invert };
