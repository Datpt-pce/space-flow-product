const crypto = require('node:crypto');
const { validateSpeech } = require('../../shared/video-speech');
const { digest } = require('./versionService');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
function createBatchSpeech(db, batch, deps) {
  function source(owner, projectId, itemId) {
    const project = batch.get(owner, projectId);
    if (project.archived) throw fail('Khôi phục Lab trước khi xử lý voice/captions.');
    const item = project.draft.lists.flatMap(l => l.items).find(i => i.id === itemId);
    if (!item) throw fail('Không tìm thấy nguồn.', 404);
    if (project.media[item.id]?.status !== 'ok' || project.media[item.id]?.preparationPending) throw fail('Nhận chỉnh sửa và kiểm tra nguồn trước khi xử lý voice/captions.', 422);
    if (item.sourceRef.kind === 'timeline-version' && !project.media[item.id]?.proxyReady) throw fail('Tạo proxy theo cấu hình hiện tại trước khi phân tích prepared.', 422);
    const id = item.proxy?.assetId || (item.sourceRef.kind === 'media' && item.sourceRef.assetId);
    const asset = db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(id || '', owner);
    if (!asset || !['audio', 'video'].includes(asset.kind) || asset.status !== 'ok') throw fail('Chọn video/audio sẵn sàng. Công thức prepared cần tạo proxy trước.', 422);
    if (asset.content_hash !== (item.proxy?.contentHash || item.sourceRef.contentHash)) throw fail('Nguồn đã đổi. Nhập lại nguồn.');
    if (asset.duration_ms > 3600000) throw fail('Mỗi nguồn voice/captions tối đa 60 phút.', 422);
    return { project, item, asset };
  }
  async function localPath(asset, runner, device) {
    if (deps.remote && asset.source_locality !== 'server' && asset.source_machine_id !== device.machineId) throw fail('Nguồn thuộc máy khác. Kết nối agent chứa nguồn.');
    return deps.remote && asset.source_locality === 'server' ? deps.transfer(asset.source_path, runner) : asset.source_path;
  }
  async function start(owner, projectId, request) {
    const { project, asset } = source(owner, projectId, request.itemId);
    if (project.revision !== request.expectedRevision) throw fail('Lab đã thay đổi. Lưu và tải lại trước khi xử lý.');
    if (!['analyze', 'convert'].includes(request.task) || !['auto', 'vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id'].includes(request.language || 'auto')) throw fail('Tác vụ/ngôn ngữ không hợp lệ.', 400);
    const runner = deps.runner(owner), device = await runner('delivery-info', {});
    const input = { task:request.task, sourceHash:asset.content_hash, language:request.language || 'auto' };
    const payload = { ...input, path:await localPath(asset, runner, device), durationMs:asset.duration_ms };
    if (request.task === 'convert') {
      input.speech = validateSpeech(request.speech, asset.duration_ms);
      if (!input.speech.cues.some(c => c.action === 'convert')) throw fail('Chọn ít nhất một đoạn cần đổi giọng.', 400);
      const reference = db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(request.referenceAssetId, owner);
      if (!reference || !['audio', 'video'].includes(reference.kind) || reference.status !== 'ok') throw fail('Chọn giọng mẫu từ media của bạn.', 400);
      const referenceStartMs = request.referenceStartMs ?? 0, referenceEndMs = request.referenceEndMs ?? Math.min(reference.duration_ms, 15000);
      if (!Number.isFinite(referenceStartMs) || !Number.isFinite(referenceEndMs) || referenceStartMs < 0 || referenceEndMs > reference.duration_ms + 1
        || referenceEndMs - referenceStartMs < 3000 || referenceEndMs - referenceStartMs > 30000) throw fail('Giọng mẫu cần một đoạn rõ lời từ 3 đến 30 giây.', 400);
      Object.assign(input, { referenceAssetId:reference.id, referenceHash:reference.content_hash, referenceStartMs, referenceEndMs });
      Object.assign(payload, { ...input, referencePath:await localPath(reference, runner, device) });
    }
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO video_batch_speech_jobs(id,owner_id,project_id,item_id,machine_id,source_hash,request_json) VALUES (?,?,?,?,?,?,?)')
      .run(id, owner, projectId, request.itemId, device.machineId, asset.content_hash, JSON.stringify(input));
    try { return await runner('speech', { ...payload, id, operation:'start' }); }
    catch (error) {
      db.prepare('UPDATE video_batch_speech_jobs SET result_json=? WHERE id=?').run(JSON.stringify({ id, status:'failed', error:error.message }), id);
      throw error;
    }
  }
  function own(owner, projectId, id) {
    const record = db.prepare('SELECT * FROM video_batch_speech_jobs WHERE id=? AND owner_id=? AND project_id=?').get(id, owner, projectId);
    if (!record) throw fail('Không tìm thấy tác vụ.', 404);
    batch.get(owner, projectId);
    return record;
  }
  async function status(owner, projectId, id, cancel = false) {
    const record = own(owner, projectId, id);
    const input = JSON.parse(record.request_json);
    const receipt = result => ({ ...result, task:input.task, ...(input.speech && { speech:input.speech, referenceAssetId:input.referenceAssetId }) });
    if (record.result_json) return receipt(JSON.parse(record.result_json));
    const runner = deps.runner(owner), device = await runner('delivery-info', {});
    if (device.machineId !== record.machine_id) throw fail('Kết nối đúng agent đã chạy voice/captions.');
    const result = await runner('speech', { id, operation:cancel ? 'cancel' : 'status' });
    if (['completed', 'failed', 'cancelled'].includes(result.status)) db.prepare('UPDATE video_batch_speech_jobs SET result_json=? WHERE id=?').run(JSON.stringify(result), id);
    return receipt(result);
  }
  function list(owner, projectId, itemId) {
    const { asset } = source(owner, projectId, itemId);
    return db.prepare('SELECT id,request_json,result_json,created_at FROM video_batch_speech_jobs WHERE owner_id=? AND project_id=? AND item_id=? AND source_hash=? ORDER BY rowid DESC LIMIT 10')
      .all(owner, projectId, itemId, asset.content_hash).map(r => {
        const input = JSON.parse(r.request_json);
        return { id:r.id, task:input.task, createdAt:r.created_at, ...(input.speech && { speech:input.speech, referenceAssetId:input.referenceAssetId }),
          ...(r.result_json ? JSON.parse(r.result_json) : { status:'running' }) };
      });
  }
  async function apply(owner, projectId, request) {
    const { asset } = source(owner, projectId, request.itemId);
    if (request.sourceHash !== asset.content_hash) throw fail('Nguồn đã đổi sau phân tích. Mở lại Voice & captions.');
    let audio;
    if (request.conversionJobId) {
      const record = own(owner, projectId, request.conversionJobId), input = JSON.parse(record.request_json);
      const result = await status(owner, projectId, record.id);
      // Formatting may split cues. Bind audio to the same contiguous converted
      // windows the worker uses, independent of subtitle IDs/keep-only edits.
      const regions = speech => {
        const result=[];
        for(const cue of speech.cues) if(cue.action === 'convert') {
          if(result.length && Math.abs(result.at(-1)[1]-cue.startMs)<.01) result.at(-1)[1]=cue.endMs;
          else result.push([cue.startMs,cue.endMs]);
        }
        return result;
      };
      if (record.item_id !== request.itemId || record.source_hash !== asset.content_hash || input.task !== 'convert' || result.status !== 'completed'
        || digest(regions(input.speech)) !== digest(regions(validateSpeech(request.speech, asset.duration_ms)))) throw fail('Đoạn voice đã đổi. Chạy đổi giọng lại trước khi áp dụng.');
      const runner = deps.runner(owner), device = await runner('delivery-info', {});
      if (device.machineId !== record.machine_id) throw fail('Kết nối đúng agent đã đổi giọng.');
      const imported = await deps.importAsset(owner, result.outputPath, runner);
      if (imported.content_hash !== result.outputHash) throw fail('Audio kết quả đã đổi trên đĩa.');
      audio = { assetId:imported.id, contentHash:imported.content_hash };
    } else if (request.speech?.cues.some(c => c.action === 'convert')) throw fail('Đổi giọng xong trước khi áp dụng, hoặc đặt các đoạn về Giữ nguyên.');
    return batch.applySpeech(owner, projectId, { ...request, audio, sourceHash:asset.content_hash });
  }
  return { start, status, list, apply };
}
module.exports = { createBatchSpeech };
