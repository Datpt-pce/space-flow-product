// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md) task checklist: "Test:
// round-trip apply->invert->apply mỗi command; contract test client/server cùng state sau cùng
// chuỗi command ngẫu nhiên." Two suites below:
//   1. Per-command round-trip: for each of the 11 commands, apply(base, args) -> state1;
//      invert(state1, args) -> should equal base EXACTLY; apply(that, args) again -> should
//      equal state1 EXACTLY. Also proves validate() actually rejects an invariant-violating call
//      before touching state (acceptance criteria: "command vi phạm invariant bị validate()
//      reject trước apply(), message rõ").
//   2. Property-based random-sequence test: a random valid command sequence, verifying (a) a
//      snapshot-at-step-k + replay-the-tail reconstructs the exact same final state as replaying
//      everything from the start (the literal scenario Phase 1's other acceptance criteria
//      describes: "kill server giữa lúc ghi command log → replay log+snapshot khôi phục đúng
//      state cuối"), and (b) undoing every command in reverse order returns to the exact
//      original state, then redoing reproduces the exact same final state again.
//
// Run with: node shared/video-commands/index.test.js

const assert = require('assert');
const { runCommand, invertCommand } = require('./index');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function baseState() {
  return {
    schemaVersion: 1,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    colorSpace: 'sRGB',
    audioRate: 48000,
    sequence: { markers: [] },
    tracks: [
      {
        id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true,
        clips: [
          {
            id: 'clip-1', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 5000,
            timelineInMs: 0, timelineOutMs: 5000, speed: 1,
            transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
            effects: [], keyframes: [],
          },
        ],
      },
      { id: 'track-a1', type: 'audio', order: 1, locked: false, muted: false, visible: true, clips: [] },
    ],
    transitions: [],
  };
}

// roundTrip(type, base, args): the shared assertion every per-command test below runs.
function roundTrip(type, base, args) {
  const after = runCommand(base, type, args);
  assert.notDeepStrictEqual(after, base, `${type}: apply() produced no change at all — test args are not exercising anything`);
  const before = invertCommand(after, type, args);
  assert.deepStrictEqual(before, base, `${type}: invert(apply(base)) did not reconstruct base exactly`);
  const after2 = runCommand(before, type, args);
  assert.deepStrictEqual(after2, after, `${type}: re-apply after invert did not reproduce the same "after" state`);
}

