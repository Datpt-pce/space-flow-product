// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): pure helpers used by
// Timeline.jsx for hit-testing, overlap checks (mirrors shared/video-commands/invariants.js's
// assertNoIllegalOverlap logic, but as a proactive UI-side check BEFORE a command is even built —
// the acceptance criteria requires the drag-drop itself to be blocked, not just rejected after the
// fact by validate()) and boundary snapping. Split into its own file (rather than inlined in
// Timeline.jsx) so this logic is unit-testable without React/DOM.

export function findClipLocation(projectState, clipId) {
  if (!projectState) return null;
  for (const track of projectState.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index !== -1) return { track, index, clip: track.clips[index] };
  }
  return null;
}

// A clip is "at" the playhead for splitting only if the playhead is STRICTLY inside it — matches
// shared/video-commands/SplitClip.js's own validate() (`splitAtMs` must be > timelineInMs and <
// timelineOutMs), so this never proposes a split that would just throw immediately.
export function findClipAtPlayheadMs(projectState, playheadMs, preferClipId) {
  if (!projectState) return null;
  const isStrictlyInside = (clip) => playheadMs > clip.timelineInMs && playheadMs < clip.timelineOutMs;

  if (preferClipId) {
    const preferred = findClipLocation(projectState, preferClipId);
    if (preferred && isStrictlyInside(preferred.clip)) return preferred;
  }
  for (const track of projectState.tracks) {
    const index = track.clips.findIndex(isStrictlyInside);
    if (index !== -1) return { track, index, clip: track.clips[index] };
  }
  return null;
}

// computeInsertIndex(track, excludeClipId, startMs) -> the FINAL array index a clip starting at
// startMs should land at in `track.clips` — i.e. splice()-ready against the array with
// `excludeClipId` (the clip being moved, if any — pass null for a brand-new InsertClip) already
// removed. This is the exact index contract shared/video-commands/MoveClip.js's header comment
// requires; computing it any other way (e.g. counting against a snapshot that still includes the
// moving clip) is the same-track off-by-one Phase 2's review flagged and Phase 6 fixed by
// centralizing this here instead of re-deriving it ad hoc at each call site.
export function computeInsertIndex(track, excludeClipId, startMs) {
  return track.clips.filter((c) => c.id !== excludeClipId && c.timelineInMs < startMs).length;
}

// keyframeMarkersForClip(clip) -> [{timeMs, keyframes}], sorted by timeMs, 1 entry per DISTINCT
// clip-relative time across every `transform.*` keyframe on the clip (Phase 7) — Timeline.jsx
// renders 1 marker per entry and, on click, removes every keyframe object listed (every animated
// property that happened to be keyframed at that exact instant), matching how "add keyframe at
// playhead" (VideoToolbar.jsx) always writes all 6 transform properties together.
export function keyframeMarkersForClip(clip) {
  const byTime = new Map();
  for (const kf of clip.keyframes || []) {
    if (!kf.propertyPath.startsWith('transform.')) continue;
    if (!byTime.has(kf.timeMs)) byTime.set(kf.timeMs, []);
    byTime.get(kf.timeMs).push(kf);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([timeMs, keyframes]) => ({ timeMs, keyframes }));
}

// computeSpeedResizedDuration(clip, newSpeed) -> new timeline duration (ms) for `clip` if its
// speed changes to `newSpeed` — VideoToolbar.jsx's speed control computes this itself (rather than
// shared/video-commands/SetClipSpeed.js deriving it internally) per that command's own "apply is a
// pure function of its args" contract (Phase 8, 04-video-editor.md §5). Normal speed: the clip's
// TRIMMED source range takes proportionally less/more of the timeline (duration = sourceRange /
// |speed|) — a 2x clip occupies half the timeline space it used to. Freeze-frame (speed 0) has no
// such relationship (a single held frame's hold length is an arbitrary choice, not derived from
// anything) — keeps whatever duration the clip already had.
export function computeSpeedResizedDuration(clip, newSpeed) {
  if (newSpeed === 0) return clip.timelineOutMs - clip.timelineInMs;
  const sourceDurationMs = clip.sourceOutMs - clip.sourceInMs;
  return sourceDurationMs / Math.abs(newSpeed);
}

