// RemoveEffect({ trackId, clipId, effect }) — Video Editor Phase 10. Removes a `clip.effects`
// entry by id — `effect` is the full caller-supplied object so invert() can restore it exactly,
// same shape as RemoveKeyframe.js.
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  const index = (clip.effects || []).findIndex((e) => e.id === args.effect.id);
  if (index === -1) throw new Error(`Effect not found: ${args.effect.id} on clip ${args.clipId}`);
  clip.effects.splice(index, 1);
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const clip = getClip(prev, args.trackId, args.clipId);
  clip.effects = clip.effects || [];
  clip.effects.push(args.effect);
  return prev;
}

module.exports = { validate, apply, invert };
