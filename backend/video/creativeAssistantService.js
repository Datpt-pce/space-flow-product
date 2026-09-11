const crypto = require('node:crypto');
const { validateDraft, planCreative, ROLES } = require('../../shared/creative-assistant');
const { validateSpeech } = require('../../shared/video-speech');
const { digest } = require('./versionService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function createCreativeAssistantService(db, automation, deps = {}) {
  function owned(owner, id, hash) {
    const row = db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(id, owner);
    if (!row) throw fail('Không tìm thấy media trong thư viện của bạn.', 404);
    if (row.status !== 'ok' || row.content_hash !== hash) throw fail('Nguồn chưa sẵn sàng hoặc hash đã đổi. Nhập lại nguồn.', 409);
    return row;
  }
  function preflight(owner, request) {
    const draft = validateDraft(request.draft);
    const assets = {};
    for (const b of Object.values(draft.bindings)) assets[b.assetId] = owned(owner, b.assetId, b.contentHash);
    const plan = planCreative(draft, assets);
    return { ...plan, inputHash: digest({ draft, sources: Object.values(assets).map(a => ({ id: a.id, hash: a.content_hash, duration: a.duration_ms, kind: a.kind })).sort((a, b) => a.id.localeCompare(b.id)) }) };
  }
  async function materialize(owner, request) {
    const before = preflight(owner, request);
    if (!before.canCreate) throw fail(before.issues.join('\n'), 422);
    if (request.inputHash !== before.inputHash) throw fail('Kịch bản hoặc nguồn đã đổi. Lập phương án lại.', 409);
    const draft = validateDraft(request.draft);
    // File verification is outside the SQLite transaction; re-read all metadata
    // after I/O. Renderer verifies bytes again when exporting the pinned version.
    if (deps.hash) for (const b of Object.values(draft.bindings)) {
      const a = owned(owner, b.assetId, b.contentHash);
      if (await deps.hash(owner, a) !== b.contentHash) throw fail('File nguồn đã đổi trên đĩa. Nhập lại và phân tích lại.', 409);
    }
    const plan = preflight(owner, request);
    if (plan.inputHash !== before.inputHash) throw fail('Nguồn đã đổi trong khi kiểm tra.', 409);
    const result = automation.createFromDocument(owner, { idempotencyKey: request.idempotencyKey, name: draft.name,
      document: plan.document, source: { kind: 'creative-assistant', schemaVersion: 1, draft, inputHash: plan.inputHash,
        mappings: plan.mappings, speechEvidence: plan.speechEvidence } });
    return { projectId: result.projectId, versionId: result.versionId, durationMs: plan.durationMs, report: plan,
      operationId: result.operationId };
  }
  function history(owner) {
    return db.prepare(`SELECT p.id, p.name, p.created_at, r.payload_json FROM video_projects p
      JOIN video_compilations c ON c.project_id=p.id JOIN video_automation_inputs r ON r.id=c.recipe_version_id
      WHERE p.owner_id=? AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 200`).all(owner)
      .filter(r => JSON.parse(r.payload_json).source?.kind === 'creative-assistant')
      .map(({ payload_json, ...row }) => row);
  }
  async function analyze(owner, request) {
    const a = owned(owner, request.assetId, request.contentHash);
    if (!['video', 'audio'].includes(a.kind) || a.duration_ms > 600000 || !['vi', 'en'].includes(request.language)) throw fail('Chọn video/audio tối đa 10 phút và ngôn ngữ vi/en.');
    if (!deps.analyze) throw fail('Chưa có bộ nhận dạng lời nói.', 503);
    const result = await deps.analyze(owner, a, request.language, crypto.randomUUID());
    if (result.sourceHash !== a.content_hash) throw fail('Phân tích không khớp nguồn.', 409);
    owned(owner, a.id, a.content_hash);
    const speech = validateSpeech({ cues: result.cues, style: { preset: 'outline', fontSize: 36 } }, a.duration_ms);
    return { ...speech, sourceHash: a.content_hash, origin: `asr:${result.model || 'local'}`, warnings: result.warnings || [] };
  }
  async function normalize(request) {
    if (typeof request.idea !== 'string' || !request.idea.trim() || request.idea.length > 12000) throw fail('Nhập ý tưởng tối đa 12000 ký tự.');
    if (!['vi', 'en'].includes(request.language)) throw fail('Ngôn ngữ không hợp lệ.');
    if (!deps.normalize) throw fail('AI local chưa được cấu hình. Bạn có thể điền khung chuẩn trực tiếp.', 503);
    const result = await deps.normalize(request);
    if (!result || typeof result.overlayText !== 'string' || result.overlayText.length > 120) throw fail('AI trả text overlay không hợp lệ.', 422);
    for (const role of ROLES) if (!Array.isArray(result[role]) || !result[role].length || result[role].length > 20
      || result[role].some(line => typeof line !== 'string' || !line.trim() || line.length > 500)) throw fail(`AI trả lời ${role} không đúng khung.`, 422);
    return { ...Object.fromEntries(ROLES.map(role => [role, result[role]])), overlayText: result.overlayText, origin: 'ollama' };
  }
  return { preflight, materialize, history, analyze, normalize };
}
module.exports = { createCreativeAssistantService };
