// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): the 11 commands §2
// names as the timeline command model, each a { validate(state,args), apply(state,args) ->
// newState, invert(state,args) -> priorState } module (see InsertClip.js's header comment for
// the full apply/invert contract every module here follows).
//
// Lives at repo root (not backend/ or frontend/src/) so BOTH sides require the exact same logic
// — backend/routes/video-projects.js requires this directly (plain Node, no bundler concerns);
// frontend/src/video/commands/CommandStack.js imports it too, verified to resolve through Vite
// (see that file's own comment) rather than the plan's fallback of accepting duplicated code —
// tooling wasn't actually a blocker here.

const InsertClip = require('./InsertClip');
const MoveClip = require('./MoveClip');
const MoveClips = require('./MoveClips');
const TrimClip = require('./TrimClip');
const SplitClip = require('./SplitClip');
const RippleDelete = require('./RippleDelete');
const RippleDeleteClips = require('./RippleDeleteClips');
const DeleteClip = require('./DeleteClip');
const DeleteClips = require('./DeleteClips');
const SetProperty = require('./SetProperty');
const SetProperties = require('./SetProperties');
const AddKeyframe = require('./AddKeyframe');
const RemoveKeyframe = require('./RemoveKeyframe');
const MoveKeyframe = require('./MoveKeyframe');
const SetKeyframeValue = require('./SetKeyframeValue');
const SetKeyframeEasing = require('./SetKeyframeEasing');
const SetKeyframeFields = require('./SetKeyframeFields');
const AddTransition = require('./AddTransition');
const ChangeTrackOrder = require('./ChangeTrackOrder');
const RelinkAsset = require('./RelinkAsset');
const AddTrack = require('./AddTrack');
const RemoveTrack = require('./RemoveTrack');
const SetClipSpeed = require('./SetClipSpeed');
const RemoveTransition = require('./RemoveTransition');
const AddEffect = require('./AddEffect');
const RemoveEffect = require('./RemoveEffect');
const UndoCommand = require('./UndoCommand');
const UnpackCompoundClip = require('./UnpackCompoundClip');
const BulkInsertClips = require('./BulkInsertClips');
const ResetCompositionOverrides = require('./ResetCompositionOverrides');
const invariants = require('./invariants');
const { prepareTrackCleanup, pruneTracks, restoreTracks } = require('./pruneEmptyTracks');

const commands = {
  InsertClip, MoveClip, TrimClip, SplitClip, RippleDelete, SetProperty,
  AddKeyframe, RemoveKeyframe, AddTransition, ChangeTrackOrder, RelinkAsset,
  // MoveKeyframe (08-G G4): drag-to-move a keyframe marker, batched across every keyframe object
  // that shares the marker's original timeMs — see MoveKeyframe.js's own header.
  MoveKeyframe,
  // SetKeyframeValue (08-G G4 auto-key): updates one keyframe's value in place — see its own header.
  SetKeyframeValue,
  // SetKeyframeEasing (08-G G5 easing picker): updates one keyframe's easing in place — see its own header.
  SetKeyframeEasing,
  // SetKeyframeFields (08-G G5 ADR 0036, custom bezier easing): atomic multi-field keyframe update — see its own header.
  SetKeyframeFields,
  // AddTrack/RemoveTrack (Phase 6) / SetClipSpeed (Phase 8) / RemoveTransition (Phase 9) /
  // AddEffect/RemoveEffect (Phase 10) / SetProperties (08.1): additions beyond §2's original 11 —
  // same { validate, apply, invert } contract, see their own file headers.
  AddTrack, RemoveTrack, SetClipSpeed, RemoveTransition, AddEffect, RemoveEffect, SetProperties,
  // DeleteClip (08.2.2): non-ripple delete — keeps the gap, RippleDelete's own counterpart.
  DeleteClip,
  // MoveClips (08.2.2): batched multi-select move, mirrors SetProperties' one-command-N-changes
  // pattern for MoveClip.
  MoveClips,
  // DeleteClips/RippleDeleteClips (08.2.2 §5): batched multi-select delete, non-ripple and ripple.
  DeleteClips, RippleDeleteClips,
  // Undo (08-D D4): durable inverse-command wrapper, see UndoCommand.js's own header.
  Undo: UndoCommand,
  // UnpackCompoundClip (08-F F5 / ADR 0034): replaces a compound clip with its embedded timeline's
  // literal tracks, as one atomic transaction — see UnpackCompoundClip.js's own header.
  UnpackCompoundClip,
  // BulkInsertClips (08-F F8): appends N precomputed clips (optionally onto brand-new tracks) onto
  // one timeline as one atomic transaction — see its own header.
  BulkInsertClips,
  ResetCompositionOverrides,
};

// runCommand(state, type, args) -> newState — validate() throws (with a clear message) BEFORE
// apply() ever runs if the command would violate an invariant, so a rejected command never
// touches state at all (Phase 1 acceptance criteria: "command vi phạm invariant bị validate()
// reject trước apply(), message rõ"). assertLockedTracksUnchanged (08-F F1) is checked here, once,
// against EVERY command's result — see that function's own comment for why this lives centrally
// instead of duplicated inside each command's own validate().
function runCommand(state, type, args) {
  const command = commands[type];
  if (!command) throw new Error(`Unknown command type: "${type}"`);
  command.validate(state, args);
  const next = command.apply(state, args);
  invariants.assertLockedTracksUnchanged(state, next);
  return args?.prunedTracks ? pruneTracks(next, args.prunedTracks) : next;
}

// invertCommand(state, type, args) -> priorState — the undo half of runCommand(), same
// validation-free path since invert() only ever reconstructs a state this exact command already
// produced (nothing new to reject).
function invertCommand(state, type, args) {
  const command = commands[type];
  if (!command) throw new Error(`Unknown command type: "${type}"`);
  return command.invert(args?.prunedTracks ? restoreTracks(state, args.prunedTracks) : state, args);
}

module.exports = { commands, invariants, runCommand, invertCommand, prepareTrackCleanup };
