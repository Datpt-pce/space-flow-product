// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md §5 Phase 1 task
// checklist): assertNoNegativeDuration, assertNoIllegalOverlap, assertKeyframeWithinClip.
// Called from each command module's validate() on the state the command is ABOUT to produce
// (validate() clones+applies internally to check, then throws before the real apply() call if
// anything's wrong) — so a command that would violate an invariant never reaches apply() at all.
//
// Scope note: assertNoIllegalOverlap enforces "no 2 clips overlap in the same track" for EVERY
// track type, not only video — the plan's own §2 wording only calls out the video case
// explicitly ("cùng track video chỉ 1 clip tại 1 thời điểm ở MVP") but gives no reason an audio
// track should behave differently within a single linear track lane at this phase. Transitions
// (deliberate, intentional overlap between 2 adjacent clips) are NOT yet exempted here — Phase 1
// has no Timeline UI wiring transitions to real overlapping clips yet, and AddTransition's own
// validate() doesn't relax this check. Revisit when Phase 3/4 actually needs overlapping clips
// under a transition.

function assertNoNegativeDuration(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.timelineOutMs <= clip.timelineInMs) {
        throw new Error(`Clip ${clip.id} has non-positive timeline duration (in=${clip.timelineInMs}, out=${clip.timelineOutMs})`);
      }
      if (clip.sourceOutMs <= clip.sourceInMs) {
        throw new Error(`Clip ${clip.id} has non-positive source duration (in=${clip.sourceInMs}, out=${clip.sourceOutMs})`);
      }
    }
  }
}

// 08.2.2 (specs/ai-creative-operations-platform/08-2-2-clip-placement-trim-and-ripple.md §3):
// "không tạo duration ≤ minimum frame" — a separate check from assertNoNegativeDuration's
// out>in (which already rejects 0/negative) because a positive-but-sub-frame duration (e.g. 2ms)
// is a distinct failure mode TrimClip/SplitClip can produce that out>in alone doesn't catch.
// EPSILON_MS tolerates IEEE754 float noise at the exact boundary — a caller that clamps a trim
// target to `timelineInMs + minDurationMs` can see `(timelineInMs + minDurationMs) - timelineInMs`
// come back a hair under minDurationMs (float addition/subtraction isn't perfectly invertible),
// which would otherwise reject a clamp that is, in intent, exactly at the limit. A genuine
// sub-frame violation is off by whole milliseconds, never by 1e-6.
const EPSILON_MS = 1e-6;
function assertMinClipDuration(state) {
  const minMs = 1000 / (state.fps || 30);
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.timelineOutMs - clip.timelineInMs < minMs - EPSILON_MS) {
        throw new Error(`Clip ${clip.id} is shorter than 1 frame (${minMs.toFixed(2)}ms at ${state.fps || 30}fps)`);
      }
    }
  }
}

// assertValidCrop — 08-G G3 (specs/.../08-v2/08-g-canvas-motion-text-and-audio.md, crop/mask):
// `clip.crop` is optional ({x,y,width,height}, normalized 0-1 fractions of the SOURCE frame — see
// shared/video-transform.js's normalizedCropFor()/CROP_DEFAULTS). A clip with no crop field is
// always valid (untouched by this check) — this only rejects a crop that would ask ffmpeg's
// `crop=` filter / Canvas2D's `drawImage()` source-rect for a nonsensical or out-of-bounds region
// (negative/zero size, or a window that extends past the source frame's own edge).
function assertValidCrop(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (!clip.crop) continue;
      const { x, y, width, height } = clip.crop;
      if (!(width > 0) || !(height > 0)) {
        throw new Error(`Clip ${clip.id}'s crop must have positive width/height (got width=${width}, height=${height})`);
      }
      if (x < 0 || y < 0 || x + width > 1 || y + height > 1) {
        throw new Error(`Clip ${clip.id}'s crop window (x=${x}, y=${y}, width=${width}, height=${height}) extends outside the source frame (0-1 range)`);
      }
    }
  }
}