// adjacentClipPairs(track) -> [{fromClip, toClip}] for every pair of clips on `track` that
// genuinely TOUCH (toClip.timelineInMs === fromClip.timelineOutMs, no gap, no overlap) — Phase 9
// (04-video-editor.md §5): these are the ONLY pairs a transition can legally reference
// (shared/video-commands/invariants.js's assertTransitionsReferenceAdjacentClips), so this is what
// Timeline.jsx's transition-toggle marker iterates to decide where to render one.
export function adjacentClipPairs(track) {
  const sorted = [...track.clips].sort((a, b) => a.timelineInMs - b.timelineInMs);
  const pairs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].timelineInMs === sorted[i].timelineOutMs) pairs.push({ fromClip: sorted[i], toClip: sorted[i + 1] });
  }
  return pairs;
}

// blendModeFor(clip) -> Canvas2D globalCompositeOperation value for `clip`'s `blendMode` effect
// (Phase 10, 04-video-editor.md §5) — 'multiply'/'screen'/'overlay'/'darken'/'lighten' match
// Canvas2D's own keyword names directly (no translation table needed), 'source-over' is the
// canvas default ("normal" blending) used when there's no enabled blendMode effect at all.
// Used by canvasEngine.js for preview; backend/video/renderPlanner.js (Phase 12, §0) has its own
// separate `dominantBlendModeFor()` for export — see EffectsPanel.jsx's header comment for how the
// 2 can differ (export is per-TRACK, preview is per-clip).
export function blendModeFor(clip) {
  const effect = (clip.effects || []).find((e) => e.type === 'blendMode' && e.enabled);
  return effect?.params.mode || 'source-over';
}

// colorGradeFilterFor(clip) -> CSS `filter` string for `clip`'s enabled `colorGrade` effect, or
// undefined if none (Phase 11, 04-video-editor.md §5). Used by BOTH canvasEngine.js's `ctx.filter`
// and Player.jsx's VideoTagPlayer `<video>` style so the 2 preview paths never independently
// drift. contrast/saturation/hue map exactly onto CSS's own filter functions (both they and
// ffmpeg's real export filters — backend/video/renderPlanner.js's `eq`/`hue` — treat 1.0/1.0/0deg
// as their no-op default the same way). brightness does NOT map exactly: ffmpeg eq's `brightness`
// is an ADDITIVE offset (-1..1) but CSS `brightness()` is MULTIPLICATIVE — `1 + brightness` is a
// reasonable approximation at small values only, not the same math. gamma has no CSS filter
// equivalent at all and is silently skipped here (export-only gap, same class as Phase 7's
// scale/rotation-keyframe export cut).
export function colorGradeFilterFor(clip) {
  const effect = (clip.effects || []).find((e) => e.type === 'colorGrade' && e.enabled);
  if (!effect) return undefined;
  const { brightness = 0, contrast = 1, saturation = 1, hue = 0 } = effect.params;
  const parts = [];
  if (brightness !== 0) parts.push(`brightness(${1 + brightness})`);
  if (contrast !== 1) parts.push(`contrast(${contrast})`);
  if (saturation !== 1) parts.push(`saturate(${saturation})`);
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  return parts.length ? parts.join(' ') : undefined;
}

export function previewFilterFor(clip, playheadMs) {
  const color = colorGradeFilterFor(clip);
  const elapsed = Math.max(0, playheadMs - clip.timelineInMs);
  const remaining = Math.max(0, clip.timelineOutMs - playheadMs);
  const fade = (clip.videoFadeInMs > 0 ? Math.min(1, elapsed / clip.videoFadeInMs) : 1)
    * (clip.videoFadeOutMs > 0 ? Math.min(1, remaining / clip.videoFadeOutMs) : 1);
  return [color, fade < 1 ? `brightness(${fade})` : ''].filter(Boolean).join(' ') || undefined;
}

