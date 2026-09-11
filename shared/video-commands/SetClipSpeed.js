// SetClipSpeed({ trackId, clipId, from: {speed,timelineOutMs}, to: {speed,timelineOutMs} }) —
// Video Editor Phase 8 (specs/space-flow-master-plan/04-video-editor.md §5). Changes a clip's
// playback speed AND its timeline duration together, atomically — a lone SetProperty on `speed`
// alone would leave the clip's timeline footprint mismatched with how much trimmed source content
// it now takes to play at the new speed (e.g. a 2x clip should occupy HALF the timeline space).
// `to.timelineOutMs` is caller-computed (frontend/src/video/timelineUtils.js's
// computeSpeedResizedDuration), not derived here — same "apply is a pure function of its args"
// contract every command in this directory follows; freeze-frame (speed 0) has no source-duration
// relationship to derive from anyway (an arbitrary hold length is the caller's choice).
// sourceInMs/sourceOutMs/timelineInMs are untouched: negative speed (reverse) is a PLAYBACK
// DIRECTION change, not a different trim range (see canvasEngine.js's clipToSourceSeconds()).
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function setSpeed(state, args, bounds) {
  const next = cloneState(state);
  const clip = getClip(next, args.trackId, args.clipId);
  clip.speed = bounds.speed;
  clip.timelineOutMs = bounds.timelineOutMs;
  return next;
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return setSpeed(state, args, args.to);
}

function invert(state, args) {
  return setSpeed(state, args, args.from);
}

module.exports = { validate, apply, invert };