// assertValidPivot — 08-G G3 rotation pivot (ADR 0035): `transform.pivotX/pivotY` are normalized
// 0-1 fractions of the clip's OWN destWidth/destHeight box (0.5/0.5 = center, today's default).
// Clamped to [0,1] here — the pad/crop pivot-rotation ffmpeg technique in renderPlanner.js derives
// pad amounts from `max(px, W-px)`, which stays well-defined outside [0,1] too, but a pivot outside
// the clip's own box has no clear visual meaning yet (no product decision on what "pivot beyond the
// edge" should look like) — deferred, same class of scope cut as G3 crop/mask's own boundary check.
function assertValidPivot(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      const t = clip.transform;
      if (!t) continue;
      if (t.pivotX !== undefined && (t.pivotX < 0 || t.pivotX > 1)) {
        throw new Error(`Clip ${clip.id}'s transform.pivotX (${t.pivotX}) must be within 0-1`);
      }
      if (t.pivotY !== undefined && (t.pivotY < 0 || t.pivotY > 1)) {
        throw new Error(`Clip ${clip.id}'s transform.pivotY (${t.pivotY}) must be within 0-1`);
      }
    }
  }
}

// assertNoDuplicateKeyframeTime — 08-G G4 (specs/.../08-v2/08-g-canvas-motion-text-and-audio.md,
// keyframe move/collision): 2 keyframes for the SAME propertyPath at the exact same clip-relative
// timeMs on one clip is not a meaningful state — interpolateAtTime (shared/video-keyframes.js)
// sorts by timeMs (a stable sort) and walks segments by ORDER, so 2 entries tied at the identical
// time would make interpolation depend on array/insertion order rather than anything the user
// intended. Could only arise once keyframes on the same clip can move independently of each other
// (MoveKeyframe, this same G4 pass) or via a re-add at an already-keyframed instant — both AddKeyframe
// and MoveKeyframe's own validate() run this via assertAllInvariants, so either path is rejected
// here once instead of duplicated in both command modules.
function assertNoDuplicateKeyframeTime(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      const seen = new Set();
      for (const kf of clip.keyframes || []) {
        const key = `${kf.propertyPath}@${kf.timeMs}`;
        if (seen.has(key)) {
          throw new Error(`Clip ${clip.id} has 2 keyframes for ${kf.propertyPath} at the same timeMs (${kf.timeMs})`);
        }
        seen.add(key);
      }
    }
  }
}

// assertValidCustomEasing — 08-G G5 (ADR 0036, docs/decisions/0036-keyframe-custom-bezier-easing-
// minimal-slice.md): a keyframe with `easing === 'custom'` must carry finite `easingX1/Y1/X2/Y2`,
// with X1/X2 constrained to [0,1] — that constraint is what makes the bezier's `x(u)` a monotonic
// function of `u` (shared/video-easing.js's `solveBezierU` binary search assumes this), the same
// requirement the CSS `cubic-bezier()` spec itself imposes for the identical reason. Y1/Y2 are
// deliberately NOT range-checked — CSS allows Y outside [0,1] on purpose (overshoot/bounce curves).
function assertValidCustomEasing(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      for (const kf of clip.keyframes || []) {
        if (kf.easing !== 'custom') continue;
        for (const key of ['easingX1', 'easingY1', 'easingX2', 'easingY2']) {
          if (typeof kf[key] !== 'number' || !Number.isFinite(kf[key])) {
            throw new Error(`Keyframe ${kf.id} has easing:'custom' but ${key} is not a finite number (${JSON.stringify(kf[key])})`);
          }
        }
        if (kf.easingX1 < 0 || kf.easingX1 > 1) {
          throw new Error(`Keyframe ${kf.id}'s easingX1 (${kf.easingX1}) must be within 0-1`);
        }
        if (kf.easingX2 < 0 || kf.easingX2 > 1) {
          throw new Error(`Keyframe ${kf.id}'s easingX2 (${kf.easingX2}) must be within 0-1`);
        }
      }
    }
  }
}