// 08.2.2 §6 (Duplicate): buildDuplicateClip(clip) -> a full clip object identical to `clip` except
// for a fresh id — deep-cloned via JSON round-trip (same simplicity choice
// shared/video-commands/state.js's own cloneState() already makes: correctness over performance
// for small JSON, not a hot loop) so nested fields (transform, effects, keyframes) don't alias the
// original. Caller decides WHERE to place it (findNextFreeSlot below, or a drop position) and
// commits it via the existing InsertClip command — no new command type, no asset binary copy
// (assetId stays a plain string reference).
export function buildDuplicateClip(clip) {
  const copy = JSON.parse(JSON.stringify(clip));
  copy.id = crypto.randomUUID();
  return copy;
}

// findNextFreeSlot(track, afterMs, durationMs, excludeClipId) -> the earliest startMs >= afterMs
// where a clip of `durationMs` fits without overlapping any OTHER clip on `track` — jumps to the
// blocking clip's own end each time it hits one. Bounded by `track.clips.length` iterations (each
// jump consumes exactly one blocking clip, so it can never loop more than that).
export function findNextFreeSlot(track, afterMs, durationMs, excludeClipId) {
  let startMs = afterMs;
  for (let i = 0; i <= track.clips.length; i++) {
    const blocker = track.clips.find((c) => c.id !== excludeClipId && startMs < c.timelineOutMs && startMs + durationMs > c.timelineInMs);
    if (!blocker) return startMs;
    startMs = blocker.timelineOutMs;
  }
  return startMs;
}

// 08.2.6 §1: 3 media kinds (video/image/audio) collapse into 2 timeline zones — `audio` tracks are
// the only `audio`-zone member, every other track type (`video`/`image`/`sticker`/`caption`) is
// `visual` (sticker/caption aren't part of the spec's 3 kinds, but render above the divider like
// any other on-screen overlay — see 08-2-6 plan's scope note, their own drop-compatibility rules
// are untouched below).
export function getTrackZone(type) {
  return type === 'audio' ? 'audio' : 'visual';
}

// 08.2.6 §1/§2: compatibility is zone-based, not label-based — a `video` track and an `image`
// track accept each other's clips/assets interchangeably (both `visual`), everything else
// (sticker/caption/audio) stays exactly-type-only, unchanged from before this spec.
const VISUAL_MEDIA_TRACK_TYPES = new Set(['video', 'image']);
export function tracksAreZoneCompatible(typeA, typeB) {
  if (typeA === typeB) return true;
  return VISUAL_MEDIA_TRACK_TYPES.has(typeA) && VISUAL_MEDIA_TRACK_TYPES.has(typeB);
}

// 08.2.6 §2 (Visual Zone luôn ở trên Audio Zone): Timeline.jsx's marquee hit-test (`sortedTracks`)
// and its render loop (`sortedTracksForRender`) both independently derived a `trackIndex` purely
// from `.sort(order)`, and `clipScreenRect()` below trusts that index as a uniform-row-height
// pixel offset — so grouping tracks by zone for DISPLAY only in one of those 2 places (without the
// other) would desync marquee hit-testing from what's actually on screen the moment any project
// has zones interleaved by `order` (e.g. Video, Audio, Video added in that sequence — already
// possible today, zone grouping is what's new). Both callers use THIS one function instead, so
// `rowIndex` always means the same pixel row in both. `kind:'empty-zone'` placeholder rows (CTA to
// add a first track of that zone) are real entries in this array — the row list dictates on-screen
// order to both callers, not just `projectState.tracks` itself.
export function getTimelineRows(projectState) {
  const tracks = [...projectState.tracks].sort((a, b) => Number(a.type === 'audio') - Number(b.type === 'audio') || b.order - a.order);
  const rows = [];
  if (!tracks.some(t => getTrackZone(t.type) === 'visual')) rows.push({ kind: 'empty-zone', zone: 'visual' });
  for (const track of tracks) rows.push({ kind: 'track', track });
  if (!tracks.some(t => getTrackZone(t.type) === 'audio')) rows.push({ kind: 'empty-zone', zone: 'audio' });
  return rows;
}

export function orderAboveTrack(tracks, targetId, excludeIds = []) {
  const ordered = tracks.filter(t => t.type !== 'audio' && !excludeIds.includes(t.id)).sort((a, b) => b.order - a.order);
  if (tracks.find(t => t.id === targetId)?.type === 'audio') return (ordered.at(-1)?.order ?? 1) - 1;
  const index = ordered.findIndex(t => t.id === targetId);
  if (index <= 0) return (ordered[0]?.order ?? -1) + 1;
  return (ordered[index - 1].order + ordered[index].order) / 2;
}