function main() {
  check('InsertClip: round-trip', () => {
    const base = baseState();
    roundTrip('InsertClip', base, {
      trackId: 'track-v1', index: 1,
      clip: { id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] },
    });
  });

  check('InsertClip: validate() rejects an overlapping insert before touching state', () => {
    const base = baseState();
    const badArgs = { trackId: 'track-v1', index: 0, clip: { id: 'clip-overlap', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 2000, timelineOutMs: 3000, speed: 1, transform: {}, effects: [], keyframes: [] } };
    assert.throws(() => runCommand(base, 'InsertClip', badArgs), /overlaps/);
  });

  check('MoveClip: round-trip', () => {
    const base = baseState();
    roundTrip('MoveClip', base, {
      clipId: 'clip-1',
      from: { trackId: 'track-v1', index: 0, timelineInMs: 0 },
      to: { trackId: 'track-v1', index: 0, timelineInMs: 10000 },
    });
  });

  check('MoveClip: round-trip, same track, forward past another clip (the off-by-one case Phase 6 fixed by writing the caller correctly)', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] });
    // Move clip-1 (index 0) to land AFTER clip-2 — final array should be [clip-2, clip-1].
    // to.index=1 is the FINAL post-removal index (see MoveClip.js's header comment), not a count
    // against the pre-removal 2-element array.
    const args = {
      clipId: 'clip-1',
      from: { trackId: 'track-v1', index: 0, timelineInMs: 0 },
      to: { trackId: 'track-v1', index: 1, timelineInMs: 8000 },
    };
    const after = runCommand(base, 'MoveClip', args);
    assert.deepStrictEqual(after.tracks[0].clips.map((c) => c.id), ['clip-2', 'clip-1']);
    assert.strictEqual(after.tracks[0].clips[1].timelineInMs, 8000);

    roundTrip('MoveClip', base, args);
  });

  check('MoveClips: round-trip, batch preserves relative time/track offset across 2 clips', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 6000, timelineOutMs: 9000, speed: 1, transform: {}, effects: [], keyframes: [] });
    base.tracks.push({ id: 'track-v2', type: 'video', order: 5, locked: false, muted: false, visible: true, clips: [] });
    const args = {
      moves: [
        { clipId: 'clip-1', fromTrackId: 'track-v1', toTrackId: 'track-v2', fromTimelineInMs: 0, toTimelineInMs: 1000 },
        { clipId: 'clip-2', fromTrackId: 'track-v1', toTrackId: 'track-v2', fromTimelineInMs: 6000, toTimelineInMs: 7000 },
      ],
    };
    const after = runCommand(base, 'MoveClips', args);
    assert.strictEqual(after.tracks[0].clips.length, 0); // track-v1 emptied
    const movedIds = after.tracks[2].clips.map((c) => c.id).sort();
    assert.deepStrictEqual(movedIds, ['clip-1', 'clip-2']);
    const c1 = after.tracks[2].clips.find((c) => c.id === 'clip-1');
    const c2 = after.tracks[2].clips.find((c) => c.id === 'clip-2');
    assert.strictEqual(c1.timelineInMs, 1000);
    assert.strictEqual(c1.timelineOutMs, 6000); // duration (5000ms) preserved
    assert.strictEqual(c2.timelineInMs, 7000);
    assert.strictEqual(c2.timelineOutMs, 10000);
    assert.strictEqual(c2.timelineInMs - c1.timelineOutMs, 1000); // original 1000ms gap between them, unchanged

    roundTrip('MoveClips', base, args);
  });

  check('MoveClips: validate() rejects the WHOLE batch if any one move would overlap', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 6000, timelineOutMs: 9000, speed: 1, transform: {}, effects: [], keyframes: [] });
    base.tracks.push({ id: 'track-v2', type: 'video', order: 5, locked: false, muted: false, visible: true, clips: [{ id: 'blocker', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 900, timelineOutMs: 1900, speed: 1, transform: {}, effects: [], keyframes: [] }] });
    const args = {
      moves: [
        { clipId: 'clip-1', fromTrackId: 'track-v1', toTrackId: 'track-v2', fromTimelineInMs: 0, toTimelineInMs: 1000 }, // collides with 'blocker'
        { clipId: 'clip-2', fromTrackId: 'track-v1', toTrackId: 'track-v2', fromTimelineInMs: 6000, toTimelineInMs: 7000 }, // this one alone would be fine
      ],
    };
    assert.throws(() => runCommand(base, 'MoveClips', args), /overlaps/);
    // Atomic: NEITHER clip moved, not even the one that would have been fine on its own.
    assert.strictEqual(base.tracks[0].clips.length, 2);
  });

  check('AddTrack: round-trip', () => {
    const base = baseState();
    roundTrip('AddTrack', base, { track: { id: 'track-v2', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [] } });
  });

  check('RemoveTrack: round-trip, restores at the same array index', () => {
    const base = baseState();
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [] });
    roundTrip('RemoveTrack', base, { track: base.tracks[2], index: 2 });
  });

  check('SetClipSpeed: round-trip, speed and timelineOutMs change together', () => {
    const base = baseState();
    roundTrip('SetClipSpeed', base, {
      trackId: 'track-v1', clipId: 'clip-1',
      from: { speed: 1, timelineOutMs: 5000 },
      to: { speed: 2, timelineOutMs: 2500 },
    });
  });

  check('SetClipSpeed: validate() rejects a resize that would overlap the next clip', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const args = { trackId: 'track-v1', clipId: 'clip-1', from: { speed: 1, timelineOutMs: 5000 }, to: { speed: 0.5, timelineOutMs: 10000 } };
    assert.throws(() => runCommand(base, 'SetClipSpeed', args), /overlaps/);
  });

  check('AddEffect: round-trip', () => {
    const base = baseState();
    roundTrip('AddEffect', base, {
      trackId: 'track-v1', clipId: 'clip-1',
      effect: { id: 'fx-1', type: 'chromaKey', enabled: true, order: 0, params: { color: '0x00FF00', similarity: 0.3, blend: 0.1 } },
    });
  });

  check('RemoveEffect: round-trip', () => {
    const base = baseState();
    const effect = { id: 'fx-1', type: 'chromaKey', enabled: true, order: 0, params: { color: '0x00FF00', similarity: 0.3, blend: 0.1 } };
    base.tracks[0].clips[0].effects = [effect];
    roundTrip('RemoveEffect', base, { trackId: 'track-v1', clipId: 'clip-1', effect });
  });

  check('RemoveTrack: validate() refuses to remove a track that still has clips', () => {
    const base = baseState();
    assert.throws(() => runCommand(base, 'RemoveTrack', { track: base.tracks[0], index: 0 }), /still has 1 clip/);
  });

  check('TrimClip: round-trip', () => {
    const base = baseState();
    roundTrip('TrimClip', base, {
      trackId: 'track-v1', clipId: 'clip-1',
      from: { sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000 },
      to: { sourceInMs: 1000, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 4000 },
    });
  });

  check('TrimClip: validate() rejects a trim that leaves the clip shorter than 1 frame', () => {
    const base = baseState(); // fps: 30 -> 1 frame ~= 33.33ms
    const badArgs = {
      trackId: 'track-v1', clipId: 'clip-1',
      from: { sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000 },
      to: { sourceInMs: 0, sourceOutMs: 20, timelineInMs: 0, timelineOutMs: 20 },
    };
    assert.throws(() => runCommand(base, 'TrimClip', badArgs), /shorter than 1 frame/);
  });

  // 08-G (acceptance §4 "Trim/split/retime remap keyframe deterministic") — a LEFT-edge trim
  // (timelineInMs moves forward, matching Timeline.jsx's real handleTrimStart 'left' branch, not
  // just an arbitrary bounds combination) must shift every keyframe's clip-relative `timeMs` by
  // the SAME delta, so its ABSOLUTE fire time is unchanged — before this fix, TrimClip left
  // `clip.keyframes` completely untouched, silently drifting animation timing by the trimmed
  // amount on every left-edge trim of an animated clip.
  check('TrimClip: left-edge trim shifts keyframe timeMs by the SAME delta timelineInMs moved (preserves absolute fire time)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-1', timeMs: 1000, properties: { x: 10 } },
      { id: 'kf-2', timeMs: 3000, properties: { x: 90 } },
    ];
    const args = {
      trackId: 'track-v1', clipId: 'clip-1',
      // Left edge dragged in by 500ms: timelineInMs 0->500, sourceInMs shifts to match, right edge untouched.
      from: { sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000 },
      to: { sourceInMs: 500, sourceOutMs: 5000, timelineInMs: 500, timelineOutMs: 5000 },
    };
    const after = runCommand(base, 'TrimClip', args);
    const kfs = after.tracks[0].clips[0].keyframes;
    assert.strictEqual(kfs.find((k) => k.id === 'kf-1').timeMs, 500, 'kf-1: 1000 - 500 delta = 500');
    assert.strictEqual(kfs.find((k) => k.id === 'kf-2').timeMs, 2500, 'kf-2: 3000 - 500 delta = 2500');
    // Absolute fire time preserved: newTimelineInMs(500) + newTimeMs(500) === oldTimelineInMs(0) + oldTimeMs(1000).
    assert.strictEqual(after.tracks[0].clips[0].timelineInMs + kfs.find((k) => k.id === 'kf-1').timeMs, 1000);

    roundTrip('TrimClip', base, args); // undo must restore the ORIGINAL keyframes exactly, not just bounds
  });

  check('TrimClip: right-edge trim (timelineInMs unchanged) leaves keyframe timeMs untouched', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [{ id: 'kf-1', timeMs: 1000, properties: { x: 10 } }];
    const args = {
      trackId: 'track-v1', clipId: 'clip-1',
      from: { sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000 },
      to: { sourceInMs: 0, sourceOutMs: 4000, timelineInMs: 0, timelineOutMs: 4000 },
    };
    const after = runCommand(base, 'TrimClip', args);
    assert.strictEqual(after.tracks[0].clips[0].keyframes[0].timeMs, 1000);
    roundTrip('TrimClip', base, args);
  });

  check('TrimClip: validate() rejects a left-edge trim that would push a keyframe before the new start (correctly detects drift that used to slip through silently)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [{ id: 'kf-1', timeMs: 400, properties: { x: 10 } }];
    const badArgs = {
      trackId: 'track-v1', clipId: 'clip-1',
      // Trim in by 500ms — kf-1 at 400ms clip-relative was inside the trimmed-away portion.
      from: { sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000 },
      to: { sourceInMs: 500, sourceOutMs: 5000, timelineInMs: 500, timelineOutMs: 5000 },
    };
    assert.throws(() => runCommand(base, 'TrimClip', badArgs), /outside the clip's duration/);
    assert.strictEqual(base.tracks[0].clips[0].keyframes.length, 1, 'rejected command must not mutate the original state');
  });

  check('SplitClip: round-trip, keyframes redistributed correctly on both sides', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-early', propertyPath: 'transform.opacity', timeMs: 500, value: 0.2, easing: 'linear' },
      { id: 'kf-late', propertyPath: 'transform.opacity', timeMs: 4000, value: 0.8, easing: 'linear' },
    ];
    const originalClip = base.tracks[0].clips[0];
    const args = { trackId: 'track-v1', index: 0, originalClip, splitAtMs: 2500, newClipId: 'clip-1b' };

    const after = runCommand(base, 'SplitClip', args);
    assert.strictEqual(after.tracks[0].clips.length, 2);
    assert.strictEqual(after.tracks[0].clips[0].keyframes.length, 1);
    assert.strictEqual(after.tracks[0].clips[0].keyframes[0].id, 'kf-early');
    assert.strictEqual(after.tracks[0].clips[1].keyframes.length, 1);
    assert.strictEqual(after.tracks[0].clips[1].keyframes[0].id, 'kf-late');
    assert.strictEqual(after.tracks[0].clips[1].keyframes[0].timeMs, 4000 - 2500);

    roundTrip('SplitClip', base, args);
  });

  check('SplitClip: validate() rejects a split point outside the clip', () => {
    const base = baseState();
    const args = { trackId: 'track-v1', index: 0, originalClip: base.tracks[0].clips[0], splitAtMs: 9000, newClipId: 'clip-1b' };
    assert.throws(() => runCommand(base, 'SplitClip', args), /must be strictly inside/);
  });

  check('RippleDelete: round-trip, downstream clip actually shifts left by the removed duration', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const args = { trackId: 'track-v1', index: 0, clip: base.tracks[0].clips[0] };

    const after = runCommand(base, 'RippleDelete', args);
    assert.strictEqual(after.tracks[0].clips.length, 1);
    assert.strictEqual(after.tracks[0].clips[0].id, 'clip-2');
    assert.strictEqual(after.tracks[0].clips[0].timelineInMs, 0);
    assert.strictEqual(after.tracks[0].clips[0].timelineOutMs, 3000);

    roundTrip('RippleDelete', base, args);
  });

  check('DeleteClip: round-trip, downstream clip keeps its own position (no ripple)', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const args = { trackId: 'track-v1', index: 0, clip: base.tracks[0].clips[0] };

    const after = runCommand(base, 'DeleteClip', args);
    assert.strictEqual(after.tracks[0].clips.length, 1);
    assert.strictEqual(after.tracks[0].clips[0].id, 'clip-2');
    assert.strictEqual(after.tracks[0].clips[0].timelineInMs, 5000); // unchanged — DeleteClip keeps the gap
    assert.strictEqual(after.tracks[0].clips[0].timelineOutMs, 8000);

    roundTrip('DeleteClip', base, args);
  });

  check('UnpackCompoundClip: round-trip, replaces the compound clip with 2 fresh tracks holding its nested content', () => {
    const base = baseState();
    // clip-1 (the pre-existing base clip) plays the role of a compound clip embedding a 2-track
    // nested timeline (1 video clip, 1 audio clip) — newTracks are exactly what
    // frontend/src/video/store.js would pre-compute (fresh track/clip ids, times already offset by
    // the compound clip's own timelineInMs).
    const args = {
      trackId: 'track-v1', index: 0, clip: base.tracks[0].clips[0],
      newTracks: [
        {
          id: 'nested-v1', type: 'video', order: 2, locked: false, muted: false, visible: true,
          clips: [{ id: 'nested-clip-v', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
        },
        {
          id: 'nested-a1', type: 'audio', order: 3, locked: false, muted: false, visible: true,
          clips: [{ id: 'nested-clip-a', assetId: 'asset-3', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
        },
      ],
    };

    const after = runCommand(base, 'UnpackCompoundClip', args);
    assert.strictEqual(after.tracks[0].clips.length, 0); // compound clip removed, gap kept (no ripple)
    assert.strictEqual(after.tracks.length, 4); // original 2 tracks + 2 new nested tracks
    assert.strictEqual(after.tracks[2].id, 'nested-v1');
    assert.strictEqual(after.tracks[3].id, 'nested-a1');

    roundTrip('UnpackCompoundClip', base, args);
  });

  check('BulkInsertClips: round-trip, appends onto an existing track AND a brand-new track in one transaction', () => {
    const base = baseState();
    const args = {
      newTracks: [
        { id: 'bulk-a2', type: 'audio', order: 2, locked: false, muted: false, visible: true, clips: [] },
      ],
      insertions: [
        { trackId: 'track-v1', clip: { id: 'bulk-clip-v', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] } },
        { trackId: 'bulk-a2', clip: { id: 'bulk-clip-a', assetId: 'asset-3', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, transform: {}, effects: [], keyframes: [] } },
      ],
    };

    const after = runCommand(base, 'BulkInsertClips', args);
    assert.strictEqual(after.tracks.length, 3); // original 2 + 1 new
    assert.strictEqual(after.tracks[0].clips.length, 2); // existing clip-1 kept, bulk-clip-v appended
    assert.strictEqual(after.tracks[2].id, 'bulk-a2');
    assert.strictEqual(after.tracks[2].clips[0].id, 'bulk-clip-a');

    roundTrip('BulkInsertClips', base, args);
  });

  check('DeleteClips: round-trip, batch across 2 DIFFERENT tracks, neither track ripples', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    base.tracks[1].clips.push({ id: 'clip-a1', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const args = {
      deletions: [
        { trackId: 'track-v1', index: 0, clip: base.tracks[0].clips[0] }, // clip-1
        { trackId: 'track-a1', index: 0, clip: base.tracks[1].clips[0] }, // clip-a1
      ],
    };
    const after = runCommand(base, 'DeleteClips', args);
    assert.strictEqual(after.tracks[0].clips.length, 1);
    assert.strictEqual(after.tracks[0].clips[0].id, 'clip-2');
    assert.strictEqual(after.tracks[0].clips[0].timelineInMs, 5000); // no ripple
    assert.strictEqual(after.tracks[1].clips.length, 0);

    roundTrip('DeleteClips', base, args);
  });

  check('RippleDeleteClips: merged touching interval + separate interval on the SAME track shift a downstream clip by the TOTAL removed duration exactly once (no double-shift)', () => {
    const base = baseState();
    const track = base.tracks[0];
    track.clips = [
      { id: 'A', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] },
      { id: 'B', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 1000, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }, // touches A -> merges with it
      { id: 'C', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 3000, timelineOutMs: 4000, speed: 1, transform: {}, effects: [], keyframes: [] }, // gap before it -> its own interval
      { id: 'D', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 6000, timelineOutMs: 7000, speed: 1, transform: {}, effects: [], keyframes: [] }, // NOT selected — downstream, must shift
    ];
    const args = {
      perTrack: [
        {
          trackId: 'track-v1',
          intervals: [
            { startMs: 0, endMs: 2000, removals: [{ index: 0, clip: track.clips[0] }, { index: 1, clip: track.clips[1] }] },
            { startMs: 3000, endMs: 4000, removals: [{ index: 2, clip: track.clips[2] }] },
          ],
        },
      ],
    };
    const after = runCommand(base, 'RippleDeleteClips', args);
    assert.strictEqual(after.tracks[0].clips.length, 1);
    const d = after.tracks[0].clips[0];
    assert.strictEqual(d.id, 'D');
    // total removed duration = 2000 (A+B) + 1000 (C) = 3000 -> D: 6000 -> 3000, exactly once.
    assert.strictEqual(d.timelineInMs, 3000);
    assert.strictEqual(d.timelineOutMs, 4000);

    roundTrip('RippleDeleteClips', base, args);
  });

  check('RippleDeleteClips: 2 DIFFERENT tracks ripple INDEPENDENTLY (deleting on one never shifts the other)', () => {
    const base = baseState();
    base.tracks[1].clips.push(
      { id: 'X', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] },
      { id: 'Y', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 2000, timelineOutMs: 3000, speed: 1, transform: {}, effects: [], keyframes: [] },
    );
    const args = {
      perTrack: [
        { trackId: 'track-v1', intervals: [{ startMs: 0, endMs: 5000, removals: [{ index: 0, clip: base.tracks[0].clips[0] }] }] },
      ],
    };
    const after = runCommand(base, 'RippleDeleteClips', args);
    assert.strictEqual(after.tracks[0].clips.length, 0);
    // track-a1 (index 1) was never listed in perTrack — X/Y stay exactly where they were.
    assert.strictEqual(after.tracks[1].clips[0].timelineInMs, 0);
    assert.strictEqual(after.tracks[1].clips[1].timelineInMs, 2000);

    roundTrip('RippleDeleteClips', base, args);
  });

  check('SetProperty: round-trip', () => {
    const base = baseState();
    roundTrip('SetProperty', base, { path: ['tracks', 0, 'clips', 0, 'transform', 'opacity'], from: 1, to: 0.5 });
  });

  check('SetProperty: validate() rejects a stale "from" value (state changed since command was created)', () => {
    const base = baseState();
    assert.throws(
      () => runCommand(base, 'SetProperty', { path: ['tracks', 0, 'clips', 0, 'transform', 'opacity'], from: 0.9, to: 0.5 }),
      /expected current value/,
    );
  });

  // 08-G G3 crop/mask (2026-09-04): `clip.crop` is set through the SAME generic SetProperty path
  // (no new command) — these tests exercise invariants.js's new assertValidCrop() via that path,
  // matching how TrimClip's own keyframe-remap tests above exercise assertKeyframeWithinClip.
  check('SetProperty: round-trip, edits one leaf field (crop.width) of an already-set clip.crop', () => {
    // Leaf path (`crop.width`, a plain number), not a whole-object write — SetProperty's validate()
    // compares `from` via `Object.is`, reference-equality for objects, so a whole-object round-trip
    // starting from a hand-built literal (rather than the exact live reference) would spuriously
    // fail here even though the 2 objects are deep-equal (EffectsPanel.jsx's commitCropField has the
    // full reasoning). Leaf primitive paths sidestep that entirely, matching `transform.x`'s own
    // established precedent for every other per-property field in this codebase.
    const base = baseState();
    base.tracks[0].clips[0].crop = { x: 0, y: 0, width: 1, height: 1 };
    roundTrip('SetProperty', base, {
      path: ['tracks', 0, 'clips', 0, 'crop', 'width'], from: 1, to: 0.5,
    });
  });

  check('SetProperty: validate() rejects a crop with non-positive width via assertValidCrop', () => {
    const base = baseState();
    assert.throws(
      () => runCommand(base, 'SetProperty', {
        path: ['tracks', 0, 'clips', 0, 'crop'], from: undefined, to: { x: 0, y: 0, width: 0, height: 1 },
      }),
      /positive width\/height/,
    );
  });

  check('SetProperty: validate() rejects a crop window extending past the source frame (x+width > 1)', () => {
    const base = baseState();
    assert.throws(
      () => runCommand(base, 'SetProperty', {
        path: ['tracks', 0, 'clips', 0, 'crop'], from: undefined, to: { x: 0.6, y: 0, width: 0.6, height: 1 },
      }),
      /extends outside the source frame/,
    );
  });

  check('SetProperty: a clip with no clip.crop at all is untouched by assertValidCrop (unrelated field edit still round-trips)', () => {
    const base = baseState();
    roundTrip('SetProperty', base, { path: ['tracks', 0, 'clips', 0, 'transform', 'opacity'], from: 1, to: 0.7 });
  });

  check('SetProperties: round-trip, batches multiple fields as one command', () => {
    const base = baseState();
    roundTrip('SetProperties', base, {
      changes: [
        { path: ['tracks', 0, 'clips', 0, 'transform', 'x'], from: 0, to: 100 },
        { path: ['tracks', 0, 'clips', 0, 'transform', 'y'], from: 0, to: 50 },
      ],
    });
  });

  check('SetProperties: validate() rejects if ANY entry has a stale "from" value', () => {
    const base = baseState();
    assert.throws(
      () => runCommand(base, 'SetProperties', {
        changes: [
          { path: ['tracks', 0, 'clips', 0, 'transform', 'x'], from: 0, to: 100 },
          { path: ['tracks', 0, 'clips', 0, 'transform', 'y'], from: 999, to: 50 },
        ],
      }),
      /expected current value/,
    );
    // Rejected before apply — the first entry's field must be untouched.
    assert.strictEqual(base.tracks[0].clips[0].transform.x, 0);
  });

  // 08.2.1 (specs/ai-creative-operations-platform/08-2-1-selection-navigation-and-feedback.md §4):
  // EffectsPanel.jsx's new multi-select "Mixed" editing batches a field edit across N DIFFERENT
  // clips (possibly on different tracks) into exactly ONE undo entry, by exploiting the fact that
  // `changes[].path` is fully generic — every prior caller of SetProperties only ever touched paths
  // within a SINGLE clip (e.g. TransformOverlay.jsx's x+y or scaleX+scaleY). This is a new USAGE
  // PATTERN of already-generic code, not a new command — this test is the first to exercise it.
  check('SetProperties: round-trip, batches a field across 2 DIFFERENT clips on 2 DIFFERENT tracks as one command', () => {
    const base = baseState();
    base.tracks[1].clips.push({
      id: 'clip-audio-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 4000,
      timelineInMs: 0, timelineOutMs: 4000, speed: 1, volume: 1,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      effects: [], keyframes: [],
    });
    base.tracks[0].clips[0].volume = 1;
    roundTrip('SetProperties', base, {
      changes: [
        { path: ['tracks', 0, 'clips', 0, 'volume'], from: 1, to: 0.5 },
        { path: ['tracks', 1, 'clips', 0, 'volume'], from: 1, to: 0.5 },
      ],
    });
  });

  check('AddKeyframe: round-trip', () => {
    const base = baseState();
    roundTrip('AddKeyframe', base, {
      trackId: 'track-v1', clipId: 'clip-1',
      keyframe: { id: 'kf-1', propertyPath: 'transform.opacity', timeMs: 1000, value: 0.5, easing: 'linear' },
    });
  });

  check('AddKeyframe: validate() rejects a keyframe outside the clip duration', () => {
    const base = baseState();
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframe: { id: 'kf-oob', propertyPath: 'transform.opacity', timeMs: 9000, value: 0.5, easing: 'linear' } };
    assert.throws(() => runCommand(base, 'AddKeyframe', args), /outside the clip's duration/);
  });

  check('RemoveKeyframe: round-trip', () => {
    const base = baseState();
    const keyframe = { id: 'kf-1', propertyPath: 'transform.opacity', timeMs: 1000, value: 0.5, easing: 'linear' };
    base.tracks[0].clips[0].keyframes = [keyframe];
    roundTrip('RemoveKeyframe', base, { trackId: 'track-v1', clipId: 'clip-1', keyframe });
  });

  check('MoveKeyframe: round-trip, moves 2 keyframes sharing a marker together', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
      { id: 'kf-y', propertyPath: 'transform.y', timeMs: 1000, value: 20, easing: 'linear' },
    ];
    roundTrip('MoveKeyframe', base, {
      trackId: 'track-v1', clipId: 'clip-1', keyframeIds: ['kf-x', 'kf-y'], from: 1000, to: 2000,
    });
  });

  check('MoveKeyframe: validate() rejects a stale "from" (keyframe moved since command was created)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframeIds: ['kf-x'], from: 500, to: 2000 };
    assert.throws(() => runCommand(base, 'MoveKeyframe', args), /expected keyframe kf-x at timeMs 500/);
  });

  check('MoveKeyframe: validate() rejects landing on an existing keyframe for the same property', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x-1', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
      { id: 'kf-x-2', propertyPath: 'transform.x', timeMs: 2000, value: 30, easing: 'linear' },
    ];
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframeIds: ['kf-x-1'], from: 1000, to: 2000 };
    assert.throws(() => runCommand(base, 'MoveKeyframe', args), /2 keyframes for transform\.x at the same timeMs/);
  });

  check('MoveKeyframe: allows landing on another marker\'s time when properties do not overlap', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
      { id: 'kf-y', propertyPath: 'transform.y', timeMs: 2000, value: 20, easing: 'linear' },
    ];
    roundTrip('MoveKeyframe', base, {
      trackId: 'track-v1', clipId: 'clip-1', keyframeIds: ['kf-x'], from: 1000, to: 2000,
    });
  });

  check('SetKeyframeValue: round-trip, only the value changes, timeMs/propertyPath untouched', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    roundTrip('SetKeyframeValue', base, {
      trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x', from: 10, to: 42,
    });
  });

  check('SetKeyframeValue: validate() rejects a stale "from" (value changed since command was created)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x', from: 999, to: 42 };
    assert.throws(() => runCommand(base, 'SetKeyframeValue', args), /expected keyframe kf-x's value to be 999/);
  });

  check('SetKeyframeValue: validate() rejects an unknown keyframeId', () => {
    const base = baseState();
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'does-not-exist', from: 10, to: 42 };
    assert.throws(() => runCommand(base, 'SetKeyframeValue', args), /not found/);
  });

  check('SetKeyframeEasing: round-trip, only easing changes, value/timeMs untouched', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    roundTrip('SetKeyframeEasing', base, {
      trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x', from: 'linear', to: 'hold',
    });
  });

  check('SetKeyframeEasing: validate() rejects a stale "from" (easing changed since command was created)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    const args = { trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x', from: 'ease-in', to: 'hold' };
    assert.throws(() => runCommand(base, 'SetKeyframeEasing', args), /expected keyframe kf-x's easing to be "ease-in"/);
  });

  check('SetKeyframeFields: round-trip, commits a custom bezier curve (5 fields) as ONE command', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    roundTrip('SetKeyframeFields', base, {
      trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x',
      changes: [
        { field: 'easing', from: 'linear', to: 'custom' },
        { field: 'easingX1', from: undefined, to: 0.25 },
        { field: 'easingY1', from: undefined, to: 0.1 },
        { field: 'easingX2', from: undefined, to: 0.25 },
        { field: 'easingY2', from: undefined, to: 1.0 },
      ],
    });
  });

  check('SetKeyframeFields: validate() rejects if ANY one field has a stale "from" value', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    const args = {
      trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x',
      changes: [
        { field: 'easing', from: 'linear', to: 'custom' },
        { field: 'easingX1', from: 0.5, to: 0.25 }, // stale — real value is undefined, not 0.5
      ],
    };
    assert.throws(() => runCommand(base, 'SetKeyframeFields', args), /expected keyframe kf-x's easingX1 to be 0.5/);
  });

  check('SetKeyframeFields: validate() rejects an out-of-range easingX1 via assertValidCustomEasing', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    const args = {
      trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x',
      changes: [
        { field: 'easing', from: 'linear', to: 'custom' },
        { field: 'easingX1', from: undefined, to: 1.5 }, // out of [0,1]
        { field: 'easingY1', from: undefined, to: 0 },
        { field: 'easingX2', from: undefined, to: 0.5 },
        { field: 'easingY2', from: undefined, to: 1 },
      ],
    };
    assert.throws(() => runCommand(base, 'SetKeyframeFields', args), /easingX1 \(1\.5\) must be within 0-1/);
  });

  check('assertValidCustomEasing: a non-custom keyframe with no easingX1/etc at all is untouched (backward compat)', () => {
    const base = baseState();
    base.tracks[0].clips[0].keyframes = [
      { id: 'kf-x', propertyPath: 'transform.x', timeMs: 1000, value: 10, easing: 'linear' },
    ];
    // Any command touching an unrelated field should not trip assertValidCustomEasing.
    roundTrip('SetKeyframeValue', base, { trackId: 'track-v1', clipId: 'clip-1', keyframeId: 'kf-x', from: 10, to: 20 });
  });

  check('AddTransition: round-trip', () => {
    const base = baseState();
    // Phase 9's assertTransitionsReferenceAdjacentClips requires toClipId to genuinely exist AND
    // be adjacent to fromClipId — clip-2 must be added first (clip-1 ends at 5000).
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] });
    roundTrip('AddTransition', base, { transition: { id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} } });
  });

  check('AddTransition: validate() rejects a transition longer than either clip', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const args = { transition: { id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 9000, params: {} } };
    assert.throws(() => runCommand(base, 'AddTransition', args), /durationMs/);
  });

  check('AddTransition: validate() rejects non-adjacent clips', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 6000, timelineOutMs: 9000, speed: 1, transform: {}, effects: [], keyframes: [] }); // gap 5000-6000
    const args = { transition: { id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} } };
    assert.throws(() => runCommand(base, 'AddTransition', args), /no longer adjacent/);
  });

  check('RemoveTransition: round-trip', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const transition = { id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} };
    base.transitions = [transition];
    roundTrip('RemoveTransition', base, { transition });
  });

  check('assertTransitionsReferenceAdjacentClips: MoveClip that would orphan a transition is rejected', () => {
    const base = baseState();
    base.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    base.transitions = [{ id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} }];
    const args = { clipId: 'clip-2', from: { trackId: 'track-v1', index: 1, timelineInMs: 5000 }, to: { trackId: 'track-v1', index: 1, timelineInMs: 9000 } };
    assert.throws(() => runCommand(base, 'MoveClip', args), /no longer adjacent/);
  });

  check('ChangeTrackOrder: round-trip, other tracks shift to stay contiguous', () => {
    const base = baseState();
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [] });
    const args = { trackId: 'track-v1', fromOrder: 0, toOrder: 2 };

    const after = runCommand(base, 'ChangeTrackOrder', args);
    const orderOf = (state, id) => state.tracks.find((t) => t.id === id).order;
    assert.strictEqual(orderOf(after, 'track-v1'), 2);
    assert.strictEqual(orderOf(after, 'track-a1'), 0);
    assert.strictEqual(orderOf(after, 'track-v2'), 1);

    roundTrip('ChangeTrackOrder', base, args);
  });

  // 08-F F3 (specs/.../08-v2/08-f-timeline-authoring.md, "reorder invariants"): a stale `fromOrder`
  // doesn't just apply against the wrong baseline, it can infer the WRONG shift direction and
  // silently produce a unique-but-WRONG relative order — assertAllInvariants alone can't catch that
  // (no duplicate/gap to detect), so validate() now checks `fromOrder` against the track's REAL
  // current order first, same pattern SetProperty.js's own `from` check already established.
  check('ChangeTrackOrder: validate() rejects a stale fromOrder before touching state (real track order is 0, not the caller-supplied 5)', () => {
    const base = baseState();
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [] });
    const staleArgs = { trackId: 'track-v1', fromOrder: 5, toOrder: 2 };
    assert.throws(() => runCommand(base, 'ChangeTrackOrder', staleArgs), /current order to be 5, got 0/);
  });

  check('RelinkAsset: round-trip, only the referenced clip changes', () => {
    const base = baseState();
    roundTrip('RelinkAsset', base, { clipRefs: [{ trackId: 'track-v1', clipId: 'clip-1' }], oldAssetId: 'asset-1', newAssetId: 'asset-2' });
  });

  // 08-F F1 (specs/.../08-v2/08-f-timeline-authoring.md acceptance §6: "Locked track chặn mọi
  // mutation path nhưng vẫn inspect được") — assertLockedTracksUnchanged in invariants.js, wired
  // into runCommand() (index.js). Previously ONLY enforced at the UI layer (Timeline.jsx's drag/
  // drop/keyboard guards); these prove it now holds even when a command is posted directly.
  check('Locked track: MoveClip onto a locked track is rejected by runCommand()', () => {
    const base = baseState();
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: true, muted: false, visible: true, clips: [] });
    const args = { clipId: 'clip-1', from: { trackId: 'track-v1', index: 0, timelineInMs: 0 }, to: { trackId: 'track-v2', index: 0, timelineInMs: 0 } };
    assert.throws(() => runCommand(base, 'MoveClip', args), /is locked/);
  });

  check('Locked track: MoveClip moving a clip AWAY from a locked track is also rejected (source track content changes too)', () => {
    const base = baseState();
    base.tracks[0].locked = true;
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [] });
    const args = { clipId: 'clip-1', from: { trackId: 'track-v1', index: 0, timelineInMs: 0 }, to: { trackId: 'track-v2', index: 0, timelineInMs: 0 } };
    assert.throws(() => runCommand(base, 'MoveClip', args), /is locked/);
  });

  check('Locked track: InsertClip onto a locked track is rejected', () => {
    const base = baseState();
    base.tracks[0].locked = true;
    const clip = { id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 5000, timelineOutMs: 6000, speed: 1, transform: {}, effects: [], keyframes: [] };
    assert.throws(() => runCommand(base, 'InsertClip', { trackId: 'track-v1', index: 1, clip }), /is locked/);
  });

  check('Locked track: a command touching a DIFFERENT, unlocked track still succeeds', () => {
    const base = baseState();
    base.tracks.push({ id: 'track-v2', type: 'video', order: 2, locked: true, muted: false, visible: true, clips: [] });
    const clip = { id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 5000, timelineOutMs: 6000, speed: 1, transform: {}, effects: [], keyframes: [] };
    const after = runCommand(base, 'InsertClip', { trackId: 'track-v1', index: 1, clip });
    assert.strictEqual(after.tracks[0].clips.length, 2);
  });

  check('Locked track: toggling the `locked` flag itself (SetProperty) is still allowed — locking/unlocking a track is not blocked by its own lock', () => {
    const base = baseState();
    base.tracks[0].locked = true;
    const after = runCommand(base, 'SetProperty', { path: ['tracks', 0, 'locked'], from: true, to: false });
    assert.strictEqual(after.tracks[0].locked, false);
  });

  check('Unknown command type throws a clear error, does not silently no-op', () => {
    assert.throws(() => runCommand(baseState(), 'DoesNotExist', {}), /Unknown command type/);
  });

  // 08-D D4: Undo is itself a registered command type (runCommand('Undo', {originalType,
  // originalArgs})) so it lands in the durable command log — not a special generic operation.
  check('Undo: applying it through runCommand() reconstructs the exact pre-command state, redo (re-running the original) reproduces "after" again', () => {
    const base = baseState();
    const insertArgs = {
      trackId: 'track-v1', index: 1,
      clip: { id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] },
    };
    const after = runCommand(base, 'InsertClip', insertArgs);
    const undone = runCommand(after, 'Undo', { originalType: 'InsertClip', originalArgs: insertArgs });
    assert.deepStrictEqual(undone, base, 'Undo(InsertClip) did not reconstruct the pre-insert state exactly');
    const redone = runCommand(undone, 'InsertClip', insertArgs); // redo = re-post the ORIGINAL command, no special "Redo" type needed
    assert.deepStrictEqual(redone, after, 'redo did not reproduce the exact post-insert state');
  });

  check('Undo: validate() rejects an unknown originalType before touching state', () => {
    assert.throws(() => runCommand(baseState(), 'Undo', { originalType: 'DoesNotExist', originalArgs: {} }), /unknown originalType/);
  });

  check('Undo: invert() (redo-of-an-undo) reproduces the original apply — round-trip via invertCommand', () => {
    const base = baseState();
    const insertArgs = {
      trackId: 'track-v1', index: 1,
      clip: { id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] },
    };
    const after = runCommand(base, 'InsertClip', insertArgs);
    const undoArgs = { originalType: 'InsertClip', originalArgs: insertArgs };
    const undone = runCommand(after, 'Undo', undoArgs);
    const redoneViaInvert = invertCommand(undone, 'Undo', undoArgs);
    assert.deepStrictEqual(redoneViaInvert, after);
  });

  // ---- Property-based random-sequence test ----
  // Deterministic PRNG (mulberry32) so a failure is always reproducible from the printed seed,
  // unlike Math.random().
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A restricted but genuinely random walk over 4 of the 11 commands — enough variety to
  // exercise insert/property-change/keyframe-add/keyframe-remove interacting with each other
  // across a snapshot boundary, while every generated args set is guaranteed structurally valid
  // (placed after existing clips, keyframe times within bounds) so the walk never has to handle
  // a rejected command.
  function randomStep(rng, state, clipCounter) {
    const clip = state.tracks[0].clips[state.tracks[0].clips.length - 1];
    const roll = rng();

    if (roll < 0.4) {
      const newId = `rand-clip-${clipCounter.n++}`;
      const durationMs = 500 + Math.floor(rng() * 2000);
      return {
        type: 'InsertClip',
        args: {
          trackId: 'track-v1', index: state.tracks[0].clips.length,
          clip: { id: newId, assetId: 'asset-1', sourceInMs: 0, sourceOutMs: durationMs, timelineInMs: clip.timelineOutMs, timelineOutMs: clip.timelineOutMs + durationMs, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] },
        },
      };
    }
    if (roll < 0.7) {
      const from = clip.transform.opacity;
      return { type: 'SetProperty', args: { path: ['tracks', 0, 'clips', state.tracks[0].clips.length - 1, 'transform', 'opacity'], from, to: from === 1 ? 0.5 : 1 } };
    }
    if (roll < 0.9 || (clip.keyframes || []).length === 0) {
      const clipDurationMs = clip.timelineOutMs - clip.timelineInMs;
      return {
        type: 'AddKeyframe',
        args: { trackId: 'track-v1', clipId: clip.id, keyframe: { id: `rand-kf-${clipCounter.n++}`, propertyPath: 'transform.opacity', timeMs: Math.floor(rng() * clipDurationMs), value: rng(), easing: 'linear' } },
      };
    }
    const kf = clip.keyframes[0];
    return { type: 'RemoveKeyframe', args: { trackId: 'track-v1', clipId: clip.id, keyframe: kf } };
  }

  check('Property-based: snapshot-at-step-k + replay-tail reconstructs the exact same final state as a full replay', () => {
    const seed = 42;
    const rng = mulberry32(seed);
    const clipCounter = { n: 0 };
    const log = [];
    let state = baseState();
    for (let i = 0; i < 20; i++) {
      const step = randomStep(rng, state, clipCounter);
      state = runCommand(state, step.type, step.args);
      log.push(step);
    }
    const fullReplayFinal = state;

    // Simulate "kill server at step k, restore from snapshot, replay the tail of the log".
    const k = 12;
    let snapshotState = baseState();
    for (let i = 0; i < k; i++) snapshotState = runCommand(snapshotState, log[i].type, log[i].args);
    let recoveredState = snapshotState;
    for (let i = k; i < log.length; i++) recoveredState = runCommand(recoveredState, log[i].type, log[i].args);

    assert.deepStrictEqual(recoveredState, fullReplayFinal, `seed=${seed}: snapshot+replay-tail diverged from full replay`);
  });

  check('Property-based: undoing a whole random sequence in reverse returns to the exact original state, redo reproduces the final state', () => {
    const seed = 7;
    const rng = mulberry32(seed);
    const clipCounter = { n: 0 };
    const log = [];
    const original = baseState();
    let state = original;
    for (let i = 0; i < 15; i++) {
      const step = randomStep(rng, state, clipCounter);
      state = runCommand(state, step.type, step.args);
      log.push(step);
    }
    const final = state;

    let undone = final;
    for (let i = log.length - 1; i >= 0; i--) undone = invertCommand(undone, log[i].type, log[i].args);
    assert.deepStrictEqual(undone, original, `seed=${seed}: full undo did not return to the original state`);

    let redone = undone;
    for (const step of log) redone = runCommand(redone, step.type, step.args);
    assert.deepStrictEqual(redone, final, `seed=${seed}: full redo did not reproduce the original final state`);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