function assertNoIllegalOverlap(state) {
  for (const track of state.tracks) {
    const sorted = [...track.clips].sort((a, b) => a.timelineInMs - b.timelineInMs);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timelineInMs < sorted[i - 1].timelineOutMs) {
        throw new Error(`Track ${track.id}: clip ${sorted[i].id} overlaps clip ${sorted[i - 1].id}`);
      }
    }
  }
}

// Keyframe time is CLIP-RELATIVE (0 = clip's own start), so it moves with the clip when the clip
// is moved/trimmed — the alternative (absolute timeline time) would silently detach keyframes
// from their clip on every MoveClip, which is clearly wrong for a per-clip effect parameter.
function assertKeyframeWithinClip(state) {
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      const clipDurationMs = clip.timelineOutMs - clip.timelineInMs;
      for (const kf of clip.keyframes || []) {
        if (kf.timeMs < 0 || kf.timeMs > clipDurationMs) {
          throw new Error(`Keyframe ${kf.id} on clip ${clip.id} is outside the clip's duration (timeMs=${kf.timeMs}, clip duration=${clipDurationMs})`);
        }
      }
    }
  }
}

// assertTransitionsReferenceAdjacentClips — Video Editor Phase 9 (specs/space-flow-master-plan/
// 04-video-editor.md §5): a `state.transitions` entry only makes sense (backend/video/
// renderPlanner.js's xfade chain, canvasEngine.js preview) between 2 clips on the SAME track that
// are exactly ADJACENT (toClip.timelineInMs === fromClip.timelineOutMs, no overlap, no gap) — the
// deliberate scope decision this phase made instead of the alternative "clips overlap by the
// transition's own duration" model (which would need every downstream clip/track's position
// resynced after each transition, a much bigger undertaking, see the phase's own write-up).
// Checked as a GLOBAL invariant (not just AddTransition's own validate()) so any command that
// would orphan an existing transition — MoveClip/TrimClip/SplitClip pulling a clip away,
// RippleDelete removing one — is rejected instead of silently leaving a transition pointing at
// clips that are no longer touching (or don't exist at all).
function assertTransitionsReferenceAdjacentClips(state) {
  for (const transition of state.transitions || []) {
    let fromClip = null;
    let toClip = null;
    let fromTrackId = null;
    let toTrackId = null;
    for (const track of state.tracks) {
      const f = track.clips.find((c) => c.id === transition.fromClipId);
      if (f) { fromClip = f; fromTrackId = track.id; }
      const t = track.clips.find((c) => c.id === transition.toClipId);
      if (t) { toClip = t; toTrackId = track.id; }
    }
    if (!fromClip || !toClip) {
      throw new Error(`Transition ${transition.id} references a clip that no longer exists`);
    }
    if (fromTrackId !== toTrackId) {
      throw new Error(`Transition ${transition.id}'s clips are no longer on the same track`);
    }
    if (toClip.timelineInMs !== fromClip.timelineOutMs) {
      throw new Error(`Transition ${transition.id}'s clips are no longer adjacent (fromClip ends at ${fromClip.timelineOutMs}, toClip starts at ${toClip.timelineInMs})`);
    }
    // Longer than either clip -> the xfade offset math (renderPlanner.js) would go negative,
    // consuming more of a clip than it has.
    const fromDurationMs = fromClip.timelineOutMs - fromClip.timelineInMs;
    const toDurationMs = toClip.timelineOutMs - toClip.timelineInMs;
    if (!Number.isFinite(transition.durationMs) || transition.durationMs <= 0 || transition.durationMs > Math.min(fromDurationMs, toDurationMs)) {
      throw new Error(`Transition ${transition.id}'s durationMs (${transition.durationMs}) must be > 0 and <= the shorter of its 2 clips' own durations (${Math.min(fromDurationMs, toDurationMs)})`);
    }
    if (transition.type && !['crossfade', 'pull-in', 'pull-out'].includes(transition.type)) throw new Error('Loại transition không hỗ trợ');
  }
}