export function orderForNewTrack(tracks, type, targetId) {
  if (type !== 'audio') return orderAboveTrack(tracks, targetId);
  return Math.min(0, ...tracks.filter(t => t.type === 'audio').map(t => t.order)) - 1;
}

// Reorder only the moved rows. Unrelated/locked row orders are never rewritten.
export function trackReorderChanges(state, sources, targetId) {
  const ids = new Set(sources.map(t => t.id)), changes = [];
  for (const audio of [false, true]) {
    const moved = sources.filter(t => (t.type === 'audio') === audio).sort((a, b) => b.order - a.order);
    if (!moved.length) continue;
    const remaining = state.tracks.filter(t => !ids.has(t.id) && (t.type === 'audio') === audio).sort((a, b) => b.order - a.order);
    const target = remaining.findIndex(t => t.id === targetId);
    const index = target >= 0 ? target + Number(audio) : audio || state.tracks.find(t => t.id === targetId)?.type === 'audio' ? remaining.length : 0;
    const upper = remaining[index - 1]?.order, lower = remaining[index]?.order;
    moved.forEach((track, i) => {
      const order = upper != null && lower != null ? upper - (upper - lower) * (i + 1) / (moved.length + 1)
        : upper != null ? upper - i - 1 : (lower ?? 0) + moved.length - i;
      if (order !== track.order) changes.push({ path: ['tracks', state.tracks.findIndex(t => t.id === track.id), 'order'], from: track.order, to: order });
    });
  }
  return changes;
}

// 08.2.2 §1 (Multi-select move): tracks of `type`, sorted by `.order` — the SAME order
// Timeline.jsx renders tracks in, and what track-offset below is computed against. Deliberately
// stays exact-type (not zone) — 08.2.6 doesn't ask multi-move-by-N-tracks to treat video/image as
// interchangeable, changing this would be scope creep into an already-shipped, already-tested
// feature (08.2.2).
function tracksOfType(projectState, type) {
  return projectState.tracks.filter((t) => t.type === type).sort((a, b) => a.order - b.order);
}

// buildMultiMoveTargets(projectState, selectedIds, primaryClipId, dropTrackId, primaryStartMs) ->
// { moves: [{clipId, fromTrackId, toTrackId, fromTimelineInMs, toTimelineInMs}, ...] } | null.
// Keeps every OTHER selected clip's relative time offset (the same deltaMs the primary moved by)
// AND relative track offset WITHIN ITS OWN type-group — a clip can only ever land on a track of
// its own type (Timeline.jsx's fromTrack.type !== track.type guard), so "move 1 track forward" is
// only meaningful counted within that type's own group. Returns null (reject the whole batch,
// atomic — no partial multi-move) if that offset would put any clip's target track outside its
// own group's bounds.
export function buildMultiMoveTargets(projectState, selectedIds, primaryClipId, dropTrackId, primaryStartMs) {
  const primaryLoc = findClipLocation(projectState, primaryClipId);
  const dropTrack = projectState.tracks.find((t) => t.id === dropTrackId);
  if (!primaryLoc || !dropTrack) return null;
  const primaryGroup = tracksOfType(projectState, primaryLoc.track.type);
  const fromGroupIndex = primaryGroup.findIndex((t) => t.id === primaryLoc.track.id);
  const toGroupIndex = primaryGroup.findIndex((t) => t.id === dropTrack.id);
  if (fromGroupIndex === -1 || toGroupIndex === -1) return null;
  const trackOffset = toGroupIndex - fromGroupIndex;
  const deltaMs = primaryStartMs - primaryLoc.clip.timelineInMs;

  const moves = [];
  for (const clipId of selectedIds) {
    const loc = findClipLocation(projectState, clipId);
    if (!loc) return null;
    const group = tracksOfType(projectState, loc.track.type);
    const ownIndex = group.findIndex((t) => t.id === loc.track.id);
    const targetIndex = ownIndex + trackOffset;
    if (targetIndex < 0 || targetIndex >= group.length) return null;
    moves.push({
      clipId, fromTrackId: loc.track.id, toTrackId: group[targetIndex].id,
      fromTimelineInMs: loc.clip.timelineInMs, toTimelineInMs: loc.clip.timelineInMs + deltaMs,
    });
  }
  return { moves };
}

