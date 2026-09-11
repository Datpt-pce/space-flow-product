// UnpackCompoundClip({ trackId, index, clip, newTracks }) — 08-F F5 / ADR 0034 (docs/decisions/
// 0034-compound-clip-minimal-slice.md): replaces one compound clip with the literal content of the
// nested timeline it embedded (fresh tracks, appended after every existing track), as ONE atomic
// durable transaction — same "many changes, one revision, one invert" contract DeleteClips/
// SetProperties already use, so a mid-operation failure can never leave the document with the
// compound clip gone but only SOME of its nested tracks re-created.
//
// `newTracks` (array of full track objects, each already containing its own `clips`) is fully
// pre-computed by the caller (frontend/src/video/store.js's pinned-seq fetch + timelineInMs offset
// math) — this module stays a pure function of its args, same "apply/invert do no independent
// computation" contract every command here follows (see InsertClip.js's header). `trackId`/
// `index`/`clip` are exactly DeleteClip.js's own args shape (the compound clip being removed),
// reused verbatim rather than inventing a different removal contract.
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  const track = getTrack(next, args.trackId);
  track.clips.splice(args.index, 1);
  for (const newTrack of args.newTracks) next.tracks.push(newTrack);
  if (args.newTransitions?.length) next.transitions = [...(next.transitions || []), ...args.newTransitions];
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const newTrackIds = new Set(args.newTracks.map((t) => t.id));
  prev.tracks = prev.tracks.filter((t) => !newTrackIds.has(t.id));
  if (args.newTransitions?.length) {
    const ids = new Set(args.newTransitions.map(t => t.id));
    prev.transitions = (prev.transitions || []).filter(t => !ids.has(t.id));
  }
  const track = getTrack(prev, args.trackId);
  track.clips.splice(args.index, 0, args.clip);
  return prev;
}

module.exports = { validate, apply, invert };