// assertLockedTracksUnchanged(prevState, nextState) — 08-F F1 (specs/.../08-v2/08-f-timeline-
// authoring.md, acceptance §6: "Locked track chặn mọi mutation path nhưng vẫn inspect được").
// Track lock was previously enforced ONLY at the UI layer (frontend/src/video/components/
// Timeline.jsx's own drag/drop/keyboard/Inspector guards — see that file's handleToggleLocked
// comment) — real, but not authoritative: a command posted directly to
// POST /api/video-projects/:id/commands (a stale client, a multi-tab race, or a future automation/
// bulk-import caller per 08-F F8/08-I) bypassed it entirely. Enforced here once, for every command
// uniformly (see index.js's runCommand()), instead of duplicated across ~20 command modules.
// Compares CLIPS content only — a track's own locked/muted/visible/order fields (including
// SetProperty toggling `locked` itself, how a user unlocks a track) are untouched by this check;
// only a track's `clips` array must stay byte-identical while that track was locked BEFORE the
// command ran. A track that no longer exists in nextState (RemoveTrack) is skipped — whether
// removing a locked track's whole track is itself allowed is a separate, undecided question this
// check doesn't take a position on.
function assertLockedTracksUnchanged(prevState, nextState) {
  for (const prevTrack of prevState.tracks) {
    if (!prevTrack.locked) continue;
    const nextTrack = nextState.tracks.find((t) => t.id === prevTrack.id);
    if (!nextTrack) continue;
    if (JSON.stringify(nextTrack.clips) !== JSON.stringify(prevTrack.clips)) {
      throw new Error(`Track ${prevTrack.id} is locked — its clips cannot be modified`);
    }
  }
}

function assertAllInvariants(state) {
  assertNoNegativeDuration(state);
  assertMinClipDuration(state);
  assertNoIllegalOverlap(state);
  assertKeyframeWithinClip(state);
  assertNoDuplicateKeyframeTime(state);
  assertValidCustomEasing(state);
  assertTransitionsReferenceAdjacentClips(state);
  assertValidCrop(state);
  assertValidPivot(state);
  for (const track of state.tracks) for (const clip of track.clips) {
    if (clip.mask) {
      const limits = { x: [0, 1], y: [0, 1], width: [0.01, 2], height: [0.01, 2], rotation: [-360, 360], feather: [0, 1] };
      for (const [key, [min, max]] of Object.entries(limits)) {
        const value = clip.mask[key];
        if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`Mask ${key} must be within ${min}..${max}`);
      }
      if (!['circle', 'rectangle', 'split', 'mirror', 'diamond', 'heart', 'star', 'text', 'brush', 'draw'].includes(clip.mask.type)) throw new Error('Invalid mask type');
      if (clip.mask.paths !== undefined && (!Array.isArray(clip.mask.paths) || clip.mask.paths.length > 64 || clip.mask.paths.some(points => !Array.isArray(points) || points.length > 256 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))))) throw new Error('Invalid mask drawing');
    }
    if (clip.audioChannel !== undefined && !['none', 'left', 'right', 'mono'].includes(clip.audioChannel)) throw new Error('Invalid audio channel');
    if (clip.background && (!['none', 'color', 'blur'].includes(clip.background.mode) || !/^#[0-9a-f]{6}$/i.test(clip.background.color))) throw new Error('Invalid canvas background');
    for (const content of [clip.shape, track.type === 'text' ? clip.text : null].filter(Boolean)) {
      for (const key of ['width', 'height']) if (!Number.isFinite(content[key]) || content[key] < 2 || content[key] > 4096) throw new Error(`Vector ${key} must be within 2..4096`);
    }
  }
}

module.exports = {
  assertNoNegativeDuration, assertMinClipDuration, assertNoIllegalOverlap, assertKeyframeWithinClip,
  assertNoDuplicateKeyframeTime, assertValidCustomEasing,
  assertTransitionsReferenceAdjacentClips, assertLockedTracksUnchanged, assertValidCrop, assertValidPivot,
  assertAllInvariants,
};
