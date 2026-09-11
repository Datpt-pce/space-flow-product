// RelinkAsset({ clipRefs: [{trackId, clipId}], oldAssetId, newAssetId }) — Video Editor Phase 1.
// Repoints specific clips' assetId (the Phase 2 video_assets registry id, once that table
// exists) from oldAssetId to newAssetId — e.g. after backend/routes/video-assets.js's
// POST /:id/relink matches a moved/renamed file back to its content hash. `clipRefs` (the exact
// clips to touch, decided by the caller from the CURRENT state) is used instead of a blanket
// "every clip with assetId===oldAssetId" match, so invert() can safely reverse exactly these
// clips without accidentally re-touching some OTHER clip that already legitimately had
// newAssetId assigned before this command ran.
const { cloneState, getClip } = require('./state');
const { assertAllInvariants } = require('./invariants');

function setAssetId(state, args, assetId) {
  const next = cloneState(state);
  for (const ref of args.clipRefs) {
    getClip(next, ref.trackId, ref.clipId).assetId = assetId;
  }
  return next;
}

function validate(state, args) {
  assertAllInvariants(apply(state, args));
}

function apply(state, args) {
  return setAssetId(state, args, args.newAssetId);
}

function invert(state, args) {
  return setAssetId(state, args, args.oldAssetId);
}

module.exports = { validate, apply, invert };
