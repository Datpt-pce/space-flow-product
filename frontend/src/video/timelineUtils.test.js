// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): pure-logic tests for
// timelineUtils.js — no React/DOM needed. Run with: node frontend/src/video/timelineUtils.test.js

import assert from 'assert';
import {
  findClipLocation, findClipAtPlayheadMs, clipsOverlap, buildSnapCandidates, resolveSnap, computeInsertIndex,
  keyframeMarkersForClip, computeSpeedResizedDuration, adjacentClipPairs, blendModeFor,
  colorGradeFilterFor, clipsInTimeRange, clipScreenRect, rectsIntersect, rectContains,
  resolveSelectionOnClick, buildDuplicateClip, findNextFreeSlot,
  buildMultiMoveTargets, multiMoveOverlaps, mergeRippleIntervals,
  getTrackZone, tracksAreZoneCompatible, getTimelineRows, clipsInGroup, orderForNewTrack, trackReorderChanges,
} from './timelineUtils.js';

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

function projectState() {
  return {
    tracks: [
      {
        id: 'track-v1', type: 'video', clips: [
          { id: 'clip-1', timelineInMs: 0, timelineOutMs: 5000 },
          { id: 'clip-2', timelineInMs: 5000, timelineOutMs: 9000 },
        ],
      },
      { id: 'track-a1', type: 'audio', clips: [] },
    ],
  };
}