// multiMoveOverlaps(projectState, moves) -> true if ANY move's target range would collide with a
// clip NOT part of this batch, or with another move's OWN target range on the same destination
// track — the proactive check handleDropClip runs BEFORE building the MoveClips command, same
// idea as the existing single-move clipsOverlap check, generalized to a whole batch.
export function multiMoveOverlaps(projectState, moves) {
  const movingIds = new Set(moves.map((m) => m.clipId));
  const targets = moves.map((m) => {
    const { clip } = findClipLocation(projectState, m.clipId);
    const durationMs = clip.timelineOutMs - clip.timelineInMs;
    return { ...m, toTimelineOutMs: m.toTimelineInMs + durationMs };
  });
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    const track = projectState.tracks.find((t) => t.id === a.toTrackId);
    const blockedByExisting = track.clips.some((c) => !movingIds.has(c.id)
      && a.toTimelineInMs < c.timelineOutMs && a.toTimelineOutMs > c.timelineInMs);
    if (blockedByExisting) return true;
    for (let j = i + 1; j < targets.length; j++) {
      const b = targets[j];
      if (b.toTrackId !== a.toTrackId) continue;
      if (a.toTimelineInMs < b.toTimelineOutMs && a.toTimelineOutMs > b.toTimelineInMs) return true;
    }
  }
  return false;
}

// 08.2.2 §5 (Multi-select ripple delete): mergeRippleIntervals(projectState, clipIds) -> the
// `perTrack` arg shape RippleDeleteClips.js expects directly:
// [{trackId, intervals: [{startMs, endMs, removals: [{index, clip}, ...]}, ...]}, ...].
// Clips selected for ripple-delete that are ADJACENT and TOUCHING (next.timelineInMs ===
// prev.timelineOutMs) on the SAME track are merged into ONE interval — deleting them as a single
// unit is what avoids double-shifting whatever comes after (ripple-deleting each individually
// would each try to shift the SAME downstream clips by their own duration, over-counting the
// gap). A genuine time gap or a non-selected clip in between starts a new interval. Tracks with no
// selected clips are omitted entirely.
export function mergeRippleIntervals(projectState, clipIds) {
  const idSet = new Set(clipIds);
  const perTrack = [];
  for (const track of projectState.tracks) {
    const selected = track.clips
      .map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => idSet.has(clip.id))
      .sort((a, b) => a.clip.timelineInMs - b.clip.timelineInMs);
    if (selected.length === 0) continue;

    const intervals = [];
    let current = null;
    for (const { clip, index } of selected) {
      if (current && clip.timelineInMs === current.endMs) {
        current.endMs = clip.timelineOutMs;
        current.removals.push({ index, clip });
      } else {
        current = { startMs: clip.timelineInMs, endMs: clip.timelineOutMs, removals: [{ index, clip }] };
        intervals.push(current);
      }
    }
    perTrack.push({ trackId: track.id, intervals });
  }
  return perTrack;
}

export function clipsOverlap(track, startMs, endMs, excludeClipId) {
  return track.clips.some((c) => {
    if (c.id === excludeClipId) return false;
    return startMs < c.timelineOutMs && endMs > c.timelineInMs;
  });
}

// 08.2.2 §2 (Snap): SNAP_PRIORITY — earlier entries win over later ones when several candidate
// types are within threshold at once (checked before falling back to "nearest wins" within the
// SAME type). playhead is the strongest anchor (an explicit, deliberate marker of "here"); marker
// next (an authored point in time — currently always empty, `sequence.markers` has no authoring
// UI yet, but this wires the priority slot so a future one needs no snap-logic change); transition
// crossfade-start next (a non-obvious but real edit point); clip-edge next (the everyday case);
// project-bounds (0 / the project's own last clip end) lowest, since it's rarely what you're
// actually aiming for mid-timeline.
const SNAP_PRIORITY = ['playhead', 'marker', 'transition', 'clip-edge', 'project-bounds'];

