function itemUsesAsset(item, assetId) {
  return item.sourceRef.assetId === assetId || item.proxy?.assetId === assetId || item.speech?.audio?.assetId === assetId
    || item.sourceRef.dependencies?.some(d => d.assetId === assetId);
}
function draftUsesProject(draft, projectId) {
  return draft.template?.projectId === projectId || draft.lists.some(l => l.items.some(i => i.preparation?.projectId === projectId || i.sourceRef.projectId === projectId));
}
function assetReference(db, ownerId, assetId) {
  if(db.prepare('SELECT id FROM video_batch_deliveries WHERE owner_id=? AND asset_id=? LIMIT 1').get(ownerId,assetId)) return 'Media còn được tham chiếu bởi receipt giao file của Lab; không thể xoá.';
  const draft = db.prepare('SELECT b.draft_json, c.name FROM video_batch_projects b JOIN video_timeline_collections c ON c.id = b.collection_id WHERE b.owner_id = ?').all(ownerId)
    .find(row => JSON.parse(row.draft_json).lists.some(l => l.items.some(i => itemUsesAsset(i, assetId))));
  if (draft) return `Media đang được dùng trong Lab “${draft.name}” — bỏ khỏi list trước khi xoá.`;
  const run = db.prepare('SELECT id, snapshot_json FROM video_batch_runs WHERE owner_id = ?').all(ownerId).find(row => !!JSON.parse(row.snapshot_json).assets[assetId]);
  return run ? `Media đang được ghim trong lịch sử batch ${run.id}; không thể xoá.` : null;
}
function projectReference(db, projectId) {
  if (db.prepare('SELECT draft_json FROM video_batch_projects').all().some(row => draftUsesProject(JSON.parse(row.draft_json), projectId))) return true;
  if (db.prepare('SELECT timeline_id FROM video_batch_run_items WHERE timeline_id = ?').get(projectId)) return true;
  return db.prepare('SELECT snapshot_json FROM video_batch_runs').all().some(row => draftUsesProject(JSON.parse(row.snapshot_json).draft, projectId));
}
module.exports = { assetReference, projectReference };
