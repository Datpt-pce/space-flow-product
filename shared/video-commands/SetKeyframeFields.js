// SetKeyframeFields({ trackId, clipId, keyframeId, changes: [{ field, from, to }] }) — 08-G G5
// (ADR 0036, docs/decisions/0036-keyframe-custom-bezier-easing-minimal-slice.md): updates MULTIPLE
// flat scalar fields on ONE keyframe as a single atomic command. Needed because committing a custom
// bezier curve touches 5 fields at once (`easing: 'custom'` + `easingX1/Y1/X2/Y2`) in the SAME user
// gesture (drag a control-point handle, release) — SetKeyframeValue.js/SetKeyframeEasing.js are each
// hard-coded to exactly one field, and this is additive alongside them (not a replacement — their
// own call sites keep using them unchanged, matching this codebase's surgical-change convention).
// Every field here must be a flat primitive (string/number/undefined), never an object — Object.is
// per field is only safe under that constraint (same reasoning ADR 0035 already used to keep
// pivotX/pivotY as flat scalars instead of a nested {x,y} object).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  const clip = getClip(state, args.trackId, args.clipId);
  const kf = (clip.keyframes || []).find((k) => k.id === args.keyframeId);
  if (!kf) throw new Error(`SetKeyframeFields: keyframe ${args.keyframeId} not found on clip ${args.clipId}`);
  for (const c of args.changes) {
    if (!Object.is(kf[c.field], c.from)) {
      throw new Error(`SetKeyframeFields: expected keyframe ${args.keyframeId}'s ${c.field} to be ${JSON.stringify(c.from)}, got ${JSON.stringify(kf[c.field])} — state may have changed since this command was created`);
    }
  }
  assertAllInvariants(apply(state, args));
}

// setOrDelete: assigning `undefined` via `kf[field] = undefined` would leave the key PRESENT with
// an undefined value — structurally different from a keyframe that never had this field at all
// (every non-custom keyframe's easingX1/Y1/X2/Y2, for instance). `delete` instead keeps a keyframe
// that transitions custom->non-custom (or a fresh round-trip undo) byte-identical in shape to one
// that never touched these fields, matching how every other keyframe in this codebase represents
// "this optional field doesn't apply here" — plain absence, not an explicit undefined.
function setOrDelete(kf, field, value) {
  if (value === undefined) delete kf[field]; else kf[field] = value;
}

function apply(state, args) {
  const next = cloneState(state);
  const kf = getClip(next, args.trackId, args.clipId).keyframes.find((k) => k.id === args.keyframeId);
  for (const c of args.changes) setOrDelete(kf, c.field, c.to);
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  const kf = getClip(prior, args.trackId, args.clipId).keyframes.find((k) => k.id === args.keyframeId);
  for (let i = args.changes.length - 1; i >= 0; i--) setOrDelete(kf, args.changes[i].field, args.changes[i].from);
  return prior;
}

module.exports = { validate, apply, invert };
