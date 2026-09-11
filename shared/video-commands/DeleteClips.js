// DeleteClips({ deletions: [{ trackId, index, clip }, ...] }) — 08.2.2 §5 (specs/
// ai-creative-operations-platform/08-2-2-clip-placement-trim-and-ripple.md, multi-select plain
// delete). Batched version of DeleteClip.js: N clips removed together as ONE atomic command,
// keeping the gap on every track (no shift) — the multi-select counterpart to RippleDeleteClips,
// which does shift.
//
// Global descending-index sort for apply (ascending for invert) is safe across DIFFERENT tracks
// too: splicing on one track's array never affects another track's array, and within any single
// track's own subset the relative index order is preserved by a plain sort — so this doesn't need
// RippleDeleteClips.js's per-track grouping.
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const sorted = [...args.deletions].sort((a, b) => b.index - a.index);
  for (const { trackId, index } of sorted) {
    getTrack(next, trackId).clips.splice(index, 1);
  }
  if (args.transitions?.length) next.transitions = (next.transitions || []).filter(t => !args.transitions.some(removed => removed.id === t.id));
  return next;
}

function invert(state, args) {
  const prior = cloneState(state);
  const sorted = [...args.deletions].sort((a, b) => a.index - b.index);
  for (const { trackId, index, clip } of sorted) {
    getTrack(prior, trackId).clips.splice(index, 0, clip);
  }
  if (args.transitions?.length) prior.transitions = [...(prior.transitions || []), ...cloneState(args.transitions)];
  return prior;
}

module.exports = { validate, apply, invert };
