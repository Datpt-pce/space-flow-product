const { canonicalJson, documentDiff } = require('../../shared/video-document-diff');
const { assertAllInvariants } = require('../../shared/video-commands/invariants');
const { cloneState } = require('../../shared/video-commands/state');
const { digest } = require('./versionService');

// Pure compilation: all referenced inputs/media metadata must already be pinned
// and authorized by the service. No clock, random IDs, files or provider calls.
function compileComposition(recipe, creative, components, assets) {
  if (creative.payload.recipeVersionId !== recipe.id) throw new Error('Biến thể không khớp mẫu đã ghim.');
  const document = cloneState(recipe.payload.document);
  const segments = [];
  const dependencies = [];
  for (const slot of recipe.payload.slots) {
    const componentId = creative.payload.components[slot.clipId];
    const component = components[componentId];
    if (!component || component.payload.trackType !== slot.trackType) throw new Error(`Thiếu component phù hợp cho ${slot.label}.`);
    const track = document.tracks.find(t => t.id === slot.trackId);
    const index = track.clips.findIndex(c => c.id === slot.clipId);
    const clip = { ...cloneState(component.payload.clip), id: slot.clipId };
    if (clip.assetId) {
      const asset = assets[clip.assetId];
      if (!asset || asset.status !== 'ok' || asset.content_hash !== component.payload.assetHash) throw new Error(`Media của ${slot.label} đã thay đổi hoặc không sẵn sàng.`);
      if (asset.kind !== 'image' && clip.sourceOutMs > asset.duration_ms + 1) throw new Error(`Media của ${slot.label} quá ngắn. Điều chỉnh mẫu; hệ thống không tự cắt lời thoại.`);
      if (slot.trackType === 'audio' ? asset.kind !== 'audio' : !['image', 'video'].includes(asset.kind)) throw new Error(`Loại media không phù hợp với ${slot.label}.`);
      dependencies.push({ assetId: asset.id, contentHash: asset.content_hash, clipId: slot.clipId, componentVersionId: componentId });
    }
    track.clips[index] = clip;
    segments.push({ role: slot.label, trackId: slot.trackId, elementId: slot.clipId, componentVersionId: componentId, timing: { inMs: clip.timelineInMs, outMs: clip.timelineOutMs }, assetId: clip.assetId || null, text: clip.text ?? null });
  }
  assertAllInvariants(document);
  const plan = { schemaVersion: 1, recipeVersionId: recipe.id, creativeVariantVersionId: creative.id, targetProfile: { resolution: document.resolution, fps: document.fps, audioRate: document.audioRate }, segments, dependencies };
  const report = { schemaVersion: 1, compiler: 'space-flow-composition-v1', planHash: digest(plan), documentHash: digest(document), inputHash: digest({ recipe: recipe.contentHash, creative: creative.contentHash, components: Object.fromEntries(Object.entries(components).sort().map(([id, c]) => [id, c.contentHash])) }), issues: [] };
  return { document, plan, report: { ...report, reportHash: digest(report) } };
}

function overrideLedger(baseline, current, plan) {
  return documentDiff(baseline, current).map(change => {
    const binding = plan.segments.find(s => change.path.startsWith(`/tracks/${s.trackId}/clips/${s.elementId}/`) || change.path === `/tracks/${s.trackId}/clips/${s.elementId}`);
    return { ...change, origin: binding || null, invalidates: binding ? [binding.elementId] : ['composition'], preservesMedia: !change.path.endsWith('/assetId') && canonicalJson(change.before?.assetId) === canonicalJson(change.after?.assetId) };
  });
}
module.exports = { compileComposition, overrideLedger };
