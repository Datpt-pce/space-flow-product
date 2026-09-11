// ChangeTrackOrder({ trackId, fromOrder, toOrder }) — Video Editor Phase 1. Moves 1 track to a
// new position among the project's tracks, shifting every OTHER track's `order` field by 1 to
// close the gap/make room — a standard "move item in an ordered list" operation. `order` is the
// source of truth for track stacking (not array index — tracks in state.tracks can be in any
// array order; a real implementation always sorts by `order` for display).
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function reorderTo(state, trackId, fromOrder, toOrder) {
  const next = cloneState(state);
  for (const track of next.tracks) {
    if (track.id === trackId) {
      track.order = toOrder;
    } else if (fromOrder < toOrder && track.order > fromOrder && track.order <= toOrder) {
      track.order -= 1;
    } else if (fromOrder > toOrder && track.order >= toOrder && track.order < fromOrder) {
      track.order += 1;
    }
  }
  return next;
}

// 08-F F3 (specs/.../08-v2/08-f-timeline-authoring.md, "reorder invariants"): reorderTo()'s shift
// math picks a shift DIRECTION from `fromOrder` vs `toOrder` — a stale `fromOrder` (state moved on
// since the caller last read it) doesn't just apply against the wrong baseline, it can infer the
// WRONG direction entirely and silently produce a valid-looking but WRONG relative order (no
// duplicate/gap, so assertAllInvariants alone can't catch it — verified by hand: a stale fromOrder
// can leave every track's `.order` unique yet in the wrong relative sequence). Same
// "stale value rejected before it does damage" pattern SetProperty.js's own `from` check already
// uses, same wording.
function validate(state, args) {
  const track = getTrack(state, args.trackId);
  if (track.order !== args.fromOrder) {
    throw new Error(`ChangeTrackOrder: expected track ${args.trackId}'s current order to be ${args.fromOrder}, got ${track.order} — state may have changed since this command was created`);
  }
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return reorderTo(state, args.trackId, args.fromOrder, args.toOrder);
}

function invert(state, args) {
  return reorderTo(state, args.trackId, args.toOrder, args.fromOrder);
}

module.exports = { validate, apply, invert };
