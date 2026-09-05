const { cloneState } = require('./state');

// Opt in only at the new-edit boundary. Historical commands/pinned versions must
// replay with their original semantics, including tracks referenced by later edits.
const contentEdits = new Set(['DeleteClip', 'DeleteClips', 'RippleDelete', 'RippleDeleteClips',
  'MoveClip', 'MoveClips', 'UnpackCompoundClip']);

function emptyTracks(state) {
  return state.tracks.flatMap((track, index) => track.clips.length === 0 ? [{ index, track }] : []);
}

function prepareTrackCleanup(state, type, args) {
  if (!contentEdits.has(type)) return args;
  const { runCommand } = require('./index');
  const plain = { ...args };
  delete plain.prunedTracks;
  const next = runCommand(state, type, plain);
  return { ...plain, prunedTracks: cloneState(emptyTracks(next)) };
}

function pruneTracks(state, entries) {
  if (JSON.stringify(emptyTracks(state)) !== JSON.stringify(entries)) {
    throw new Error('Empty track cleanup no longer matches the document');
  }
  return { ...state, tracks: state.tracks.filter(track => track.clips.length > 0) };
}

function restoreTracks(state, entries) {
  const prior = cloneState(state);
  for (const { index, track } of entries) {
    if (track.clips.length || prior.tracks.some(t => t.id === track.id)) throw new Error('Invalid empty track restoration');
    prior.tracks.splice(index, 0, cloneState(track));
  }
  return prior;
}

module.exports = { prepareTrackCleanup, pruneTracks, restoreTracks };