// buildSnapCandidates(projectState, track, playheadMs, excludeClipIds) -> [{ms, type}, ...] for a
// drag/trim gesture on `track` — every clip edge on `track` EXCEPT those in `excludeClipIds` (an
// array; the item(s) being moved/trimmed, so they never snap to their own edges — a multi-select
// move excludes every selected clip, not just the one being physically dragged), every marker,
// every transition's own crossfade-start point (fromClip.timelineOutMs - transition.durationMs —
// the moment the 2 clips actually start overlapping, not just where they touch, which is already
// a clip-edge candidate), the playhead, and the project's own bounds (0 and the last clip's own
// end, across ALL tracks).
export function buildSnapCandidates(projectState, track, playheadMs, excludeClipIds) {
  const excluded = new Set(excludeClipIds || []);
  const candidates = [];
  if (playheadMs != null) candidates.push({ ms: playheadMs, type: 'playhead' });
  for (const marker of projectState.sequence?.markers || []) {
    candidates.push({ ms: marker.timeMs, type: 'marker' });
  }
  for (const transition of projectState.transitions || []) {
    const fromLoc = findClipLocation(projectState, transition.fromClipId);
    if (fromLoc) candidates.push({ ms: fromLoc.clip.timelineOutMs - transition.durationMs, type: 'transition' });
  }
  for (const clip of track.clips) {
    if (excluded.has(clip.id)) continue;
    candidates.push({ ms: clip.timelineInMs, type: 'clip-edge' }, { ms: clip.timelineOutMs, type: 'clip-edge' });
  }
  candidates.push({ ms: 0, type: 'project-bounds' });
  const maxEndMs = projectState.tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, c.timelineOutMs), max), 0);
  if (maxEndMs > 0) candidates.push({ ms: maxEndMs, type: 'project-bounds' });
  return candidates;
}

// resolveSnap(candidates, rawMs, thresholdMs, stickyCandidate, marginMs = 0) -> { ms, candidate:
// {ms,type}|null }. Winner = highest-priority (SNAP_PRIORITY) candidate within thresholdMs of
// rawMs, nearest-wins as the tiebreak within the same priority; { ms: rawMs, candidate: null } if
// nothing qualifies (no snap). `stickyCandidate` (the previous winning candidate from the SAME
// in-progress gesture, or null at gesture start) is kept over a new candidate unless the new one
// is more than `marginMs` closer — the hysteresis that stops the snap flickering between two
// near-equidistant candidates as the pointer creeps by fractions of a pixel.
export function resolveSnap(candidates, rawMs, thresholdMs, stickyCandidate, marginMs = 0) {
  let best = null;
  let bestRank = Infinity;
  let bestDelta = Infinity;
  for (const c of candidates) {
    const delta = Math.abs(c.ms - rawMs);
    if (delta > thresholdMs) continue;
    const rank = SNAP_PRIORITY.indexOf(c.type);
    if (rank < bestRank || (rank === bestRank && delta < bestDelta)) {
      best = c; bestRank = rank; bestDelta = delta;
    }
  }
  if (stickyCandidate) {
    const stickyDelta = Math.abs(stickyCandidate.ms - rawMs);
    if (stickyDelta <= thresholdMs && (!best || stickyDelta <= bestDelta + marginMs)) {
      return { ms: stickyCandidate.ms, candidate: stickyCandidate };
    }
  }
  return best ? { ms: best.ms, candidate: best } : { ms: rawMs, candidate: null };
}

// 08.2.1 (specs/ai-creative-operations-platform/08-2-1-selection-navigation-and-feedback.md §1):
// clipsInTimeRange(track, aMs, bMs) -> every clip on `track` whose interval touches [min(a,b),
// max(a,b)] — used by Timeline.jsx's Shift+click to select the chronological run of clips between
// an anchor and the just-clicked clip. Order of a/b doesn't matter (Shift+click from either
// direction gives the same set), and since clips on one track never overlap (shared/video-commands/
// invariants.js), "touches the span" and "is between the two endpoints inclusive" are the same set.
export function clipsInTimeRange(track, aMs, bMs) {
  const lo = Math.min(aMs, bMs);
  const hi = Math.max(aMs, bMs);
  return track.clips.filter((c) => c.timelineInMs <= hi && c.timelineOutMs >= lo);
}

