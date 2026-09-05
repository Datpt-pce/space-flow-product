const crypto = require('node:crypto');
const { canonicalJson } = require('../../shared/video-document-diff');
const { cloneState, getAtPath } = require('../../shared/video-commands/state');
const { runCommand } = require('../../shared/video-commands');
const { digest } = require('./versionService');
const { compileComposition, overrideLedger } = require('./compositionCompiler');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const validName = name => typeof name === 'string' && name.trim() && name.length <= 120;

function createAutomationService(db, projects, versions) {
  function own(ownerId, projectId) {
    const row = db.prepare('SELECT id, name FROM video_projects WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(projectId, ownerId);
    if (!row) throw fail('Không tìm thấy timeline đang hoạt động.', 404);
    return row;
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function input(ownerId, id, kind) {
    const row = db.prepare('SELECT * FROM video_automation_inputs WHERE id = ? AND owner_id = ? AND kind = ?').get(id, ownerId, kind);
    if (!row) throw fail('Không tìm thấy phiên bản nguồn.', 404);
    const payload = JSON.parse(row.payload_json);
    if (digest(payload) !== row.content_hash) throw fail('Hash phiên bản nguồn không khớp.', 409);
    return { id: row.id, name: row.name, parentId: row.parent_id, kind, payload, contentHash: row.content_hash };
  }
  function saveInput(ownerId, kind, name, payload, parentId = null) {
    if (!validName(name)) throw fail('Tên cần có 1–120 ký tự.');
    if (parentId) input(ownerId, parentId, kind);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO video_automation_inputs(id, owner_id, kind, parent_id, name, payload_json, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ownerId, kind, parentId, name.trim(), canonicalJson(payload), digest(payload));
    return input(ownerId, id, kind);
  }
  function asset(ownerId, id) {
    const row = db.prepare('SELECT id, content_hash, duration_ms, kind, status FROM video_assets WHERE id = ? AND owner_id = ?').get(id, ownerId);
    if (!row || row.status !== 'ok' || !row.content_hash) throw fail('Media không thuộc thư viện của bạn hoặc chưa sẵn sàng.');
    return row;
  }
  function recipe(ownerId, { projectId, versionId, name, parentId }) {
    const pin = versions.get(ownerId, projectId, versionId);
    if (pin.staleDependencies) throw fail('Media của bản lưu đã thay đổi. Lưu bản mới trước khi tạo mẫu.', 409);
    const slots = pin.document.tracks.flatMap(t => t.clips.map((c, i) => ({ clipId: c.id, trackId: t.id, trackType: t.type, label: `${t.name || t.type} ${i + 1}` })));
    if (!slots.length) throw fail('Mẫu cần có ít nhất một clip.');
    if (slots.some(s => /[/~]/.test(s.clipId + s.trackId))) throw fail('ID clip/track không hợp lệ để tạo liên kết nguồn.');
    return saveInput(ownerId, 'recipe', name, { schemaVersion: 1, source: { projectId, versionId, seq: pin.seq, documentHash: pin.documentHash }, document: pin.document, dependencies: pin.dependencies, slots }, parentId);
  }
  function listRecipes(ownerId) {
    return db.prepare("SELECT id FROM video_automation_inputs WHERE owner_id = ? AND kind = 'recipe' ORDER BY rowid DESC").all(ownerId).map(r => input(ownerId, r.id, 'recipe'));
  }
  function createRecipe(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => recipe(ownerId, request));
  }
  function buildVariant(ownerId, recipeId, name, assignments = [], previous) {
    const template = input(ownerId, recipeId, 'recipe');
    if (!Array.isArray(assignments) || assignments.length > template.payload.slots.length || new Set(assignments.map(a => a.clipId)).size !== assignments.length) throw fail('Danh sách thay thế không hợp lệ.');
    if (assignments.some(a => !template.payload.slots.some(s => s.clipId === a.clipId) || Object.keys(a).some(k => !['clipId', 'assetId', 'text'].includes(k)))) throw fail('Vị trí hoặc trường thay thế không hợp lệ.');
    const components = {};
    for (const slot of template.payload.slots) {
      const previousComponent = previous && input(ownerId, previous.payload.components[slot.clipId], 'component');
      const clip = cloneState(previousComponent?.payload.clip || template.payload.document.tracks.find(t => t.id === slot.trackId).clips.find(c => c.id === slot.clipId));
      const assignment = assignments.find(a => a.clipId === slot.clipId);
      if (assignment?.assetId !== undefined) {
        if (!clip.assetId || typeof assignment.assetId !== 'string') throw fail('Vị trí này không nhận thay thế media.');
        clip.assetId = assignment.assetId;
        // A replacement is ordinary media, no longer the old compound pin.
        if (clip.assetId !== previousComponent?.payload.clip.assetId) delete clip.compoundRef;
      }
      if (assignment?.text !== undefined) {
        if (slot.trackType !== 'caption' || typeof assignment.text !== 'string' || !assignment.text.trim() || assignment.text.length > 10000) throw fail('Nội dung phụ đề cần có 1–10000 ký tự.');
        clip.text = assignment.text;
      }
      if (previousComponent && canonicalJson(clip) === canonicalJson(previousComponent.payload.clip)) { components[slot.clipId] = previousComponent.id; continue; }
      const media = clip.assetId ? asset(ownerId, clip.assetId) : null;
      const pinnedHash = previousComponent?.payload.assetHash || template.payload.dependencies.find(d => d.assetId === clip.assetId)?.contentHash;
      if (media && assignment?.assetId === undefined && media.content_hash !== pinnedHash) throw fail('Media nguồn của mẫu đã thay đổi. Chọn media thay thế hoặc tạo mẫu mới.', 409);
      components[slot.clipId] = saveInput(ownerId, 'component', slot.label.slice(0, 120), { schemaVersion: 1, trackType: slot.trackType, clip, assetHash: media?.content_hash || null, source: { recipeVersionId: recipeId, elementId: slot.clipId } }, previousComponent?.id).id;
    }
    return saveInput(ownerId, 'creative-variant', name, { schemaVersion: 1, recipeVersionId: recipeId, components }, previous?.id);
  }
  function compile(ownerId, creativeId) {
    const creative = input(ownerId, creativeId, 'creative-variant');
    const template = input(ownerId, creative.payload.recipeVersionId, 'recipe');
    const components = {}, assets = {};
    for (const id of Object.values(creative.payload.components)) {
      const component = input(ownerId, id, 'component'); components[id] = component;
      if (component.payload.clip.assetId) assets[component.payload.clip.assetId] = asset(ownerId, component.payload.clip.assetId);
    }
    return compileComposition(template, creative, components, assets);
  }
  function materialize(ownerId, creativeId, name) {
    if (!validName(name)) throw fail('Tên timeline cần có 1–120 ký tự.');
    const compiled = compile(ownerId, creativeId), id = crypto.randomUUID();
    const payload = canonicalJson(compiled.document);
    db.prepare('INSERT INTO video_projects(id, owner_id, name, payload) VALUES (?, ?, ?, ?)').run(id, ownerId, name.trim(), payload);
    db.prepare('INSERT INTO video_project_snapshots(id, project_id, seq, payload) VALUES (?, ?, 0, ?)').run(crypto.randomUUID(), id, payload);
    db.prepare('INSERT INTO video_compilations(project_id, creative_version_id, recipe_version_id, plan_json, report_json, document_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, creativeId, compiled.plan.recipeVersionId, canonicalJson(compiled.plan), canonicalJson(compiled.report), compiled.report.documentHash);
    const pin = versions.create(ownerId, id, { name: 'Bản tự động', baseRevision: 0 });
    return { projectId: id, versionId: pin.id, creativeVersionId: creativeId, ...compiled };
  }
  function operation(ownerId, key, request, fn) {
    if (typeof key !== 'string' || !key.trim() || key.length > 200) throw fail('Cần mã yêu cầu để chống tạo trùng.');
    return transaction(() => {
      const previous = db.prepare('SELECT request_hash, result_json FROM video_automation_operations WHERE owner_id = ? AND idempotency_key = ?').get(ownerId, key);
      const requestHash = digest(request);
      if (previous) {
        if (requestHash !== previous.request_hash) throw fail('Mã yêu cầu đã được dùng cho nội dung khác.', 409);
        return JSON.parse(previous.result_json);
      }
      const result = { ...fn(), operationId: crypto.randomUUID() };
      db.prepare('INSERT INTO video_automation_operations(id, owner_id, idempotency_key, request_hash, result_json) VALUES (?, ?, ?, ?, ?)')
        .run(result.operationId, ownerId, key, requestHash, canonicalJson(result));
      return result;
    });
  }
  function createVariant(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => {
      const creative = buildVariant(ownerId, request.recipeId, request.name, request.assignments);
      return materialize(ownerId, creative.id, request.name);
    });
  }
  function materializeVersion(ownerId, request) {
    // Validate the pinned inputs even on a repeated workflow run: changing source
    // media must not reuse a prior compilation as though its dependencies were intact.
    compile(ownerId, request.creativeVersionId);
    return operation(ownerId, request.idempotencyKey, request, () => materialize(ownerId, request.creativeVersionId, request.name));
  }
  function context(ownerId, projectId, uptoSeq) {
    const project = own(ownerId, projectId);
    const binding = db.prepare('SELECT * FROM video_compilations WHERE project_id = ?').get(projectId);
    if (!binding) return { projectId, compiled: false };
    const baseline = projects.recoverProjectState(projectId, 0);
    if (digest(baseline) !== binding.document_hash) throw fail('Bản tự động không khớp hash.', 409);
    const seq = uptoSeq ?? projects.getLatestCommandSeq(projectId);
    const current = projects.recoverProjectState(projectId, seq);
    const plan = JSON.parse(binding.plan_json);
    const ledger = overrideLedger(baseline, current, plan);
    const siblings = db.prepare('SELECT p.id, p.name FROM video_compilations c JOIN video_projects p ON p.id = c.project_id WHERE c.recipe_version_id = ? AND p.owner_id = ? AND p.archived_at IS NULL AND p.id != ?').all(binding.recipe_version_id, ownerId, projectId);
    return { projectId, name: project.name, compiled: true, seq, recipeVersionId: binding.recipe_version_id, recipeName: input(ownerId, binding.recipe_version_id, 'recipe').name, creativeVersionId: binding.creative_version_id, creativeName: input(ownerId, binding.creative_version_id, 'creative-variant').name, baseline, plan, report: JSON.parse(binding.report_json), ledger, siblings };
  }
  function reset(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => {
      const ctx = context(ownerId, request.projectId);
      if (!ctx.compiled || ctx.seq !== request.baseRevision) throw fail('Timeline đã thay đổi. Xem lại trước khi khôi phục.', 409);
      const args = { from: projects.recoverProjectState(request.projectId), to: ctx.baseline };
      const result = projects.applyCommand(request.projectId, { type: 'ResetCompositionOverrides', args, baseRevision: ctx.seq, idempotencyKey: request.idempotencyKey });
      return { projectId: request.projectId, seq: result.seq, command: { type: 'ResetCompositionOverrides', args } };
    });
  }
  function preview(ownerId, { projectId, paths, targetIds }) {
    const source = context(ownerId, projectId);
    if (!source.compiled || !Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length || !Array.isArray(targetIds) || !targetIds.length || targetIds.length > 100 || new Set(targetIds).size !== targetIds.length || targetIds.includes(projectId)) throw fail('Chọn thay đổi và timeline đích khác nhau.');
    const changes = paths.map(path => source.ledger.find(c => c.path === path));
    if (changes.some(c => !c?.origin || c.kind === 'removed' || (c.after !== null && typeof c.after === 'object') || /\/(id|compoundRef)(\/|$)/.test(c.path))) throw fail('Chỉ áp dụng trường của clip đang có liên kết nguồn. Thay đổi cấu trúc cần tạo phiên bản mẫu mới.');
    const targets = targetIds.map(id => {
      const target = context(ownerId, id);
      if (!target.compiled || target.recipeVersionId !== source.recipeVersionId) throw fail('Timeline đích không cùng phiên bản mẫu.', 409);
      const state = projects.recoverProjectState(id), edits = [], conflicts = [];
      for (const change of changes) {
        const trackId = change.origin.trackId, clipId = change.origin.elementId;
        const trackIndex = state.tracks.findIndex(t => t.id === trackId);
        const clipIndex = state.tracks[trackIndex]?.clips.findIndex(c => c.id === clipId) ?? -1;
        const tail = change.path.slice(`/tracks/${trackId}/clips/${clipId}/`.length).split('/');
        const baseClip = target.baseline.tracks.find(t => t.id === trackId)?.clips.find(c => c.id === clipId);
        const actual = state.tracks[trackIndex]?.clips[clipIndex];
        if (trackIndex < 0 || clipIndex < 0 || tail.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) { conflicts.push(change.path); continue; }
        const from = getAtPath(actual, tail), baselineValue = getAtPath(baseClip, tail);
        if (canonicalJson(from) !== canonicalJson(baselineValue) && canonicalJson(from) !== canonicalJson(change.after)) { conflicts.push(change.path); continue; }
        if (canonicalJson(from) !== canonicalJson(change.after)) edits.push({ path: ['tracks', trackIndex, 'clips', clipIndex, ...tail], from, to: change.after });
      }
      if (!conflicts.length) {
        try {
          const next = edits.length ? runCommand(state, 'SetProperties', { changes: edits }) : state;
          // Replacement media is validated against each target's own source window.
          for (const track of next.tracks) for (const clip of track.clips) if (clip.assetId) {
            const media = asset(ownerId, clip.assetId);
            if (media.kind !== 'image' && clip.sourceOutMs > media.duration_ms + 1) throw fail('Media thay thế quá ngắn.');
            if (track.type === 'audio' ? media.kind !== 'audio' : !['video', 'image'].includes(media.kind)) throw fail('Loại media thay thế không phù hợp với track.');
            const prior = state.tracks.find(t => t.id === track.id)?.clips.find(c => c.id === clip.id);
            if (prior?.compoundRef && prior.assetId !== clip.assetId) throw fail('Thay media của clip lồng cần tạo phiên bản component mới để giữ nguồn gốc.');
          }
        } catch (e) { conflicts.push(e.message); }
      }
      return { projectId: id, name: target.name, seq: target.seq, edits, conflicts };
    });
    const impact = { source: { projectId, seq: source.seq }, paths, targets, canApply: targets.every(t => !t.conflicts.length) };
    return { ...impact, impactHash: digest(impact) };
  }
  function applySiblings(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => {
      const impact = preview(ownerId, request);
      if (!impact.canApply || impact.impactHash !== request.impactHash) throw fail('Tác động đã thay đổi hoặc có xung đột. Xem lại trước khi áp dụng.', 409);
      const results = impact.targets.map(target => {
        if (!target.edits.length) return { projectId: target.projectId, seq: target.seq };
        const args = { changes: target.edits };
        const result = projects.applyCommand(target.projectId, { type: 'SetProperties', args, baseRevision: target.seq, idempotencyKey: request.idempotencyKey });
        return { projectId: target.projectId, seq: result.seq, command: { type: 'SetProperties', args } };
      });
      return { results, impact };
    });
  }
  function undoOperation(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => {
      const row = db.prepare('SELECT result_json FROM video_automation_operations WHERE id = ? AND owner_id = ?').get(request.operationId, ownerId);
      if (!row) throw fail('Không tìm thấy thao tác.', 404);
      const original = JSON.parse(row.result_json);
      const targets = original.results || (original.command ? [original] : []);
      if (!targets.length) throw fail('Thao tác này không có chỉnh sửa để hoàn tác.');
      for (const target of targets) {
        own(ownerId, target.projectId);
        if (projects.getLatestCommandSeq(target.projectId) !== target.seq) throw fail('Có timeline đã đổi sau thao tác. Không hoàn tác hàng loạt trên bản mới.', 409);
      }
      const results = targets.filter(t => t.command).map(target => {
        const args = { originalType: target.command.type, originalArgs: target.command.args };
        const next = projects.applyCommand(target.projectId, { type: 'Undo', args, baseRevision: target.seq, idempotencyKey: request.idempotencyKey });
        return { projectId: target.projectId, seq: next.seq };
      });
      return { results };
    });
  }
  // Component-scope changes fork immutable inputs and a new composition. The
  // existing timeline/reviews remain pinned to their original inputs.
  function promoteComponent(ownerId, request) {
    return operation(ownerId, request.idempotencyKey, request, () => {
      const ctx = context(ownerId, request.projectId);
      if (!ctx.compiled || ctx.seq !== request.baseRevision) throw fail('Timeline đã thay đổi.', 409);
      const segment = ctx.plan.segments.find(s => s.elementId === request.clipId);
      if (!segment) throw fail('Clip không có liên kết component.');
      const current = projects.recoverProjectState(request.projectId);
      const track = current.tracks.find(t => t.id === segment.trackId), clip = track?.clips.find(c => c.id === segment.elementId);
      if (!clip) throw fail('Clip đã bị xóa.');
      const old = input(ownerId, ctx.creativeVersionId, 'creative-variant');
      const media = clip.assetId ? asset(ownerId, clip.assetId) : null;
      const component = saveInput(ownerId, 'component', request.name, { schemaVersion: 1, trackType: track.type, clip, assetHash: media?.content_hash || null, source: { projectId: request.projectId, seq: ctx.seq, elementId: clip.id } }, segment.componentVersionId);
      const creative = saveInput(ownerId, 'creative-variant', request.name, { ...old.payload, components: { ...old.payload.components, [clip.id]: component.id } }, old.id);
      return materialize(ownerId, creative.id, request.name);
    });
  }
  return { recipe, createRecipe, listRecipes, input, compile, createVariant, materializeVersion, context, reset, preview, applySiblings, promoteComponent, undoOperation };
}
module.exports = { createAutomationService };
