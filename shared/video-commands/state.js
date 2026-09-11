// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): small pure helpers
// shared by every command module in this directory. Project state is plain JSON (§2's schema) —
// cloneState() is a simple JSON round-trip deep clone, not a structural-sharing/immer-style
// implementation. That's a deliberate simplicity choice for Phase 1 (correctness over
// performance — a video project's command log is small JSON, not a hot render loop); revisit
// only if profiling on a real project ever shows this matters.

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function getTrack(state, trackId) {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  return track;
}

function getClipIndex(track, clipId) {
  const index = track.clips.findIndex((c) => c.id === clipId);
  if (index === -1) throw new Error(`Clip not found: ${clipId} in track ${track.id}`);
  return index;
}

function getClip(state, trackId, clipId) {
  const track = getTrack(state, trackId);
  const index = getClipIndex(track, clipId);
  return track.clips[index];
}

// Reads a value at a dot/array path like ['tracks', 0, 'clips', 1, 'transform', 'scaleX'] —
// used by SetProperty's validate() to read the CURRENT value for a sanity check, and by tests to
// assert a specific field changed.
function getAtPath(state, pathParts) {
  return pathParts.reduce((node, key) => (node == null ? undefined : node[key]), state);
}

// Writes a value at a path on a CLONE of state, creating no new object identities beyond what
// JSON already gave cloneState() — every command module clones the whole state once via
// cloneState() before calling this, so mutating in place here is safe and simple.
function setAtPath(state, pathParts, value) {
  let node = state;
  for (let i = 0; i < pathParts.length - 1; i++) node = node[pathParts[i]];
  node[pathParts[pathParts.length - 1]] = value;
  return state;
}

module.exports = { cloneState, getTrack, getClipIndex, getClip, getAtPath, setAtPath };