// 08-F F4 (specs/.../08-v2/08-f-timeline-authoring.md, "Group giữ relative offsets"): every clip
// across every track sharing `groupId` (own id included), sorted by timelineInMs for a deterministic
// primary/range order. A clip with no `groupId` (the overwhelming majority — grouping is opt-in) is
// its own 1-member "group" so callers don't need a separate ungrouped-vs-grouped branch.
export function clipsInGroup(projectState, groupId) {
  if (!groupId) return [];
  const result = [];
  for (const track of projectState.tracks) {
    for (const clip of track.clips) {
      if (clip.groupId === groupId) result.push(clip);
    }
  }
  return result.sort((a, b) => a.timelineInMs - b.timelineInMs);
}

// resolveSelectionOnClick(projectState, track, clip, currentPrimaryId, {mod, shift}) -> a selection
// action descriptor: {type:'toggle', clipId} for Mod+click, or {type:'set', ids, primaryId} for a
// plain click / Shift+click range. Shared by Timeline.jsx (timeline clip click) and Player.jsx
// (canvas/sticker reverse-select click) so both surfaces resolve Mod/Shift identically (§1/§2) —
// Shift+click only produces a range when the current primary resolves to a clip on the SAME track
// as the just-clicked clip; otherwise it falls back to a plain replace, same as a bare click.
// 08-F F4: a PLAIN click (no mod, no shift) on a grouped clip selects every member of its group —
// Mod/Shift click deliberately bypass this (power-user fine control to pick individual members
// within a group), matching the same asymmetry most editors use.
export function resolveSelectionOnClick(projectState, track, clip, currentPrimaryId, { mod, shift }) {
  if (mod) return { type: 'toggle', clipId: clip.id };
  if (shift && currentPrimaryId) {
    const anchor = findClipLocation(projectState, currentPrimaryId);
    if (anchor && anchor.track.id === track.id) {
      const range = clipsInTimeRange(track, anchor.clip.timelineInMs, clip.timelineInMs).sort((a, b) => a.timelineInMs - b.timelineInMs);
      return { type: 'set', ids: range.map((c) => c.id), primaryId: clip.id };
    }
  }
  if (clip.groupId) {
    const members = clipsInGroup(projectState, clip.groupId);
    if (members.length > 1) return { type: 'set', ids: members.map((c) => c.id), primaryId: clip.id };
  }
  return { type: 'set', ids: [clip.id], primaryId: clip.id };
}

// clipScreenRect/rectsIntersect/rectContains — pure marquee-selection hit-testing (Timeline.jsx
// §3 "marquee"), kept DOM-free like every other helper in this file. Coordinate space matches
// Timeline.jsx's rendered layout exactly: each track row is TRACK_HEIGHT_PX tall (Tailwind `h-16`),
// a clip sits CLIP_TOP_PX from its track's top (`top-4`) with fixed CLIP_HEIGHT_PX height (`h-10`)
// — if those Tailwind classes ever change, these constants must change with them. `trackIndex` is
// the clip's position in the SORTED-by-`.order` track list (the same order Timeline.jsx renders),
// not its raw index in `projectState.tracks`.
export const TRACK_HEIGHT_PX = 64;
const CLIP_TOP_PX = 16;
const CLIP_HEIGHT_PX = 40;

export function clipScreenRect(trackIndex, clip, pxPerSecond) {
  const left = (clip.timelineInMs / 1000) * pxPerSecond;
  const width = Math.max(4, ((clip.timelineOutMs - clip.timelineInMs) / 1000) * pxPerSecond);
  return { left, top: trackIndex * TRACK_HEIGHT_PX + CLIP_TOP_PX, width, height: CLIP_HEIGHT_PX };
}

export function rectsIntersect(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top;
}

export function rectContains(outer, inner) {
  return inner.left >= outer.left && inner.top >= outer.top
    && inner.left + inner.width <= outer.left + outer.width
    && inner.top + inner.height <= outer.top + outer.height;
}