function main() {
  check('findClipLocation: finds the clip and its index/track', () => {
    const found = findClipLocation(projectState(), 'clip-2');
    assert.strictEqual(found.track.id, 'track-v1');
    assert.strictEqual(found.index, 1);
    assert.strictEqual(found.clip.id, 'clip-2');
  });

  check('findClipLocation: returns null for an unknown clip id', () => {
    assert.strictEqual(findClipLocation(projectState(), 'nope'), null);
  });

  check('findClipAtPlayheadMs: strictly inside the clip (not at its edges)', () => {
    assert.strictEqual(findClipAtPlayheadMs(projectState(), 2500).clip.id, 'clip-1');
    assert.strictEqual(findClipAtPlayheadMs(projectState(), 0), null); // exactly at start — not strictly inside
    assert.strictEqual(findClipAtPlayheadMs(projectState(), 5000), null); // exactly at boundary between clips
  });

  check('findClipAtPlayheadMs: prefers the given clip id when it qualifies', () => {
    // playhead at 2500 is inside BOTH nothing-else and clip-1 only — sanity-check the preference
    // path picks the preferred clip's own track/index rather than re-scanning from track 0.
    const found = findClipAtPlayheadMs(projectState(), 2500, 'clip-1');
    assert.strictEqual(found.clip.id, 'clip-1');
  });

  check('clipsOverlap: detects a genuine overlap', () => {
    assert.strictEqual(clipsOverlap(projectState().tracks[0], 3000, 6000), true);
  });

  check('clipsOverlap: back-to-back clips (touching edges) do not overlap', () => {
    assert.strictEqual(clipsOverlap(projectState().tracks[0], 9000, 12000), false);
  });

  check('clipsOverlap: excludeClipId lets a clip ignore itself (e.g. moving in place)', () => {
    assert.strictEqual(clipsOverlap(projectState().tracks[0], 0, 5000, 'clip-1'), false);
  });

  check('buildSnapCandidates + resolveSnap: snaps to the nearest clip boundary within threshold', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[0], null, null);
    const result = resolveSnap(candidates, 4990, 50, null);
    assert.strictEqual(result.ms, 5000);
    assert.strictEqual(result.candidate.type, 'clip-edge');
  });

  check('resolveSnap: playhead OUTRANKS a closer clip-edge within the same threshold (priority beats nearest)', () => {
    const ps = projectState();
    // clip-1 ends at 5000 (distance 3 from 5003); playhead at 5010 (distance 7) — clip-edge is
    // numerically closer, but playhead must still win on priority alone.
    const candidates = buildSnapCandidates(ps, ps.tracks[0], 5010, null);
    const result = resolveSnap(candidates, 5003, 50, null);
    assert.strictEqual(result.ms, 5010);
    assert.strictEqual(result.candidate.type, 'playhead');
  });

  check('resolveSnap: no candidate within threshold -> rawMs unchanged, candidate null', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[0], null, null);
    const result = resolveSnap(candidates, 20000, 50, null);
    assert.strictEqual(result.ms, 20000);
    assert.strictEqual(result.candidate, null);
  });

  check('buildSnapCandidates: excludeClipId omits that clip\'s own edges (never self-snaps)', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[0], null, ['clip-2']); // clip-2: 5000-9000
    // 9000 can still appear as a project-bounds candidate (the project's real last-clip-end,
    // independent of which clip is excluded) — only the CLIP-EDGE variant must be gone.
    assert.ok(!candidates.some((c) => c.ms === 9000 && c.type === 'clip-edge'));
    assert.ok(candidates.some((c) => c.ms === 0 && c.type === 'clip-edge')); // clip-1's own start still present
  });

  check('buildSnapCandidates: includes project bounds (0 and the last clip end across ALL tracks)', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[1], null, null); // audio track, itself empty
    assert.ok(candidates.some((c) => c.ms === 0 && c.type === 'project-bounds'));
    assert.ok(candidates.some((c) => c.ms === 9000 && c.type === 'project-bounds')); // clip-2's own end, on the OTHER track
  });

  check('resolveSnap: sticky candidate is kept over a marginally-closer new one (anti-flicker)', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[0], null, null); // clip-edges at 0,5000,5000,9000 (dedup not required)
    const sticky = { ms: 5000, type: 'clip-edge' };
    // rawMs creeps 1ms closer to nothing new — sticky should still win within margin.
    const result = resolveSnap(candidates, 5001, 50, sticky, 5);
    assert.strictEqual(result.ms, 5000);
  });

  check('resolveSnap: sticky candidate is dropped once it falls outside the threshold entirely', () => {
    const ps = projectState();
    const candidates = buildSnapCandidates(ps, ps.tracks[0], null, null);
    const sticky = { ms: 5000, type: 'clip-edge' };
    const result = resolveSnap(candidates, 5100, 50, sticky, 5); // 100ms away, threshold is 50
    assert.notStrictEqual(result.ms, 5000);
  });

  check('computeInsertIndex: new clip (excludeClipId=null) counts every existing clip that starts earlier', () => {
    assert.strictEqual(computeInsertIndex(projectState().tracks[0], null, 6000), 2); // after both clip-1 and clip-2
    assert.strictEqual(computeInsertIndex(projectState().tracks[0], null, 1000), 1); // after clip-1 only
  });

  check('computeInsertIndex: moving an existing clip forward excludes itself from the count (the off-by-one fix)', () => {
    // clip-1 (currently index 0) dragged to start after clip-2 (which starts at 5000) — without
    // excluding clip-1 from the count this would wrongly return 2 (both clips start earlier than
    // 9000, including clip-1's OWN old position); excluding it correctly returns 1 (clip-2 only).
    assert.strictEqual(computeInsertIndex(projectState().tracks[0], 'clip-1', 9000), 1);
  });

  check('keyframeMarkersForClip: groups keyframes by distinct timeMs across properties', () => {
    const clip = {
      keyframes: [
        { id: 'k1', propertyPath: 'transform.x', timeMs: 0, value: 0, easing: 'linear' },
        { id: 'k2', propertyPath: 'transform.opacity', timeMs: 0, value: 1, easing: 'linear' },
        { id: 'k3', propertyPath: 'transform.x', timeMs: 1000, value: 100, easing: 'linear' },
      ],
    };
    const markers = keyframeMarkersForClip(clip);
    assert.strictEqual(markers.length, 2);
    assert.strictEqual(markers[0].timeMs, 0);
    assert.strictEqual(markers[0].keyframes.length, 2); // k1 + k2, same time
    assert.strictEqual(markers[1].timeMs, 1000);
    assert.strictEqual(markers[1].keyframes.length, 1);
  });

  check('keyframeMarkersForClip: no keyframes -> empty array', () => {
    assert.deepStrictEqual(keyframeMarkersForClip({ keyframes: [] }), []);
    assert.deepStrictEqual(keyframeMarkersForClip({}), []);
  });

  check('computeSpeedResizedDuration: 2x -> half the source-range duration', () => {
    const clip = { sourceInMs: 0, sourceOutMs: 4000, timelineInMs: 0, timelineOutMs: 4000 };
    assert.strictEqual(computeSpeedResizedDuration(clip, 2), 2000);
  });

  check('computeSpeedResizedDuration: 0.5x -> double the source-range duration', () => {
    const clip = { sourceInMs: 0, sourceOutMs: 4000, timelineInMs: 0, timelineOutMs: 4000 };
    assert.strictEqual(computeSpeedResizedDuration(clip, 0.5), 8000);
  });

  check('computeSpeedResizedDuration: negative (reverse) speed uses its magnitude, same as the positive case', () => {
    const clip = { sourceInMs: 0, sourceOutMs: 4000, timelineInMs: 0, timelineOutMs: 4000 };
    assert.strictEqual(computeSpeedResizedDuration(clip, -2), 2000);
  });

  check('computeSpeedResizedDuration: freeze-frame (0) keeps the CURRENT timeline duration unchanged', () => {
    const clip = { sourceInMs: 0, sourceOutMs: 4000, timelineInMs: 1000, timelineOutMs: 3500 };
    assert.strictEqual(computeSpeedResizedDuration(clip, 0), 2500);
  });

  check('adjacentClipPairs: finds a genuinely touching pair, ignores a gapped one', () => {
    const track = { clips: [{ id: 'a', timelineInMs: 0, timelineOutMs: 5000 }, { id: 'b', timelineInMs: 5000, timelineOutMs: 9000 }] };
    const pairs = adjacentClipPairs(track);
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].fromClip.id, 'a');
    assert.strictEqual(pairs[0].toClip.id, 'b');
  });

  check('adjacentClipPairs: a gap between clips is NOT adjacent', () => {
    const track = { clips: [{ id: 'a', timelineInMs: 0, timelineOutMs: 5000 }, { id: 'b', timelineInMs: 6000, timelineOutMs: 9000 }] };
    assert.deepStrictEqual(adjacentClipPairs(track), []);
  });

  check('blendModeFor: no effects -> source-over (canvas default / "normal")', () => {
    assert.strictEqual(blendModeFor({ effects: [] }), 'source-over');
    assert.strictEqual(blendModeFor({}), 'source-over');
  });

  check('blendModeFor: enabled blendMode effect -> its mode, matching Canvas2D keyword names directly', () => {
    const clip = { effects: [{ id: 'fx1', type: 'blendMode', enabled: true, order: 0, params: { mode: 'multiply' } }] };
    assert.strictEqual(blendModeFor(clip), 'multiply');
  });

  check('blendModeFor: DISABLED blendMode effect is ignored -> source-over', () => {
    const clip = { effects: [{ id: 'fx1', type: 'blendMode', enabled: false, order: 0, params: { mode: 'multiply' } }] };
    assert.strictEqual(blendModeFor(clip), 'source-over');
  });

  check('colorGradeFilterFor: no effects -> undefined (no ctx.filter/CSS filter set at all)', () => {
    assert.strictEqual(colorGradeFilterFor({ effects: [] }), undefined);
    assert.strictEqual(colorGradeFilterFor({}), undefined);
  });

  check('colorGradeFilterFor: all-default params (brightness 0, contrast/saturation 1, hue 0) -> undefined, same as no effect at all', () => {
    const clip = { effects: [{ id: 'fx1', type: 'colorGrade', enabled: true, order: 0, params: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 } }] };
    assert.strictEqual(colorGradeFilterFor(clip), undefined);
  });

  check('colorGradeFilterFor: only the non-default params appear in the CSS filter string; gamma never does (no CSS equivalent)', () => {
    const clip = { effects: [{ id: 'fx1', type: 'colorGrade', enabled: true, order: 0, params: { brightness: 0, contrast: 1, saturation: 2, gamma: 5, hue: 90 } }] };
    const filter = colorGradeFilterFor(clip);
    assert.ok(filter.includes('saturate(2)'), filter);
    assert.ok(filter.includes('hue-rotate(90deg)'), filter);
    assert.ok(!filter.includes('brightness'), filter);
    assert.ok(!filter.includes('contrast'), filter);
    assert.ok(!/gamma/i.test(filter), filter);
  });

  check('colorGradeFilterFor: brightness maps to CSS brightness() as 1 + offset (multiplicative approximation of ffmpeg eq\'s additive param)', () => {
    const clip = { effects: [{ id: 'fx1', type: 'colorGrade', enabled: true, order: 0, params: { brightness: 0.2, contrast: 1, saturation: 1, gamma: 1, hue: 0 } }] };
    assert.strictEqual(colorGradeFilterFor(clip), 'brightness(1.2)');
  });

  check('colorGradeFilterFor: DISABLED colorGrade effect is ignored -> undefined', () => {
    const clip = { effects: [{ id: 'fx1', type: 'colorGrade', enabled: false, order: 0, params: { brightness: 0.5, contrast: 1, saturation: 1, gamma: 1, hue: 0 } }] };
    assert.strictEqual(colorGradeFilterFor(clip), undefined);
  });

  // --- 08.2.1 (specs/ai-creative-operations-platform/08-2-1-selection-navigation-and-feedback.md) ---

  check('clipsInTimeRange: order of the 2 endpoints does not matter', () => {
    const track = projectState().tracks[0];
    const forward = clipsInTimeRange(track, 0, 9000).map((c) => c.id);
    const backward = clipsInTimeRange(track, 9000, 0).map((c) => c.id);
    assert.deepStrictEqual(forward, ['clip-1', 'clip-2']);
    assert.deepStrictEqual(backward, ['clip-1', 'clip-2']);
  });

  check('clipsInTimeRange: a range touching only one clip returns just that one', () => {
    const track = projectState().tracks[0];
    assert.deepStrictEqual(clipsInTimeRange(track, 1000, 2000).map((c) => c.id), ['clip-1']);
  });

  check('clipScreenRect: left/width from timeline ms at the given pxPerSecond, top from track index', () => {
    const clip = { timelineInMs: 1000, timelineOutMs: 3000 };
    const rect = clipScreenRect(1, clip, 60); // 60px/s
    assert.strictEqual(rect.left, 60); // 1s * 60
    assert.strictEqual(rect.width, 120); // 2s * 60
    assert.strictEqual(rect.top, 80); // trackIndex 1 * 64 + 16
    assert.strictEqual(rect.height, 40);
  });

  check('clipScreenRect: width never collapses to 0 for a very short clip', () => {
    const rect = clipScreenRect(0, { timelineInMs: 0, timelineOutMs: 1 }, 60);
    assert.ok(rect.width >= 4, rect.width);
  });

  check('rectsIntersect: overlapping rects intersect', () => {
    assert.strictEqual(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 }), true);
  });

  check('rectsIntersect: touching edges (no actual overlap) do not intersect', () => {
    assert.strictEqual(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 10, height: 10 }), false);
  });

  check('rectsIntersect: disjoint rects do not intersect', () => {
    assert.strictEqual(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 100, top: 100, width: 10, height: 10 }), false);
  });

  check('rectContains: inner fully inside outer', () => {
    assert.strictEqual(rectContains({ left: 0, top: 0, width: 100, height: 100 }, { left: 10, top: 10, width: 20, height: 20 }), true);
  });

  check('rectContains: inner partially outside outer (would intersect but not contain)', () => {
    assert.strictEqual(rectContains({ left: 0, top: 0, width: 20, height: 20 }, { left: 10, top: 10, width: 20, height: 20 }), false);
  });

  check('resolveSelectionOnClick: mod held -> toggle, regardless of shift', () => {
    const ps = projectState();
    const track = ps.tracks[0];
    const action = resolveSelectionOnClick(ps, track, track.clips[1], 'clip-1', { mod: true, shift: true });
    assert.deepStrictEqual(action, { type: 'toggle', clipId: 'clip-2' });
  });

  check('resolveSelectionOnClick: plain click -> replace with just this clip as primary', () => {
    const ps = projectState();
    const track = ps.tracks[0];
    const action = resolveSelectionOnClick(ps, track, track.clips[1], null, { mod: false, shift: false });
    assert.deepStrictEqual(action, { type: 'set', ids: ['clip-2'], primaryId: 'clip-2' });
  });

  check('resolveSelectionOnClick: shift + valid same-track anchor -> chronological range, new primary is the just-clicked clip', () => {
    const ps = projectState();
    const track = ps.tracks[0];
    const action = resolveSelectionOnClick(ps, track, track.clips[1], 'clip-1', { mod: false, shift: true });
    assert.deepStrictEqual(action, { type: 'set', ids: ['clip-1', 'clip-2'], primaryId: 'clip-2' });
  });

  check('resolveSelectionOnClick: shift with no anchor on this track -> falls back to a plain replace', () => {
    const ps = projectState();
    const audioTrack = ps.tracks[1];
    audioTrack.clips.push({ id: 'clip-audio-1', timelineInMs: 0, timelineOutMs: 2000 });
    const action = resolveSelectionOnClick(ps, audioTrack, audioTrack.clips[0], 'clip-1', { mod: false, shift: true });
    assert.deepStrictEqual(action, { type: 'set', ids: ['clip-audio-1'], primaryId: 'clip-audio-1' });
  });

  // 08-F F4 (Group giữ relative offsets)
  check('clipsInGroup: no groupId -> empty array', () => {
    assert.deepStrictEqual(clipsInGroup(projectState(), undefined), []);
  });

  check('clipsInGroup: finds every clip sharing the id across every track, sorted by timelineInMs', () => {
    const ps = projectState();
    ps.tracks[0].clips[0].groupId = 'g1'; // clip-1, timelineInMs 0
    ps.tracks[1].clips.push({ id: 'clip-audio-1', timelineInMs: 2000, timelineOutMs: 4000, groupId: 'g1' });
    const members = clipsInGroup(ps, 'g1');
    assert.deepStrictEqual(members.map((c) => c.id), ['clip-1', 'clip-audio-1']);
  });

  check('resolveSelectionOnClick: plain click on a grouped clip (2+ members) selects the whole group', () => {
    const ps = projectState();
    ps.tracks[0].clips[0].groupId = 'g1';
    ps.tracks[0].clips[1].groupId = 'g1';
    const action = resolveSelectionOnClick(ps, ps.tracks[0], ps.tracks[0].clips[1], null, { mod: false, shift: false });
    assert.deepStrictEqual(action, { type: 'set', ids: ['clip-1', 'clip-2'], primaryId: 'clip-2' });
  });

  check('resolveSelectionOnClick: a groupId with only 1 actual member (stale leftover) behaves as ungrouped', () => {
    const ps = projectState();
    ps.tracks[0].clips[0].groupId = 'g1'; // the only clip with this id
    const action = resolveSelectionOnClick(ps, ps.tracks[0], ps.tracks[0].clips[0], null, { mod: false, shift: false });
    assert.deepStrictEqual(action, { type: 'set', ids: ['clip-1'], primaryId: 'clip-1' });
  });

  check('resolveSelectionOnClick: Mod+click on a grouped clip still toggles just that ONE clip (group expansion is plain-click only)', () => {
    const ps = projectState();
    ps.tracks[0].clips[0].groupId = 'g1';
    ps.tracks[0].clips[1].groupId = 'g1';
    const action = resolveSelectionOnClick(ps, ps.tracks[0], ps.tracks[0].clips[1], 'clip-1', { mod: true, shift: false });
    assert.deepStrictEqual(action, { type: 'toggle', clipId: 'clip-2' });
  });

  check('buildDuplicateClip: fresh id, deep-cloned (no aliasing), other fields identical', () => {
    const original = { id: 'clip-1', assetId: 'asset-1', timelineInMs: 0, timelineOutMs: 5000, transform: { x: 0, scaleX: 1 }, effects: [], keyframes: [{ id: 'kf-1', timeMs: 100 }] };
    const copy = buildDuplicateClip(original);
    assert.notStrictEqual(copy.id, original.id);
    assert.strictEqual(copy.assetId, original.assetId);
    assert.deepStrictEqual(copy.transform, original.transform);
    assert.notStrictEqual(copy.transform, original.transform); // deep clone, not the same object
    assert.notStrictEqual(copy.keyframes, original.keyframes);
    copy.transform.x = 999;
    assert.strictEqual(original.transform.x, 0); // mutating the copy never touches the original
  });

  check('findNextFreeSlot: fits immediately when the target position is free', () => {
    const track = { clips: [{ id: 'clip-1', timelineInMs: 0, timelineOutMs: 5000 }] };
    assert.strictEqual(findNextFreeSlot(track, 5000, 2000, 'clip-1'), 5000);
  });

  check('findNextFreeSlot: jumps past a single blocking clip to its own end', () => {
    const track = { clips: [{ id: 'clip-1', timelineInMs: 0, timelineOutMs: 5000 }, { id: 'clip-2', timelineInMs: 5000, timelineOutMs: 6000 }] };
    // duplicating clip-1 (2000ms starting right after itself at 5000) would land on [5000,7000),
    // which overlaps clip-2 [5000,6000) — must jump to clip-2's own end (6000).
    assert.strictEqual(findNextFreeSlot(track, 5000, 2000, 'clip-1'), 6000);
  });

  check('findNextFreeSlot: jumps past MULTIPLE consecutive blocking clips', () => {
    const track = { clips: [{ id: 'clip-a', timelineInMs: 5000, timelineOutMs: 6000 }, { id: 'clip-b', timelineInMs: 6000, timelineOutMs: 7000 }] };
    assert.strictEqual(findNextFreeSlot(track, 5000, 2000, null), 7000);
  });

  function multiTrackProjectState() {
    return {
      tracks: [
        { id: 'v1', type: 'video', order: 0, clips: [{ id: 'a', timelineInMs: 0, timelineOutMs: 5000 }, { id: 'b', timelineInMs: 6000, timelineOutMs: 9000 }] },
        { id: 'v2', type: 'video', order: 1, clips: [] },
        { id: 'a1', type: 'audio', order: 2, clips: [{ id: 'x', timelineInMs: 0, timelineOutMs: 2000 }] },
      ],
    };
  }

  check('buildMultiMoveTargets: same track, keeps relative time offset and gap between clips', () => {
    const ps = multiTrackProjectState();
    const result = buildMultiMoveTargets(ps, ['a', 'b'], 'a', 'v1', 1000); // primary 'a' dropped at 1000 (delta +1000)
    assert.deepStrictEqual(result.moves.map((m) => m.clipId).sort(), ['a', 'b']);
    const moveA = result.moves.find((m) => m.clipId === 'a');
    const moveB = result.moves.find((m) => m.clipId === 'b');
    assert.strictEqual(moveA.toTrackId, 'v1');
    assert.strictEqual(moveA.toTimelineInMs, 1000);
    assert.strictEqual(moveB.toTrackId, 'v1');
    assert.strictEqual(moveB.toTimelineInMs, 7000); // same +1000 delta, gap preserved
  });

  check('buildMultiMoveTargets: cross-track, applies the SAME track-offset to every selected clip within ITS OWN type-group', () => {
    const ps = multiTrackProjectState();
    // primary 'a' dropped onto v2 (index 1, was index 0 -> offset +1)
    const result = buildMultiMoveTargets(ps, ['a', 'b'], 'a', 'v2', 0);
    const moveA = result.moves.find((m) => m.clipId === 'a');
    const moveB = result.moves.find((m) => m.clipId === 'b');
    assert.strictEqual(moveA.toTrackId, 'v2');
    assert.strictEqual(moveB.toTrackId, 'v2'); // only 1 other video track exists, offset +1 still resolves to v2
  });

  check('buildMultiMoveTargets: rejects (returns null) when the offset pushes a clip outside its own type-group bounds', () => {
    const ps = multiTrackProjectState();
    ps.tracks[1].clips.push({ id: 'c', timelineInMs: 0, timelineOutMs: 1000 }); // 'c' already lives on v2 (index 1)
    // Only 2 video tracks exist (v1 index 0, v2 index 1) — primary 'a' dropped on v2 is offset +1
    // (from v1); applying that SAME +1 to 'c' (already at index 1) needs a 3rd video track that
    // doesn't exist.
    const result = buildMultiMoveTargets(ps, ['a', 'c'], 'a', 'v2', 0);
    assert.strictEqual(result, null);
  });

  check('multiMoveOverlaps: true when a target range collides with a clip NOT in the batch', () => {
    const ps = multiTrackProjectState();
    // 'a's own duration (5000ms, from its real timelineIn/OutMs) carries over to the target range
    // regardless of destination track — 500..5500 overlaps 'x' at [0,2000) on track a1.
    const moves = [{ clipId: 'a', toTrackId: 'a1', toTimelineInMs: 500 }];
    assert.strictEqual(multiMoveOverlaps(ps, moves), true);
  });

  check('multiMoveOverlaps: false when the target range is genuinely free', () => {
    const ps = multiTrackProjectState();
    const moves = [{ clipId: 'a', toTrackId: 'v2', toTimelineInMs: 0 }];
    assert.strictEqual(multiMoveOverlaps(ps, moves), false);
  });

  check('multiMoveOverlaps: true when TWO moves in the SAME batch would land on top of each other on the same track', () => {
    const ps = multiTrackProjectState();
    const moves = [
      { clipId: 'a', toTrackId: 'v2', toTimelineInMs: 0 }, // a: 0..5000
      { clipId: 'b', toTrackId: 'v2', toTimelineInMs: 2000 }, // b: 2000..5000 (b is 3000ms) -> collides with a
    ];
    assert.strictEqual(multiMoveOverlaps(ps, moves), true);
  });

  check('mergeRippleIntervals: touching clips merge, a gap starts a new interval, unselected clips are ignored', () => {
    const ps = {
      tracks: [
        {
          id: 't1', type: 'video', clips: [
            { id: 'A', timelineInMs: 0, timelineOutMs: 1000 },
            { id: 'B', timelineInMs: 1000, timelineOutMs: 2000 }, // touches A
            { id: 'ignored', timelineInMs: 2000, timelineOutMs: 2500 }, // NOT selected — breaks the run
            { id: 'C', timelineInMs: 3000, timelineOutMs: 4000 }, // gap before it either way
          ],
        },
      ],
    };
    const perTrack = mergeRippleIntervals(ps, ['A', 'B', 'C']);
    assert.strictEqual(perTrack.length, 1);
    assert.strictEqual(perTrack[0].trackId, 't1');
    assert.strictEqual(perTrack[0].intervals.length, 2);
    assert.deepStrictEqual(perTrack[0].intervals[0].removals.map((r) => r.clip.id), ['A', 'B']);
    assert.strictEqual(perTrack[0].intervals[0].startMs, 0);
    assert.strictEqual(perTrack[0].intervals[0].endMs, 2000);
    assert.deepStrictEqual(perTrack[0].intervals[1].removals.map((r) => r.clip.id), ['C']);
  });

  check('mergeRippleIntervals: tracks with no selected clips at all are omitted from the result', () => {
    const ps = {
      tracks: [
        { id: 't1', type: 'video', clips: [{ id: 'A', timelineInMs: 0, timelineOutMs: 1000 }] },
        { id: 't2', type: 'audio', clips: [{ id: 'B', timelineInMs: 0, timelineOutMs: 1000 }] },
      ],
    };
    const perTrack = mergeRippleIntervals(ps, ['A']); // only t1's clip selected
    assert.strictEqual(perTrack.length, 1);
    assert.strictEqual(perTrack[0].trackId, 't1');
  });

  // 08.2.6 §1-2: zone model.
  check('getTrackZone: audio is the only audio-zone type, everything else is visual', () => {
    assert.strictEqual(getTrackZone('audio'), 'audio');
    assert.strictEqual(getTrackZone('video'), 'visual');
    assert.strictEqual(getTrackZone('image'), 'visual');
    assert.strictEqual(getTrackZone('sticker'), 'visual');
    assert.strictEqual(getTrackZone('caption'), 'visual');
  });

  check('tracksAreZoneCompatible: video<->image interchangeable, audio stays isolated', () => {
    assert.strictEqual(tracksAreZoneCompatible('video', 'image'), true);
    assert.strictEqual(tracksAreZoneCompatible('image', 'video'), true);
    assert.strictEqual(tracksAreZoneCompatible('video', 'video'), true);
    assert.strictEqual(tracksAreZoneCompatible('audio', 'video'), false);
    assert.strictEqual(tracksAreZoneCompatible('audio', 'image'), false);
    assert.strictEqual(tracksAreZoneCompatible('sticker', 'video'), false); // out of zone-merge scope, unchanged
    assert.strictEqual(tracksAreZoneCompatible('caption', 'caption'), true);
  });

  check('getTimelineRows: visual foreground first, audio always below even with legacy interleaved orders', () => {
    const ps = {
      tracks: [
        { id: 'v1', type: 'video', order: 0, clips: [] },
        { id: 'a1', type: 'audio', order: 1, clips: [] },
        { id: 'v2', type: 'image', order: 2, clips: [] }, // interleaved after the audio track
      ],
    };
    const rows = getTimelineRows(ps);
    assert.deepStrictEqual(rows.map((r) => r.track.id), ['v2', 'v1', 'a1']);
  });

  check('getTimelineRows: empty visual zone gets a leading placeholder row, empty audio zone a trailing one', () => {
    const onlyAudio = getTimelineRows({ tracks: [{ id: 'a1', type: 'audio', order: 0, clips: [] }] });
    assert.strictEqual(onlyAudio[0].kind, 'empty-zone');
    assert.strictEqual(onlyAudio[0].zone, 'visual');
    assert.strictEqual(onlyAudio[1].track.id, 'a1');

    const onlyVideo = getTimelineRows({ tracks: [{ id: 'v1', type: 'video', order: 0, clips: [] }] });
    assert.strictEqual(onlyVideo[0].track.id, 'v1');
    assert.strictEqual(onlyVideo[1].kind, 'empty-zone');
    assert.strictEqual(onlyVideo[1].zone, 'audio');
  });

  check('audio appends beneath existing audio independently of selected visual; visual stays above selected visual', () => {
    const tracks = [{ id: 'v1', type: 'video', order: 10 }, { id: 'v2', type: 'text', order: 20 }, { id: 'a1', type: 'audio', order: 999 }, { id: 'a2', type: 'audio', order: -5 }];
    assert.ok(orderForNewTrack(tracks, 'audio', 'v2') < -5);
    const visual = orderForNewTrack(tracks, 'shape', 'v1');
    assert.ok(visual > 10 && visual < 20);
    assert.ok(orderForNewTrack(tracks, 'image', 'a1') < 10);
  });
  check('reordering audio inserts below audio target without changing any visual or unrelated row', () => {
    const tracks = [{ id: 'v', type: 'video', order: 0 }, { id: 'a', type: 'audio', order: 3 }, { id: 'b', type: 'audio', order: 2 }, { id: 'c', type: 'audio', order: 1 }];
    const changes = trackReorderChanges({ tracks }, [tracks[1]], 'b');
    assert.strictEqual(changes.length, 1); assert.deepStrictEqual(changes[0].path, ['tracks', 1, 'order']);
    assert.ok(changes[0].to < 2 && changes[0].to > 1);
    assert.ok(trackReorderChanges({ tracks }, [tracks[1]], 'v')[0].to < 1);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
