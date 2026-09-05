const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runCommand, invertCommand, prepareTrackCleanup } = require('./index');
const clip = id => ({ id, assetId: id, sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, effects: [], keyframes: [] });
const track = (id, clips = [], type = 'video') => ({ id, type, clips, order: 5, locked: false, muted: false, visible: true, height: 'tall' });
const state = () => ({ tracks: [track('v', [clip('c')]), track('empty'), track('a', [clip('sound')], 'audio')], transitions: [] });
function roundTrip(before, type, original) {
  const args = prepareTrackCleanup(before, type, original), after = runCommand(before, type, args);
  assert.deepEqual(invertCommand(after, type, args), before);
  assert.deepEqual(runCommand(after, 'Undo', { originalType: type, originalArgs: args }), before);
  assert.deepEqual(runCommand(before, type, JSON.parse(JSON.stringify(args))), after);
  return after;
}
test('delete last clip prunes its track and other empty rows atomically; undo restores all metadata', () => {
  const before = state();
  const after = roundTrip(before, 'DeleteClips', { deletions: [{ trackId: 'v', index: 0, clip: before.tracks[0].clips[0] }] });
  assert.deepEqual(after.tracks, [before.tracks[2]]);
});
test('partial delete retains the populated row and its timing', () => {
  const before = state(); const second = { ...clip('second'), timelineInMs: 3000, timelineOutMs: 4000 }; before.tracks[0].clips.push(second);
  const after = roundTrip(before, 'DeleteClip', { trackId: 'v', index: 0, clip: before.tracks[0].clips[0] });
  assert.deepEqual(after.tracks[0].clips, [second]);
});
test('moving final clip to a new track prunes source; undo recreates source before moving back', () => {
  const before = state();
  const after = roundTrip(before, 'MoveClips', { newTracks: [track('target')], moves: [{ clipId: 'c', fromTrackId: 'v', toTrackId: 'target', fromIndex: 0, fromTimelineInMs: 0, toTimelineInMs: 5000 }] });
  assert.deepEqual(after.tracks.map(t => t.id), ['a', 'target']);
});
test('ripple all audio/video to zero tracks; undo restores exact state', () => {
  const before = state();
  const after = roundTrip(before, 'RippleDeleteClips', { perTrack: before.tracks.filter(t => t.clips.length).map(t => ({ trackId: t.id, intervals: [{ startMs: 0, endMs: 1000, removals: [{ index: 0, clip: t.clips[0] }] }] })) });
  assert.deepEqual(after.tracks, []);
});
test('locked populated track rejects deletion before cleanup', () => {
  const before = state(); before.tracks[0].locked = true;
  assert.throws(() => prepareTrackCleanup(before, 'DeleteClip', { trackId: 'v', index: 0, clip: before.tracks[0].clips[0] }), /locked/);
  assert.equal(before.tracks.length, 3);
});
test('legacy command replay keeps empty tracks, so old positional edits and pins remain valid', () => {
  const before = state(); const args = { trackId: 'v', index: 0, clip: before.tracks[0].clips[0] };
  const after = runCommand(before, 'DeleteClip', args);
  assert.equal(after.tracks.length, 3); assert.deepEqual(invertCommand(after, 'DeleteClip', args), before);
});
test('stale or forged cleanup cannot remove populated tracks', () => {
  const before = state(), args = prepareTrackCleanup(before, 'DeleteClip', { trackId: 'v', index: 0, clip: before.tracks[0].clips[0] });
  args.prunedTracks.push({ index: 2, track: before.tracks[2] });
  assert.throws(() => runCommand(before, 'DeleteClip', args), /no longer matches/);
});
