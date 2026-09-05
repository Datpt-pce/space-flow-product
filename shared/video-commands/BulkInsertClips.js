// BulkInsertClips({ newTracks, insertions }) — 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md):
// the one-timeline half of a BulkTimelineImportOperation (backend/routes/video-bulk-import.js) —
// N assets get appended onto a single timeline as ONE atomic durable transaction, same
// "many changes, one revision, one invert" contract UnpackCompoundClip.js already established (see
// its own header) so a mid-operation failure can never leave a timeline with only SOME of a
// target's assets placed.
//
// `newTracks` (full track objects, empty `clips`) and `insertions` ({ trackId, clip }, `trackId`
// pointing at either an existing track or one of `newTracks`) are fully pre-computed by the caller
// — this module stays a pure function of its args, same "apply/invert do no independent
// computation" contract every command here follows (see InsertClip.js's header). Every insertion
// APPENDS (`clips.push`, not a caller-supplied index) — Bulk Import always places its assets after
// whatever a target timeline already has, never reorders existing content, so there is no need to
// reason about shifting indices when several insertions land on the same track.
const { cloneState, getTrack } = require('./state');
const { assertAllInvariants } = require('./invariants');

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  const next = cloneState(state);
  // Deep-clone args' own tracks/clips before pushing them into `next` — a bare push would leave
  // `next.tracks[i]` and `args.newTracks[i]` as the SAME object, so the insertions loop below
  // (which mutates a just-pushed new track's `.clips` in place) would also mutate the caller's own
  // `args`, corrupting a later re-apply of this exact command (e.g. redo, or roundTrip's
  // apply->invert->apply in shared/video-commands/index.test.js) with clips already baked in from
  // the first run.
  const { newTracks, insertions } = cloneState({ newTracks: args.newTracks, insertions: args.insertions });
  for (const track of newTracks) next.tracks.push(track);
  for (const { trackId, clip } of insertions) {
    getTrack(next, trackId).clips.push(clip);
  }
  if (args.transitions?.length) next.transitions = [...(next.transitions || []), ...cloneState(args.transitions)];
  return next;
}

function invert(state, args) {
  const prev = cloneState(state);
  const insertedClipIds = new Set(args.insertions.map((i) => i.clip.id));
  for (const { trackId } of args.insertions) {
    const track = getTrack(prev, trackId);
    track.clips = track.clips.filter((c) => !insertedClipIds.has(c.id));
  }
  const newTrackIds = new Set(args.newTracks.map((t) => t.id));
  prev.tracks = prev.tracks.filter((t) => !newTrackIds.has(t.id));
  if (args.transitions?.length) prev.transitions = (prev.transitions || []).filter(t => !args.transitions.some(inserted => inserted.id === t.id));
  return prev;
}

module.exports = { validate, apply, invert };
