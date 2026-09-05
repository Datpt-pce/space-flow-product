const crypto = require('node:crypto');
const { canonicalJson, documentDiff } = require('../../shared/video-document-diff');
const digest = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function createVersionService(db, { recoverProjectState, getLatestCommandSeq }) {
  function own(ownerId, projectId) {
    const row = db.prepare('SELECT * FROM video_projects WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(projectId, ownerId);
    if (!row) throw error('Không tìm thấy timeline đang hoạt động.', 404);
    return row;
  }
  function dependencies(ownerId, state) {
    const ids = [...new Set(state.tracks.flatMap(t => t.clips.map(c => c.assetId).filter(Boolean)))].sort();
    return ids.map(id => {
      const row = db.prepare('SELECT content_hash, status, rights_json FROM video_assets WHERE id = ? AND owner_id = ?').get(id, ownerId);
      return { assetId: id, contentHash: row?.content_hash || null, status: row?.status || 'missing', rights: row?.rights_json ? JSON.parse(row.rights_json) : {} };
    });
  }
  function qc(state, deps) {
    const issues = require('./renderQc').renderCapabilityIssues(state);
    if (!state.tracks.some(t => t.type === 'video' && t.visible && t.clips.length)) issues.push({ severity: 'error', path: '/tracks', message: 'Chưa có video hiển thị để xuất.' });
    for (const track of state.tracks) for (const clip of track.clips) {
      const dep = deps.find(d => d.assetId === clip.assetId);
      const path = `/tracks/${track.id}/clips/${clip.id}`;
      if (dep && dep.status !== 'ok') issues.push({ severity: 'error', path, timeMs: clip.timelineInMs, message: `Media chưa sẵn sàng: ${dep.status}` });
      if (dep?.rights.expiresAt && Date.parse(dep.rights.expiresAt) <= Date.now()) issues.push({ severity: 'error', path, timeMs: clip.timelineInMs, message: 'Quyền sử dụng media đã hết hạn.' });
    }
    return issues;
  }
  function get(ownerId, projectId, versionId) {
    own(ownerId, projectId);
    const row = db.prepare('SELECT * FROM video_named_versions WHERE id = ? AND project_id = ?').get(versionId, projectId);
    if (!row) throw error('Không tìm thấy bản lưu.', 404);
    const document = recoverProjectState(projectId, row.seq);
    if (digest(document) !== row.document_hash) throw error('Lịch sử của bản lưu không khớp hash; không sử dụng bản này.', 409);
    const deps = dependencies(ownerId, document);
    const currentSeq = getLatestCommandSeq(projectId);
    const staleDocument = currentSeq !== row.seq;
    const staleDependencies = canonicalJson(deps) !== canonicalJson(JSON.parse(row.dependencies_json));
    const decisions = db.prepare('SELECT id, decision, note, reviewer_id, created_at FROM video_review_decisions WHERE version_id = ? ORDER BY rowid DESC').all(versionId);
    const compilation = db.prepare('SELECT creative_version_id, recipe_version_id, report_json FROM video_compilations WHERE project_id = ?').get(projectId);
    return { id: row.id, projectId, seq: row.seq, name: row.name, documentHash: row.document_hash, createdAt: row.created_at,
      document, dependencies: deps, staleDocument, staleDependencies, issues: qc(document, deps),
      origin: compilation ? { recipeVersionId: compilation.recipe_version_id, creativeVariantVersionId: compilation.creative_version_id, compileReport: JSON.parse(compilation.report_json), editedSeq: row.seq } : null,
      decisions: decisions.map(d => ({ ...d, stale: staleDocument || staleDependencies })) };
  }
  function create(ownerId, projectId, { name, baseRevision }) {
    own(ownerId, projectId);
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw error('Tên bản lưu cần có 1–120 ký tự.');
    const seq = getLatestCommandSeq(projectId);
    if (!Number.isSafeInteger(baseRevision) || baseRevision !== seq) throw error('Timeline đã thay đổi. Đồng bộ trước khi lưu phiên bản.', 409);
    const document = recoverProjectState(projectId, seq);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO video_named_versions(id, project_id, seq, name, document_hash, dependencies_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, projectId, seq, name.trim(), digest(document), JSON.stringify(dependencies(ownerId, document)));
    return get(ownerId, projectId, id);
  }
  function list(ownerId, projectId) {
    own(ownerId, projectId);
    return db.prepare('SELECT id FROM video_named_versions WHERE project_id = ? ORDER BY rowid DESC').all(projectId).map(r => {
      const { document, ...summary } = get(ownerId, projectId, r.id); return summary;
    });
  }
  function review(ownerId, projectId, versionId, { decision, note = '' }) {
    const version = get(ownerId, projectId, versionId);
    if (!['approved', 'changes_requested'].includes(decision) || typeof note !== 'string' || note.length > 4000) throw error('Quyết định duyệt không hợp lệ.');
    if (decision === 'approved' && (version.staleDocument || version.staleDependencies || version.issues.some(i => i.severity === 'error'))) throw error('Bản lưu đã cũ hoặc có lỗi QC. Tạo bản mới và xử lý lỗi trước khi duyệt.', 409);
    db.prepare('INSERT INTO video_review_decisions(id, version_id, reviewer_id, decision, note) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), versionId, ownerId, decision, note.trim());
    return get(ownerId, projectId, versionId);
  }
  function compare(ownerId, projectId, versionId, otherId) {
    const left = get(ownerId, projectId, versionId);
    const right = otherId ? get(ownerId, projectId, otherId).document : recoverProjectState(projectId);
    return { changes: documentDiff(left.document, right) };
  }
  return { create, get, list, review, compare, dependencies, qc };
}
module.exports = { createVersionService, digest };
