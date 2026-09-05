// Workflow execution consumes a named immutable pin (ADR 0039), never the draft.
const db = require('../../backend/db');
const { buildLegacyProjection } = require('../../backend/video/timelineAdapter');
const versions = require('../../backend/routes/video-versions').service;
module.exports = async function execute(inputs, config, context) {
  const input = inputs?.timeline_collection;
  if (input != null && (input.kind !== 'TimelineCollectionRef' || typeof input.projectId !== 'string' || typeof input.versionId !== 'string')) throw new Error('Input cần TimelineCollectionRef có projectId và versionId.');
  const projectId = config?.projectId || input?.projectId;
  if (!projectId) return { timeline_collection: null };
  if (!context?.userId) throw new Error('Thiếu người dùng thực thi workflow.');
  const row = db.prepare('SELECT * FROM video_projects WHERE id = ?').get(projectId);
  if (!row) throw new Error('Project không tồn tại.');
  if (row.owner_id !== context.userId) throw new Error('Chỉ chủ sở hữu mới truy cập được project này.');
  const versionId = config?.versionId || input?.versionId;
  if (!versionId) throw new Error('Chọn bản lưu được ghim trên node trước khi chạy workflow.');
  const version = versions.get(context.userId, projectId, versionId);
  if (version.staleDependencies) throw new Error('Media của bản ghim đã thay đổi. Kiểm tra và ghim bản mới trước khi chạy.');
  const projection = buildLegacyProjection(row, { latestSeq: version.seq, previousSeq: version.seq > 0 ? version.seq - 1 : null, document: version.document });
  projection.version = { ...projection.version, id: version.id, name: version.name, documentHash: version.documentHash };
  return { timeline_collection: { kind: 'TimelineCollectionRef', projectId, versionId, ...projection, staleDraft: version.staleDocument } };
};
