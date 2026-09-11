const fs = require('node:fs');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function createBatchManagement(db, batch) {
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function selection(ownerId, id, runId, indexes) {
    const run = batch.getRun(ownerId, id, runId, { limit: 100 });
    if (!Array.isArray(indexes) || !indexes.length || indexes.length > 100 || new Set(indexes).size !== indexes.length) throw fail('Chọn 1–100 timeline khác nhau.');
    return indexes.map(index => {
      const item = Number.isSafeInteger(index) && run.items.find(i => i.rowIndex === index);
      if (!item) throw fail('Timeline không thuộc lần tạo đã chọn.', 404);
      return item;
    });
  }
  function assertIdle(timelineId) {
    if (db.prepare("SELECT id FROM video_render_jobs WHERE project_id=? AND status IN ('queued','running') LIMIT 1").get(timelineId)) throw fail('Chờ render hoàn tất hoặc hủy job trước khi xóa.', 409);
    if (db.prepare(`SELECT d.id FROM video_batch_deliveries d JOIN video_batch_run_items i ON i.run_id=d.run_id AND i.row_index=d.row_index
      WHERE i.timeline_id=? AND d.state<>'done' LIMIT 1`).get(timelineId)) throw fail('Hoàn tất giao file đang dang dở trước khi xóa.', 409);
  }
  function archiveOutputs(ownerId, id, runId, { rowIndexes, restore = false }) {
    if (typeof restore !== 'boolean') throw fail('Thao tác khôi phục không hợp lệ.');
    return transaction(() => {
      if (batch.get(ownerId, id).archived) throw fail('Khôi phục project Lab trước.', 409);
      const items = selection(ownerId, id, runId, rowIndexes);
      if (!restore) items.forEach(item => assertIdle(item.timelineId));
      for (const item of items) db.prepare(`UPDATE video_projects SET archived_at=${restore ? 'NULL' : "datetime('now')"} WHERE id=? AND owner_id=?`).run(item.timelineId, ownerId);
      return batch.getRun(ownerId, id, runId, { limit: 100 });
    });
  }
  function trash(ownerId) {
    const outputs = db.prepare(`SELECT p.id, p.name, b.id AS projectId, c.name AS projectName, i.run_id AS runId, i.row_index AS rowIndex
      FROM video_batch_run_items i JOIN video_projects p ON p.id=i.timeline_id
      JOIN video_batch_runs r ON r.id=i.run_id JOIN video_batch_projects b ON b.id=r.project_id
      JOIN video_timeline_collections c ON c.id=b.collection_id
      WHERE b.owner_id=? AND p.owner_id=? AND c.archived_at IS NULL AND p.archived_at IS NOT NULL ORDER BY p.archived_at DESC`).all(ownerId, ownerId);
    return { projects: batch.list(ownerId, true), outputs };
  }
  function restoreProjects(ownerId, records) {
    validateRecords(records);
    return transaction(() => {
      for (const record of records) {
        const project = batch.get(ownerId, record.id);
        if (!project.archived || project.revision !== record.revision) throw fail('Thùng rác đã đổi. Tải lại trước khi khôi phục.', 409);
      }
      return records.map(record => batch.archiveWithinTransaction(ownerId, record.id, { expectedRevision: record.revision, restore: true }));
    });
  }
  function validateRecords(records) {
    if (!Array.isArray(records) || !records.length || records.length > 100 || records.some(r => !r || typeof r.id !== 'string' || !Number.isSafeInteger(r.revision)) || new Set(records.map(r => r.id)).size !== records.length) throw fail('Chọn 1–100 project hợp lệ.');
  }
  function purgeProjects(ownerId, records) {
    validateRecords(records);
    return transaction(() => {
      const groups = records.map(record => {
        const project = batch.get(ownerId, record.id);
        if (!project.archived || project.revision !== record.revision) throw fail('Project phải ở thùng rác và đúng bản đã xem trước khi xóa vĩnh viễn.', 409);
        const members = db.prepare('SELECT id, owner_id, archived_at FROM video_projects WHERE collection_id=?').all(project.collectionId);
        if (members.some(p => p.owner_id !== ownerId || !p.archived_at)) throw fail('Project còn timeline đang hoạt động hoặc của người khác. Không thể xóa.', 409);
        members.forEach(p => assertIdle(p.id));
        return { project, members };
      });
      // Removing this selection's own references is part of the same transaction;
      // an external pin/compound guard below rolls all of it back on rejection.
      for (const { project } of groups) {
        db.prepare('DELETE FROM video_batch_deliveries WHERE run_id IN (SELECT id FROM video_batch_runs WHERE project_id=?)').run(project.id);
        db.prepare('DELETE FROM video_batch_run_items WHERE run_id IN (SELECT id FROM video_batch_runs WHERE project_id=?)').run(project.id);
        db.prepare('DELETE FROM video_batch_runs WHERE project_id=?').run(project.id);
        db.prepare('DELETE FROM video_batch_projects WHERE id=?').run(project.id);
      }
      const deleting = new Set(groups.flatMap(g => g.members.map(p => p.id)));
      const externalDocuments = [
        ...db.prepare('SELECT project_id, payload AS json FROM video_project_snapshots').all(),
        ...db.prepare('SELECT project_id, args_json AS json FROM video_project_commands').all(),
      ].filter(row => !deleting.has(row.project_id));
      for (const id of deleting) {
        if (require('./batchReferences').projectReference(db, id) || externalDocuments.some(row => row.json.includes(JSON.stringify(id)))) throw fail('Timeline còn được tham chiếu bởi Lab hoặc lịch sử timeline khác. Giữ project trong thùng rác.', 409);
      }
      for (const { project, members } of groups) {
        for (const member of members) db.prepare('DELETE FROM video_projects WHERE id=? AND owner_id=?').run(member.id, ownerId);
        db.prepare('UPDATE video_bulk_import_operations SET collection_id=NULL WHERE collection_id=?').run(project.collectionId);
        db.prepare('DELETE FROM video_timeline_collections WHERE id=? AND owner_id=?').run(project.collectionId, ownerId);
      }
      return { deletedProjectIds: records.map(r => r.id), deletedTimelineIds: [...deleting] };
    });
  }
  function downloadFiles(ownerId, id, runId, rowIndexes) {
    const usedNames = new Set();
    return selection(ownerId, id, runId, rowIndexes).map(item => {
      const jobId = item.jobs.at(-1)?.jobId;
      const job = jobId && db.prepare('SELECT * FROM video_render_jobs WHERE id=? AND owner_id=? AND project_id=?').get(jobId, ownerId, item.timelineId);
      if (item.archived || job?.status !== 'done' || !job.manifest_json || !job.output_path) throw fail(`Timeline #${item.rowIndex + 1} chưa có bản render đã xác minh.`, 409);
      if (!fs.existsSync(job.output_path)) throw fail(`File của timeline #${item.rowIndex + 1} không còn. Xuất lại trước khi tải.`, 404);
      const stem = require('./batchOutputName').batchOutputName([item.name]);
      let name = `${stem}.mp4`, suffix = 2;
      while (usedNames.has(name.toLowerCase())) name = `${stem}_${suffix++}.mp4`;
      usedNames.add(name.toLowerCase());
      return { path: job.output_path, name };
    });
  }
  return { archiveOutputs, trash, restoreProjects, purgeProjects, downloadFiles };
}
module.exports = { createBatchManagement };
