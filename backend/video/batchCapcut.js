const crypto = require('node:crypto');
const { digest } = require('./versionService');
const { compileBatchRow } = require('./batchCompiler');
const { batchOutputName } = require('./batchOutputName');
const busy = new Set();
const fail = (message, status = 409) => Object.assign(new Error(message), { status });

function createBatchCapcut(db, batch, deps) {
  const publicRecord = row => ({ id:row.id, status:row.status, path:row.installed_path, report:JSON.parse(row.report_json) });
  function own(owner, project) {
    const p = batch.get(owner, project);
    if (p.archived) throw fail('Khôi phục Lab trước khi chuyển sang CapCut.');
    return p;
  }
  async function prepare(owner, project, request) {
    own(owner, project);
    const { expectedRevision, inputHash, name, requestKey } = request;
    if (!Number.isSafeInteger(expectedRevision) || typeof inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(inputHash)
      || typeof name !== 'string' || !name.trim() || name.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(name)
      || typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestKey)) throw fail('Thiếu công thức hoặc tên project hợp lệ.', 400);
    const requestHash = digest({ project, expectedRevision, inputHash, name });
    const previous = db.prepare('SELECT * FROM video_batch_capcut_packages WHERE owner_id=? AND request_key=?').get(owner, requestKey);
    if (previous) {
      if (previous.request_hash !== requestHash) throw fail('Yêu cầu đã dùng cho project khác. Chuẩn bị lại.');
      return publicRecord(previous);
    }
    if (busy.has(owner)) throw fail('Đang chuyển project CapCut. Chờ tác vụ hiện tại hoàn tất.');
    busy.add(owner);
    try {
      const pre = batch.preflight(owner, project, { expectedRevision, limit:100 });
      if (pre.inputHash !== inputHash) throw fail('Công thức đã đổi. Kiểm tra lại ma trận.');
      if (pre.issues.length) throw fail(pre.issues[0].message, 422);
      const names = new Map(pre.snapshot.lists.flatMap(l => l.items).map(i => [i.id, i.name]));
      const timelines = pre.rows.map(row => ({ name:batchOutputName(row.assignments.flatMap(a => a.playlistItemIds || [a.itemId]).map(id => names.get(id))),
        document:compileBatchRow(pre.snapshot, row).document }));
      const runner = deps.runner(owner), device = await runner('delivery-info', {});
      const assets = {};
      for (const id of new Set(timelines.flatMap(t => t.document.tracks.filter(track => track.type !== 'caption').flatMap(track => track.clips.map(c => c.assetId))))) {
        if (!id) throw fail('CapCut: shape/text cần được chuẩn bị thành asset trước khi chuyển.', 422);
        const a = db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(id, owner);
        if (!a || a.status !== 'ok' || a.content_hash !== pre.snapshot.assets[id]?.content_hash) throw fail('Nguồn đã đổi hoặc không thuộc tài khoản.');
        if (deps.remote && a.source_locality !== 'server' && a.source_machine_id !== device.machineId) throw fail('Nguồn thuộc máy khác hoặc chưa có identity máy. Kết nối đúng agent/nhập lại nguồn.');
        const sourcePath = deps.remote && a.source_locality === 'server' ? await deps.transfer(a.source_path, runner) : a.source_path;
        assets[id] = { path:sourcePath, hash:a.content_hash, kind:a.kind, width:a.width, height:a.height,
          durationMs:a.duration_ms || 0, hasAudio:!!a.codec_a, name:(a.original_source_path || a.source_path).split(/[\\/]/).pop() };
      }
      const result = await runner('capcut-adapter', { operation:'prepare-batch', name, timelines, assets, sourceVersion:`${project}:${expectedRevision}:${inputHash}` });
      if (result.report?.sourceVersion !== `${project}:${expectedRevision}:${inputHash}` || result.report?.mode !== 'editable-batch') throw fail('Gói CapCut không khớp công thức.');
      const current = batch.preflight(owner, project, { expectedRevision, limit:1 });
      if (current.inputHash !== inputHash) throw fail('Nguồn thay đổi khi đang chuẩn bị. Kiểm tra lại ma trận.');
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO video_batch_capcut_packages(id,owner_id,project_id,request_key,request_hash,input_hash,machine_id,package_path,report_json) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, owner, project, requestKey, requestHash, inputHash, device.machineId, result.path, JSON.stringify(result.report));
      return publicRecord(db.prepare('SELECT * FROM video_batch_capcut_packages WHERE id=?').get(id));
    } finally { busy.delete(owner); }
  }
  async function install(owner, project, id) {
    own(owner, project);
    const record = db.prepare('SELECT * FROM video_batch_capcut_packages WHERE id=? AND owner_id=? AND project_id=?').get(id, owner, project);
    if (!record) throw fail('Không tìm thấy gói CapCut.', 404);
    if (record.status === 'installed') return publicRecord(record);
    if (busy.has(owner)) throw fail('Đang chuyển project CapCut.');
    busy.add(owner);
    try {
      const runner = deps.runner(owner), device = await runner('delivery-info', {});
      if (device.machineId !== record.machine_id) throw fail('Máy CapCut đã đổi. Kết nối đúng agent đã chuẩn bị project.');
      const result = await runner('capcut-adapter', { operation:'install', packagePath:record.package_path });
      db.prepare("UPDATE video_batch_capcut_packages SET status='installed', installed_path=? WHERE id=?").run(result.path, id);
      return publicRecord(db.prepare('SELECT * FROM video_batch_capcut_packages WHERE id=?').get(id));
    } finally { busy.delete(owner); }
  }
  function list(owner, project) {
    own(owner, project);
    return db.prepare('SELECT * FROM video_batch_capcut_packages WHERE owner_id=? AND project_id=? ORDER BY rowid DESC LIMIT 20').all(owner, project).map(publicRecord);
  }
  async function render(owner, project, id, request, polling = false) {
    own(owner, project);
    const record = db.prepare('SELECT * FROM video_batch_capcut_packages WHERE id=? AND owner_id=? AND project_id=?').get(id, owner, project);
    if (!record) throw fail('Không tìm thấy project CapCut.', 404);
    if (record.status !== 'installed') throw fail('Hoàn tất Convert vào thư mục draft trước khi render.');
    const { requestKey, timelineId, outputDir } = request;
    const timelineIds = request.timelineIds ?? [timelineId];
    if (typeof requestKey !== 'string' || !/^[a-f0-9-]{36}$/.test(requestKey)) throw fail('Mã render không hợp lệ.', 400);
    if (!polling && (!Array.isArray(timelineIds) || !timelineIds.length || timelineIds.length > 100
      || new Set(timelineIds).size !== timelineIds.length
      || !timelineIds.every(id => typeof id === 'string' && JSON.parse(record.report_json).timelines?.some(t => t.id === id))
      || typeof outputDir !== 'string' || !outputDir.trim() || outputDir.length > 2000 || /[\x00-\x1f]/.test(outputDir))) throw fail('Chọn timeline và thư mục xuất MP4.', 400);
    const runner = deps.runner(owner), device = await runner('delivery-info', {});
    if (device.machineId !== record.machine_id) throw fail('Máy CapCut đã đổi. Kết nối đúng agent đã convert project.');
    return runner('capcut-adapter', { operation:polling ? 'render-status' : 'render-start', packagePath:record.package_path,
      requestKey, ...(!polling && { ...(request.timelineIds !== undefined ? { timelineIds } : { timelineId }), outputDir }) });
  }
  return { prepare, install, list, render };
}
module.exports = { createBatchCapcut };
