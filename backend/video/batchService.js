const crypto = require('node:crypto');
const { canonicalJson } = require('../../shared/video-document-diff');
const { orderedCandidates, planBatch } = require('../../shared/video-batch-planner');
const { compileBatchRow } = require('./batchCompiler');
const { preparedIssues } = require('./batchPrepared');
const { assertAllInvariants } = require('../../shared/video-commands/invariants');
const { digest } = require('./versionService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validName = value => typeof value === 'string' && value.trim() && value.length <= 120;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const copy = value => JSON.parse(JSON.stringify(value));

function createBatchService(db, projects, versions) {
  const automation = require('./automationService').createAutomationService(db, projects, versions);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  function own(ownerId, id, includeArchived = false) {
    const row = db.prepare(`SELECT b.*, c.name, c.archived_at FROM video_batch_projects b
      JOIN video_timeline_collections c ON c.id = b.collection_id
      WHERE b.id = ? AND b.owner_id = ? AND c.owner_id = ?`).get(id, ownerId, ownerId);
    if (!row || (!includeArchived && row.archived_at)) throw fail('Không tìm thấy project Lab đang hoạt động.', 404);
    return row;
  }
  function asset(ownerId, id) {
    const row = db.prepare('SELECT * FROM video_assets WHERE id = ? AND owner_id = ?').get(id, ownerId);
    if (!row) throw fail('Media không thuộc thư viện của bạn.', 404);
    return row;
  }
  function checkRevision(row, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || row.revision !== expectedRevision) throw fail('Lab đã thay đổi ở phiên khác. Tải lại trước khi lưu.', 409);
  }
  function simpleTrim(document, source, baseline) {
    const active = document.tracks.filter(t => t.clips.length);
    const clip = active[0]?.clips[0];
    const defaultTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    const allowed = ['id', 'assetId', 'sourceInMs', 'sourceOutMs', 'timelineInMs', 'timelineOutMs', 'speed', 'transform', 'effects', 'keyframes'];
    const settings = doc => Object.fromEntries(Object.entries(doc).filter(([key]) => !['tracks', 'transitions', 'sequence'].includes(key)));
    if (active.length !== 1 || active[0].clips.length !== 1 || !['video', 'audio'].includes(active[0].type)
      || active[0].type !== (source.kind === 'audio' ? 'audio' : 'video')
      || Object.keys(active[0]).some(k => !['id', 'name', 'type', 'order', 'locked', 'muted', 'visible', 'clips'].includes(k))
      || canonicalJson(settings(document)) !== canonicalJson(settings(baseline))
      || !active[0].visible || active[0].muted || document.transitions?.length
      || clip.assetId !== source.id || clip.speed !== 1 || clip.timelineInMs !== 0
      || (clip.effects?.length || clip.keyframes?.length) || Object.keys(clip).some(k => !allowed.includes(k))
      || Object.entries(clip.transform || {}).some(([k, v]) => defaultTransform[k] !== v)
      || !Number.isFinite(clip.sourceInMs) || clip.sourceInMs < 0 || clip.sourceOutMs <= clip.sourceInMs
      || Math.abs(clip.timelineOutMs - (clip.sourceOutMs - clip.sourceInMs)) > .01
      || (source.kind !== 'image' && clip.sourceOutMs > source.duration_ms + 1)) {
      throw fail('Công thức nhiều clip hoặc hiệu ứng chưa được hỗ trợ trong Lab. Hiện chỉ nhận trim một clip tốc độ 1, giữ canvas ban đầu; nội dung vẫn được giữ trong Video Editor.', 422);
    }
    assertAllInvariants(document);
    return { sourceInMs: clip.sourceInMs, sourceOutMs: clip.sourceOutMs };
  }
  function validateDraft(ownerId, row, draft) {
    if (!draft || Object.keys(draft).some(k => !['schemaVersion', 'settings', 'lists', 'tracks', 'template'].includes(k)) || draft.schemaVersion !== 1
      || !Array.isArray(draft.lists) || draft.lists.length > 50) throw fail('Draft Lab không hợp lệ (tối đa 50 list).');
    const settings = draft.settings;
    if (!settings || Object.keys(settings).some(k => !['width', 'height', 'fps'].includes(k))
      || !integer(settings.width, 16, 7680) || !integer(settings.height, 16, 7680)
      || ![24, 25, 30, 50, 60].includes(settings.fps)) throw fail('Canvas hoặc FPS không hợp lệ.');
    const oldDraft = JSON.parse(row.draft_json);
    const listIds = new Set(), itemIds = new Set();
    let count = 0;
    for (const list of draft.lists) {
      if (!validId(list.id) || listIds.has(list.id) || !validName(list.name)
        || !integer(list.minRating ?? 0, 0, 5) || !Array.isArray(list.items)
        || Object.keys(list).some(k => !['id', 'name', 'minRating', 'items'].includes(k))) throw fail('List không hợp lệ.');
      listIds.add(list.id);
      count += list.items.length;
      if (count > 1000) throw fail('Mỗi Lab nhận tối đa 1000 item.');
      for (const item of list.items) {
        if (!validId(item.id) || itemIds.has(item.id) || !integer(item.rating ?? 0, 0, 5)
          || !integer(item.manualOrder ?? 0, 0, 1000000) || (item.enabled !== undefined && typeof item.enabled !== 'boolean')
          || (item.label !== undefined && !validName(item.label))
          || Object.keys(item).some(k => !['id', 'sourceRef', 'rating', 'manualOrder', 'enabled', 'preparation', 'proxy', 'originItemId', 'label', 'speech'].includes(k))) throw fail('Item/rating/order không hợp lệ.');
        itemIds.add(item.id);
        const ref = item.sourceRef;
        if (!ref || !['media', 'timeline-version', 'vector-component'].includes(ref.kind)) throw fail('Nguồn item không hợp lệ.');
        // Prepared refs are minted only by prepare/capture. A client cannot forge
        // a trim or redirect preparation to an unrelated timeline, even its own.
        const old = oldDraft.lists.flatMap(l => l.items).find(i => i.id === item.id);
        if (canonicalJson(item.speech ?? null) !== canonicalJson(old?.speech ?? null)
          || (item.speech && canonicalJson(ref) !== canonicalJson(old?.sourceRef))) throw fail('Voice/captions cần được áp dụng qua hộp thoại Voice & captions.');
        if (canonicalJson(item.proxy ?? null) !== canonicalJson(old?.proxy ?? null)
          || (item.originItemId ?? null) !== (old?.originItemId ?? null)) throw fail('Proxy và origin chỉ được tạo qua thao tác chuẩn bị.');
        if (ref.kind !== 'media') {
          if (canonicalJson(ref) !== canonicalJson(old?.sourceRef) || canonicalJson(item.preparation) !== canonicalJson(old?.preparation)) throw fail('Prepared pin phải được nhận từ Video Editor.');
          continue;
        }
        if (!validId(ref.assetId) || Object.keys(ref).some(k => !['kind', 'assetId', 'contentHash', 'trim'].includes(k))) throw fail('Media ref không hợp lệ.');
        const media = asset(ownerId, ref.assetId);
        if (ref.contentHash !== media.content_hash) throw fail('Hash media đã thay đổi. Chọn lại nguồn trước khi lưu.', 409);
        if (canonicalJson(item.preparation ?? null) !== canonicalJson(old?.preparation ?? null)
          || canonicalJson(ref.trim ?? null) !== canonicalJson(old?.sourceRef.trim ?? null)
          || (old?.preparation && old.sourceRef.assetId !== ref.assetId)) throw fail('Liên kết chuẩn bị phải được tạo và ghim qua Video Editor.');
      }
    }
    const normalized = copy(draft);
    const trackIds = new Set(), slotIds = new Set();
    normalized.tracks ??= [];
    if (!Array.isArray(normalized.tracks) || normalized.tracks.length > 21) throw fail('Tối đa 10 track hình, 10 audio và 1 BGM.');
    for (const type of ['video', 'audio', 'bgm']) if (normalized.tracks.filter(t => t.type === type).length > (type === 'bgm' ? 1 : 10)) throw fail('Tối đa 10 track hình, 10 audio và 1 BGM.');
    let group = 0;
    for (const track of normalized.tracks) {
      const order = ['video', 'audio', 'bgm'].indexOf(track.type);
      if (order < group || order < 0 || !validId(track.id) || trackIds.has(track.id) || !validName(track.name)
        || !Array.isArray(track.slots) || track.slots.length > 100 || Object.keys(track).some(k => !['id', 'type', 'name', 'slots', 'policy', 'selectionMode', 'mediaKind'].includes(k))
        || (track.mediaKind !== undefined && (track.type !== 'video' || !['image', 'video'].includes(track.mediaKind)))
        || (track.policy !== undefined && !['trim', 'loop'].includes(track.policy))
        || (track.selectionMode !== undefined && !['playlist','one'].includes(track.selectionMode))) throw fail('Track không hợp lệ; hình ở trên, audio ở dưới, BGM cuối.');
      group = order; trackIds.add(track.id);
      for (const slot of track.slots) {
        if (!validId(slot.id) || slotIds.has(slot.id) || !listIds.has(slot.listId)
          || typeof slot.vary !== 'boolean' || !integer(slot.durationFrames, 1, settings.fps * 3600)
          || (slot.durationMode !== undefined && !['source', 'fixed'].includes(slot.durationMode))
          || (slot.fixedItemId && !draft.lists.find(l => l.id === slot.listId).items.some(i => i.id === slot.fixedItemId))
          || (slot.selectedItemIds !== undefined && (!Array.isArray(slot.selectedItemIds) || slot.fixedItemId
            || new Set(slot.selectedItemIds).size !== slot.selectedItemIds.length
            || slot.selectedItemIds.some(id => !validId(id) || !draft.lists.find(l => l.id === slot.listId).items.some(i => i.id === id))))
          || Object.keys(slot).some(k => !['id', 'listId', 'fixedItemId', 'selectedItemIds', 'vary', 'durationFrames', 'durationMode', 'fadeInFrames', 'fadeOutFrames', 'muteSourceAudio', 'transition', 'volume'].includes(k))
          || ['fadeInFrames', 'fadeOutFrames'].some(k => slot[k] !== undefined && !integer(slot[k], 0, settings.fps * 3600))
          || (slot.muteSourceAudio !== undefined && typeof slot.muteSourceAudio !== 'boolean')) throw fail('Block, list hoặc duration/fade không hợp lệ.');
        if (slot.volume !== undefined && (!Number.isFinite(slot.volume) || slot.volume < 0 || slot.volume > 10)) throw fail('Âm lượng block cần từ 0 đến 10.');
        if (slot.transition && (track.type !== 'video' || !require('../../shared/video-transition-catalog.json').some(t => t.type === slot.transition.type)
          || !integer(slot.transition.durationFrames,1,settings.fps*60) || Object.keys(slot.transition).some(k=>!['type','durationFrames'].includes(k)))) throw fail('Transition của block không hợp lệ.');
        slotIds.add(slot.id);
      }
    }
    if (slotIds.size > 100) throw fail('Tối đa 100 block trong một công thức.');
    if (canonicalJson(draft.template ?? null) !== canonicalJson(oldDraft.template ?? null)) throw fail('Chọn template qua thao tác ghim template.');
    for (const list of normalized.lists) {
      list.minRating ??= 0;
      list.items.forEach((item, index) => { item.rating ??= 0; item.manualOrder ??= index; item.enabled ??= true; });
    }
    return normalized;
  }
  function describe(row) {
    const draft = JSON.parse(row.draft_json);
    const media = {};
    for (const item of draft.lists.flatMap(l => l.items)) {
      if (item.sourceRef.kind === 'vector-component') {
        const component = automation.input(row.owner_id, item.sourceRef.componentVersionId, 'component');
        media[item.id] = { name:component.name, vector:true, kind:'image', shape:component.payload.clip.shape, sourcePath:'', contentHash:component.contentHash, status:component.contentHash === item.sourceRef.contentHash ? 'ok' : 'error' };
        continue;
      }
      if (item.sourceRef.kind === 'timeline-version') {
        const ref = item.sourceRef;
        try {
          const pin = versions.get(row.owner_id, ref.projectId, ref.versionId);
          const source = pin.dependencies[0] ? asset(row.owner_id, pin.dependencies[0].assetId) : null;
          const proxy = item.proxy?.assetId ? asset(row.owner_id, item.proxy.assetId) : null;
          const proxyProfileMatches = item.proxy?.key===digest({ref,profile:draft.settings,preset:'original'});
          const issues = preparedIssues(pin.document);
          const kind = pin.document.tracks.some(t => t.type !== 'audio' && t.visible !== false && t.clips.length) ? 'video' : 'audio';
          media[item.id] = { name: item.label || `Công thức · ${pin.name}`, kind, prepared: true, sourcePath: source?.source_path || '',
            contentHash: ref.documentHash, speechSourcePath:proxy?.source_path, durationMs: proxy?.duration_ms ?? Math.max(0, ...pin.document.tracks.flatMap(t => t.clips.map(c => c.timelineOutMs))),
            status: pin.staleDependencies || pin.documentHash !== ref.documentHash ? 'error' : 'ok', hashChanged: pin.staleDependencies,
            preparationPending: false, hasNewerPreparation: pin.staleDocument, needsProxy: issues.length > 0 && !proxy, preparedIssues: issues,
            proxyStatus: item.proxy?.jobId && proxyProfileMatches ? db.prepare('SELECT status FROM video_render_jobs WHERE id = ? AND owner_id = ?').get(item.proxy.jobId, row.owner_id)?.status : null,
            proxyReady: !!proxy && proxy.status === 'ok' && proxy.content_hash === item.proxy.contentHash && proxyProfileMatches };
        } catch (e) { media[item.id] = { name: item.label || 'Công thức đã ghim', kind:'video', prepared:true, status:'offline', error:e.message, contentHash:ref.documentHash }; }
        continue;
      }
      const source = asset(row.owner_id, item.sourceRef.assetId);
      const preparationSeq = item.preparation ? projects.getLatestCommandSeq(item.preparation.projectId) : null;
      media[item.id] = {
        assetId: source.id, name: (source.original_source_path || source.source_path).split(/[\\/]/).pop(), sourcePath: source.source_path,
        kind: source.kind, durationMs: source.duration_ms, status: source.status,
        contentHash: source.content_hash, preparationSeq,
        preparationPending: !!item.preparation && item.preparation.acceptedSeq !== preparationSeq,
        hashChanged: source.content_hash !== item.sourceRef.contentHash,
      };
    }
    const counts = Object.fromEntries(draft.lists.map(list => [list.id, orderedCandidates({ ...list, items: list.items.map(i => ({ ...i, kind: media[i.id].kind,
      status: media[i.id].preparationPending || media[i.id].hashChanged ? 'pending' : media[i.id].status })) }).length]));
    return { id: row.id, collectionId: row.collection_id, name: row.name, revision: row.revision,
      archived: !!row.archived_at, draft, media, counts };
  }
  function get(ownerId, id) { return describe(own(ownerId, id, true)); }
  function resolveSnapshot(ownerId, row) {
    const project = describe(row), assets = {}, prepared = {}, vectors = {};
    const lists = project.draft.lists.map(l => ({ ...l, items: l.items.map(item => {
      if (item.sourceRef.kind === 'vector-component') {
        const component = automation.input(ownerId, item.sourceRef.componentVersionId, 'component');
        if (component.contentHash !== item.sourceRef.contentHash) throw fail('Vector component đã đổi.', 409);
        vectors[item.id] = component.payload.clip;
      } else if (item.sourceRef.kind === 'timeline-version') {
        const ref = item.sourceRef, pin = versions.get(ownerId, ref.projectId, ref.versionId);
        if (pin.documentHash !== ref.documentHash || pin.seq !== ref.seq || pin.staleDependencies) throw fail('Prepared pin hoặc dependency đã thay đổi.', 409);
        prepared[item.id] = pin.document;
        for (const dep of ref.dependencies) { const media = asset(ownerId, dep.assetId); if (media.content_hash !== dep.contentHash || media.status !== 'ok') throw fail('Nguồn prepared chưa sẵn sàng hoặc hash đã đổi.', 409); assets[media.id] = media; }
        if (item.proxy?.assetId) { const media = asset(ownerId, item.proxy.assetId); if (media.content_hash !== item.proxy.contentHash || media.status !== 'ok' || item.proxy.key!==digest({ref,profile:project.draft.settings,preset:'original'})) throw fail('Proxy đã đổi hoặc khác cấu hình canvas/FPS. Tạo lại proxy theo cấu hình hiện tại.', 409); assets[media.id] = media; }
      } else { const media = asset(ownerId, item.sourceRef.assetId); assets[media.id] = media; }
      if (item.speech) {
        const base = assets[item.proxy?.assetId || item.sourceRef.assetId];
        if (!base || item.speech.sourceHash !== base.content_hash) throw fail('Nguồn voice/captions đã đổi. Phân tích và áp dụng lại.', 409);
        if (item.speech.audio) {
          const audio = asset(ownerId, item.speech.audio.assetId);
          if (audio.status !== 'ok' || audio.content_hash !== item.speech.audio.contentHash) throw fail('Audio đổi giọng chưa sẵn sàng hoặc đã đổi.', 409);
          assets[audio.id] = audio;
        }
      }
      const info = project.media[item.id];
      return { ...item, name: info.name, kind: info.kind, status: info.preparationPending || info.hashChanged ? 'pending' : info.status };
    }) }));
    // Only semantic asset facts participate in the hash, not thumbnail/cache timestamps.
    for (const [id, a] of Object.entries(assets)) assets[id] = { id, kind: a.kind, content_hash: a.content_hash, duration_ms: a.duration_ms, status: a.status, rights: a.rights_json ? JSON.parse(a.rights_json) : {} };
    const slots = (project.draft.tracks || []).flatMap(t => t.slots.map(s => ({ ...s, trackId: t.id, kind: t.type === 'video' ? t.mediaKind || 'visual' : 'audio',...(t.type==='bgm' && t.selectionMode!=='one'?{playlist:true}:{}) })));
    let template = null;
    if (project.draft.template) {
      const ref = project.draft.template, pin = versions.get(ownerId, ref.projectId, ref.versionId);
      if (pin.documentHash !== ref.documentHash || pin.seq !== ref.seq || pin.staleDependencies) throw fail('Template pin hoặc dependency đã thay đổi.', 409);
      template = pin.document;
    }
    return { plannerVersion: 1, projectId: row.id, revision: row.revision, draft: project.draft, lists, slots, assets, template, prepared, vectors };
  }
  function templates(ownerId) {
    return db.prepare(`SELECT v.id AS versionId, v.project_id AS projectId, v.name, v.seq, p.name AS projectName
      FROM video_named_versions v JOIN video_projects p ON p.id = v.project_id
      WHERE p.owner_id = ? AND p.archived_at IS NULL ORDER BY v.rowid DESC LIMIT 200`).all(ownerId);
  }
  function pinTemplate(ownerId, id, request) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
      const draft = JSON.parse(row.draft_json);
      if (request.versionId === null) { delete draft.template; return write(row, draft); }
      const pin = versions.get(ownerId, request.projectId, request.versionId), document = pin.document;
      if (pin.staleDependencies) throw fail('Template có nguồn đã đổi.', 409);
      if (document.transitions?.some(t=>t.timingMode !== 'centered-v1')) throw fail('Template có transition timing cũ. Tạo template từ công thức Lab để giữ timing centered.', 422);
      const bindings = {}, tracks = [];
      for (const t of document.tracks.filter(t => t.clips.length).sort((a,b)=>b.order-a.order)) {
        if (!['video', 'audio'].includes(t.type) || t.visible === false || t.muted) throw fail('Template hiện cần track hình/audio đang bật.', 422);
        let cursor = 0;
        const slots = [];
        for (const c of [...t.clips].sort((a,b) => a.timelineInMs - b.timelineInMs)) {
          if (c.timelineInMs !== cursor || !c.assetId || c.speed !== 1 || c.compoundRef) throw fail('Template cần các clip media liên tiếp, tốc độ 1; prepared dùng đường chuẩn bị riêng.', 422);
          const a = asset(ownerId, c.assetId);
          let list = draft.lists.find(l => l.items.some(i => i.sourceRef.assetId === c.assetId));
          if (!list) { list = { id: crypto.randomUUID(), name: a.source_path.split(/[\\/]/).pop().slice(0,120), minRating: 0,
            items: [{ id: crypto.randomUUID(), sourceRef: { kind:'media', assetId:a.id, contentHash:a.content_hash }, rating:0, manualOrder:0, enabled:true }] }; draft.lists.push(list); }
          const slotId = crypto.randomUUID(); bindings[slotId] = c.id;
          const transition = document.transitions?.find(t=>t.fromClipId===c.id);
          slots.push({ id: slotId, listId: list.id, fixedItemId:list.items.find(i=>i.sourceRef.assetId===c.assetId).id, vary: false, durationFrames: Math.round((c.timelineOutMs - c.timelineInMs) * document.fps / 1000),
            ...(transition ? {transition:{type:transition.type || 'crossfade',durationFrames:Math.round(transition.durationMs*document.fps/1000)}} : {}) }); cursor = c.timelineOutMs;
        }
        tracks.push({ id: crypto.randomUUID(), name: t.name || (t.type === 'video' ? 'Hình' : 'Audio'), type:t.type, slots });
      }
      tracks.sort((a,b) => (a.type === 'audio') - (b.type === 'audio'));
      draft.settings = { width: document.resolution.width, height: document.resolution.height, fps: document.fps };
      draft.tracks = tracks;
      // Validate all ordinary draft fields before minting the trusted pin metadata.
      const checked = validateDraft(ownerId, row, draft);
      checked.template = { projectId: pin.projectId, versionId: pin.id, seq: pin.seq, documentHash: pin.documentHash, bindings };
      return write(row, checked);
    });
  }
  function preflight(ownerId, id, { expectedRevision, offset = 0, limit = 20 }) {
    const row = own(ownerId, id); checkRevision(row, expectedRevision);
    const snapshot = resolveSnapshot(ownerId, row), planned = planBatch(snapshot, { offset: 0, limit: 100 });
    const compiled = planned.rows.map(r => {
      try { const result = compileChecked(ownerId, snapshot, r); return { ...r, durationFrames: result.durationFrames, documentHash: result.report.documentHash, issues: [] }; }
      catch (e) { return { ...r, issues: [{ severity: 'error', message: e.message }] }; }
    });
    const page = planBatch(snapshot, { offset, limit });
    const warnings = planned.axes.flatMap(a => {
      const used = new Set(planned.rows.flatMap(r => r.assignments.filter(v => v.slotId === a.slotId).flatMap(v => v.playlistItemIds || [v.itemId])));
      return a.itemIds.filter(id => !used.has(id)).map(itemId => ({ slotId: a.slotId, itemId, message: 'Item chưa được dùng; bật Biến thiên để dùng hết list.' }));
    });
    return { ...page, inputHash: digest(snapshot), snapshot, rows: compiled.slice(offset, offset + limit),
      issues: compiled.flatMap(r => r.issues.map(i => ({ ...i, rowIndex: r.rowIndex }))), warnings };
  }
  function compileChecked(ownerId, snapshot, row) {
    const result = compileBatchRow(snapshot, row);
    const issues = versions.qc(result.document, versions.dependencies(ownerId, result.document));
    if (issues.some(i=>i.severity === 'error')) throw fail(issues.filter(i=>i.severity==='error').map(i=>i.message).join(' '),422);
    return result;
  }
  function sample(ownerId, id, request) {
    const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
    const snapshot = resolveSnapshot(ownerId, row), planned = planBatch(snapshot, { offset: request.rowIndex || 0, limit: 1 });
    if (!planned.rows.length) throw fail('Không tìm thấy hàng ma trận.');
    return compileChecked(ownerId, snapshot, planned.rows[0]);
  }
  async function verifySources(ownerId, snapshot, hashSource) {
    const planned = planBatch(snapshot, { limit:100 }), used = new Set(planned.rows.flatMap(r => r.assignments.flatMap(a => a.playlistItemIds || [a.itemId])));
    const ids = new Set();
    for (const item of snapshot.lists.flatMap(l => l.items).filter(i => used.has(i.id))) {
      if (item.sourceRef.assetId) ids.add(item.sourceRef.assetId);
      for (const dep of item.sourceRef.dependencies || []) ids.add(dep.assetId);
      if (item.proxy?.assetId) ids.add(item.proxy.assetId);
      if (item.speech?.audio?.assetId) ids.add(item.speech.audio.assetId);
    }
    for (const assetId of ids) {
      const row = asset(ownerId, assetId);
      let hash;
      try { hash = await hashSource(row); }
      catch (e) { throw fail(`Nguồn ${row.source_path.split(/[\\/]/).pop()} chưa truy cập được: ${e.message}`, 409); }
      if (hash !== snapshot.assets[assetId].content_hash) throw fail(`File ${row.source_path.split(/[\\/]/).pop()} đã đổi trên đĩa. Nhập lại nguồn trước khi tạo batch.`, 409);
    }
  }
  function existingRun(ownerId, id, request) {
    own(ownerId, id);
    const previous = db.prepare('SELECT id, input_hash FROM video_batch_runs WHERE project_id = ? AND idempotency_key = ?').get(id, request.idempotencyKey || '');
    if (!previous) return null;
    if (previous.input_hash !== request.inputHash) throw fail('Mã yêu cầu đã dùng cho input khác.', 409);
    return getRun(ownerId, id, previous.id);
  }
  function runs(ownerId, id) {
    own(ownerId, id, true);
    return db.prepare('SELECT id, input_hash AS inputHash, count, created_at AS createdAt FROM video_batch_runs WHERE project_id = ? AND owner_id = ? ORDER BY rowid DESC').all(id, ownerId)
      .map(row => ({ ...row, ...runCounts(ownerId, row.id) }));
  }
  function runCounts(ownerId, runId) {
    const rows = db.prepare(`SELECT i.timeline_id, i.render_jobs_json FROM video_batch_run_items i
      JOIN video_projects p ON p.id=i.timeline_id WHERE i.run_id=? AND p.archived_at IS NULL`).all(runId);
    let runningCount = 0;
    const pendingCount = rows.filter(item => {
      const last = JSON.parse(item.render_jobs_json).at(-1);
      const job = last && db.prepare('SELECT status, pinned_seq FROM video_render_jobs WHERE id=? AND owner_id=?').get(last.jobId, ownerId);
      if (['queued', 'running'].includes(job?.status)) runningCount++;
      return job?.status !== 'done' || job.pinned_seq !== projects.getLatestCommandSeq(item.timeline_id);
    }).length;
    return { activeCount: rows.length, pendingCount, runningCount };
  }
  function getRun(ownerId, id, runId, { offset = 0, limit = 20 } = {}) {
    own(ownerId, id, true);
    if (!integer(offset, 0, 100) || !integer(limit, 1, 100)) throw fail('Trang kết quả không hợp lệ.');
    const row = db.prepare('SELECT * FROM video_batch_runs WHERE id = ? AND project_id = ? AND owner_id = ?').get(runId, id, ownerId);
    if (!row) throw fail('Không tìm thấy lần tạo batch.', 404);
    const snapshot = JSON.parse(row.snapshot_json);
    const sources = snapshot.lists.flatMap(list => list.items.map(item => ({
      itemId: item.id, id: item.sourceRef.assetId || (item.sourceRef.componentVersionId ? `vector:${item.sourceRef.componentVersionId}` : `prepared:${item.sourceRef.projectId}:${item.sourceRef.versionId}`),
      name: item.name || snapshot.assets[item.sourceRef.assetId]?.source_path?.split(/[\\/]/).pop() || list.name,
      listId: list.id, listName: list.name,
    })));
    const items = db.prepare(`SELECT i.*, p.name, p.archived_at FROM video_batch_run_items i JOIN video_projects p ON p.id = i.timeline_id
      WHERE i.run_id = ? ORDER BY i.row_index LIMIT ? OFFSET ?`).all(runId, limit, offset).map(item => ({
      rowIndex: item.row_index, assignments: JSON.parse(item.assignments_json), timelineId: item.timeline_id, name: item.name, archived: !!item.archived_at,
      versionId: item.version_id, seq: 0, currentSeq: projects.getLatestCommandSeq(item.timeline_id), documentHash: item.document_hash,
      jobs: JSON.parse(item.render_jobs_json).map(ref => ({ ...ref, ...db.prepare('SELECT status, progress_pct AS progress, error_message AS error, pinned_seq AS pinnedSeq FROM video_render_jobs WHERE id = ? AND owner_id = ?').get(ref.jobId, ownerId) })),
      deliveries: db.prepare('SELECT id,state,error,asset_id AS assetId,receipt_json AS receipt FROM video_batch_deliveries WHERE run_id=? AND row_index=? AND owner_id=? ORDER BY rowid').all(runId,item.row_index,ownerId).map(d=>({...d,receipt:d.receipt?JSON.parse(d.receipt):null})),
    }));
    return { id: row.id, inputHash: row.input_hash, count: row.count, createdAt: row.created_at, sources, ...runCounts(ownerId, runId), items };
  }
  function createRun(ownerId, id, request) {
    const { expectedRevision, inputHash, idempotencyKey } = request;
    own(ownerId, id);
    if (!validId(idempotencyKey) || typeof inputHash !== 'string') throw fail('Cần mã yêu cầu và hash preview.');
    const previous = db.prepare('SELECT id, input_hash FROM video_batch_runs WHERE project_id = ? AND idempotency_key = ?').get(id, idempotencyKey);
    if (previous) {
      if (previous.input_hash !== inputHash) throw fail('Mã yêu cầu đã dùng cho input khác.', 409);
      return getRun(ownerId, id, previous.id);
    }
    const row = own(ownerId, id); checkRevision(row, expectedRevision);
    const snapshot = resolveSnapshot(ownerId, row);
    if (digest(snapshot) !== inputHash) throw fail('Input đã đổi sau preview. Kiểm tra lại ma trận.', 409);
    const planned = planBatch(snapshot, { limit: 100 });
    const documents = planned.rows.map(r => compileChecked(ownerId, snapshot, r));
    return transaction(() => {
      const current = own(ownerId, id); checkRevision(current, expectedRevision);
      if (digest(resolveSnapshot(ownerId, current)) !== inputHash) throw fail('Dependency đã đổi trước khi tạo batch.', 409);
      const runId = crypto.randomUUID();
      db.prepare('INSERT INTO video_batch_runs(id, project_id, owner_id, idempotency_key, input_hash, snapshot_json, count) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(runId, id, ownerId, idempotencyKey, inputHash, canonicalJson(snapshot), planned.totalCount);
      let recipeId;
      for (const [index, result] of documents.entries()) {
        const items = new Map(snapshot.lists.flatMap(l => l.items).map(item => [item.id, item]));
        const name = require('./batchOutputName').batchOutputName(planned.rows[index].assignments
          .flatMap(a => a.playlistItemIds || [a.itemId]).map(id => items.get(id).name));
        const output = automation.materializeDocument(ownerId, result.document, name, row.collection_id, { batchRunId: runId, inputHash, rowIndex: index, origins: result.origins }, recipeId);
        recipeId ||= output.plan.recipeVersionId;
        if (output.report.documentHash !== result.report.documentHash) throw fail('Compiler output không khớp preflight.', 409);
        db.prepare('INSERT INTO video_batch_run_items(run_id, row_index, assignments_json, timeline_id, version_id, document_hash) VALUES (?, ?, ?, ?, ?, ?)')
          .run(runId, index, canonicalJson(planned.rows[index].assignments), output.projectId, output.versionId, output.report.documentHash);
      }
      return getRun(ownerId, id, runId);
    });
  }
  function renderSelected(ownerId, id, runId, request, createRenderJob) {
    getRun(ownerId, id, runId);
    const { rowIndexes, selectionKey, presetId = 'original', mode = 'current', expectedSeqs = {} } = request;
    if (!validId(selectionKey) || !['current', 'baseline', 'retry'].includes(mode) || !Array.isArray(rowIndexes) || !rowIndexes.length
      || rowIndexes.length > 100 || new Set(rowIndexes).size !== rowIndexes.length || rowIndexes.some(n => !integer(n, 0, 99))) throw fail('Selection render không hợp lệ.');
    const requestHash = digest(request), results = [];
    for (const index of rowIndexes) {
      const item = db.prepare('SELECT * FROM video_batch_run_items WHERE run_id = ? AND row_index = ?').get(runId, index);
      if (!item) throw fail('Selection chứa output không thuộc run.', 404);
      if (db.prepare('SELECT archived_at FROM video_projects WHERE id=?').get(item.timeline_id)?.archived_at) throw fail('Khôi phục timeline trong thùng rác trước khi render.', 409);
    }
    const recorded = db.prepare('SELECT render_jobs_json FROM video_batch_run_items WHERE run_id=?').all(runId).flatMap(i=>JSON.parse(i.render_jobs_json)).find(j=>j.selectionKey===selectionKey);
    if(recorded && recorded.requestHash!==requestHash) throw fail('Mã selection đã được dùng cho yêu cầu khác.',409);
    for (const index of rowIndexes) {
      const item = db.prepare('SELECT * FROM video_batch_run_items WHERE run_id = ? AND row_index = ?').get(runId, index);
      const jobs = JSON.parse(item.render_jobs_json), previous = jobs.find(j => j.selectionKey === selectionKey);
      if (previous) {
        if (previous.requestHash !== requestHash) throw fail('Mã selection đã được dùng cho yêu cầu khác.', 409);
        results.push({ rowIndex: index, jobId: previous.jobId }); continue;
      }
      try {
        const last = jobs.at(-1);
        if (mode === 'retry' && !last) throw fail('Output chưa có render để retry.');
        const lastJob = last && db.prepare('SELECT status FROM video_render_jobs WHERE id = ? AND owner_id = ?').get(last.jobId, ownerId);
        if (mode === 'retry' && lastJob && ['done', 'queued', 'running'].includes(lastJob.status)) { results.push({ rowIndex: index, jobId: last.jobId }); continue; }
        let pin;
        if (mode === 'retry' || mode === 'baseline') pin = versions.get(ownerId, item.timeline_id, mode === 'retry' ? last.versionId : item.version_id);
        else {
          const seq = projects.getLatestCommandSeq(item.timeline_id);
          if (expectedSeqs[index] !== seq) throw fail('Timeline đã đổi. Tải lại kết quả trước khi xuất bản chỉnh sửa.', 409);
          pin = versions.create(ownerId, item.timeline_id, { name: `Batch export · ${seq}`, baseRevision: seq });
        }
        if (pin.staleDependencies || pin.issues.some(i => i.severity === 'error')) throw fail(pin.issues.filter(i => i.severity === 'error').map(i => i.message).join(' ') || 'Nguồn của pin đã thay đổi.', 422);
        const preset = mode === 'retry' ? last.presetId : presetId;
        const job = createRenderJob(ownerId, item.timeline_id, { versionId: pin.id, baseRevision: pin.seq, presetId: preset, idempotencyKey: `batch-${runId}-${index}-${selectionKey}` });
        jobs.push({ selectionKey, requestHash, jobId: job.jobId, versionId: pin.id, seq: pin.seq, presetId: preset });
        db.prepare('UPDATE video_batch_run_items SET render_jobs_json = ? WHERE run_id = ? AND row_index = ?').run(canonicalJson(jobs), runId, index);
        results.push({ rowIndex: index, jobId: job.jobId });
      } catch (e) { results.push({ rowIndex: index, error: e.message }); }
    }
    return { results, run: getRun(ownerId, id, runId) };
  }
  function manifest(ownerId, id, runId, rowIndex) {
    const run = getRun(ownerId, id, runId, { offset: rowIndex, limit: 1 });
    const item = run.items[0]; if (!item || item.rowIndex !== rowIndex) throw fail('Không tìm thấy output.', 404);
    return { schemaVersion: 1, batchProjectId: id, batchRunId: runId, inputHash: run.inputHash, ...item,
      renderManifests: item.jobs.map(j => ({ jobId: j.jobId, url: `/api/video-render/${item.timelineId}/render/${j.jobId}/manifest` })) };
  }
  function list(ownerId, archived = false) {
    return db.prepare(`SELECT b.id, b.collection_id AS collectionId, c.name, b.revision FROM video_batch_projects b
      JOIN video_timeline_collections c ON c.id = b.collection_id WHERE b.owner_id = ? AND c.owner_id = ?
      AND c.archived_at IS ${archived ? 'NOT NULL' : 'NULL'} ORDER BY b.updated_at DESC, b.rowid DESC`).all(ownerId, ownerId);
  }
  function create(ownerId, { id, name, settings = { width: 1920, height: 1080, fps: 30 } }) {
    if (!validId(id) || !validName(name)) throw fail('Tên project cần 1–120 ký tự và mã yêu cầu hợp lệ.');
    return transaction(() => {
      // Client-generated project id makes lost-response retries safe.
      const previous = db.prepare('SELECT owner_id FROM video_batch_projects WHERE id = ?').get(id);
      if (previous) {
        const row = own(ownerId, id);
        if (row.name !== name.trim() || canonicalJson(JSON.parse(row.draft_json).settings) !== canonicalJson(settings)) throw fail('Mã tạo project đã được dùng cho nội dung khác.', 409);
        return describe(row);
      }
      const draft = { schemaVersion: 1, settings, lists: [] };
      validateDraft(ownerId, { draft_json: JSON.stringify(draft) }, draft);
      const collectionId = crypto.randomUUID();
      db.prepare('INSERT INTO video_timeline_collections(id, owner_id, name) VALUES (?, ?, ?)').run(collectionId, ownerId, name.trim());
      db.prepare('INSERT INTO video_batch_projects(id, owner_id, collection_id, draft_json) VALUES (?, ?, ?, ?)').run(id, ownerId, collectionId, canonicalJson(draft));
      return get(ownerId, id);
    });
  }
  function write(row, draft) {
    db.prepare("UPDATE video_batch_projects SET draft_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(canonicalJson(draft), row.id);
    return get(row.owner_id, row.id);
  }
  function save(ownerId, id, { expectedRevision, name, draft }) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, expectedRevision);
      if (!validName(name)) throw fail('Tên project cần 1–120 ký tự.');
      const checked = validateDraft(ownerId, row, draft);
      db.prepare("UPDATE video_timeline_collections SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), row.collection_id);
      return write(row, checked);
    });
  }
  function applySpeech(ownerId, id, request) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
      const draft = JSON.parse(row.draft_json), item = draft.lists.flatMap(l => l.items).find(i => i.id === request.itemId);
      if (!item) throw fail('Không tìm thấy nguồn trong Lab.', 404);
      const base = asset(ownerId, item.proxy?.assetId || item.sourceRef.assetId);
      if (request.sourceHash !== base.content_hash) throw fail('Nguồn đã thay đổi. Phân tích lại.', 409);
      if (request.speech === null) delete item.speech;
      else {
        item.speech = { ...require('../../shared/video-speech').validateSpeech(request.speech, base.duration_ms), sourceHash:base.content_hash };
        if (request.audio) {
          const audio = asset(ownerId, request.audio.assetId);
          if (audio.kind !== 'audio' || audio.content_hash !== request.audio.contentHash || Math.abs(audio.duration_ms - base.duration_ms) > 100) throw fail('Audio đổi giọng không khớp nguồn.');
          item.speech.audio = request.audio;
          item.speech.conversionJobId = request.conversionJobId;
        }
      }
      return write(row, draft);
    });
  }
  function archive(ownerId, id, { expectedRevision, restore = false }) {
    return transaction(() => archiveWithinTransaction(ownerId, id, { expectedRevision, restore }));
  }
  function archiveWithinTransaction(ownerId, id, { expectedRevision, restore = false }) {
      const row = own(ownerId, id, true); checkRevision(row, expectedRevision);
      if (restore === !row.archived_at) return describe(row);
      if (restore) {
        for (const projectId of JSON.parse(row.archived_members_json)) db.prepare('UPDATE video_projects SET archived_at = NULL WHERE id = ? AND collection_id = ? AND owner_id = ?').run(projectId, row.collection_id, ownerId);
        db.prepare("UPDATE video_batch_projects SET archived_members_json = '[]' WHERE id = ?").run(id);
        db.prepare('UPDATE video_timeline_collections SET archived_at = NULL WHERE id = ?').run(row.collection_id);
      } else {
        const members = db.prepare('SELECT id FROM video_projects WHERE collection_id = ? AND owner_id = ? AND archived_at IS NULL').all(row.collection_id, ownerId).map(p => p.id);
        db.prepare('UPDATE video_batch_projects SET archived_members_json = ? WHERE id = ?').run(JSON.stringify(members), id);
        db.prepare("UPDATE video_projects SET archived_at = datetime('now') WHERE collection_id = ? AND owner_id = ? AND archived_at IS NULL").run(row.collection_id, ownerId);
        db.prepare("UPDATE video_timeline_collections SET archived_at = datetime('now') WHERE id = ?").run(row.collection_id);
      }
      db.prepare('UPDATE video_batch_projects SET revision = revision + 1 WHERE id = ?').run(id);
      return get(ownerId, id);
  }
  function locate(row, listId, itemId) {
    const draft = JSON.parse(row.draft_json), item = draft.lists.find(l => l.id === listId)?.items.find(i => i.id === itemId);
    if (!item) throw fail('Không tìm thấy item trong list.', 404);
    return { draft, item };
  }
  function prepare(ownerId, id, { expectedRevision, listId, itemId }) {
    return transaction(() => {
      const row = own(ownerId, id), { draft, item } = locate(row, listId, itemId);
      if (item.preparation) {
        const existing = db.prepare('SELECT id FROM video_projects WHERE id = ? AND owner_id = ? AND archived_at IS NULL').get(item.preparation.projectId, ownerId);
        if (!existing) throw fail('Timeline chuẩn bị đang trong thùng rác. Khôi phục timeline trước khi mở.', 409);
        return { project: describe(row), timelineId: existing.id };
      }
      checkRevision(row, expectedRevision);
      const vector = item.sourceRef.kind === 'vector-component' ? automation.input(ownerId, item.sourceRef.componentVersionId, 'component') : null;
      const source = vector ? { kind:'image', status:'ok', content_hash:vector.contentHash, source_path:vector.name } : asset(ownerId, item.sourceRef.assetId);
      if (source.status !== 'ok' || source.content_hash !== item.sourceRef.contentHash) throw fail('Media chưa sẵn sàng hoặc hash đã đổi.', 409);
      const duration = source.kind === 'image' ? 5000 : source.duration_ms;
      if (!Number.isFinite(duration) || duration <= 0) throw fail('Media chưa có thời lượng hợp lệ.');
      const timelineId = crypto.randomUUID();
      const document = { schemaVersion: 1, resolution: { width: draft.settings.width, height: draft.settings.height }, fps: draft.settings.fps, colorSpace: 'sRGB', audioRate: 48000, sequence: { markers: [] }, transitions: [], tracks: [{
        id: crypto.randomUUID(), type: source.kind === 'audio' ? 'audio' : 'video', order: 0, locked: false, muted: false, visible: true,
        clips: [{ id: crypto.randomUUID(), assetId: source.id, sourceInMs: 0, sourceOutMs: duration, timelineInMs: 0, timelineOutMs: duration, speed: 1,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] }],
      }] };
      if (vector) { delete document.tracks[0].clips[0].assetId; document.tracks[0].clips[0].shape = vector.payload.clip.shape; }
      assertAllInvariants(document);
      const payload = canonicalJson(document), name = `Chuẩn bị · ${source.source_path.split(/[\\/]/).pop()}`.slice(0, 120);
      db.prepare('INSERT INTO video_projects(id, owner_id, name, payload, collection_id) VALUES (?, ?, ?, ?, ?)').run(timelineId, ownerId, name, payload, row.collection_id);
      db.prepare('INSERT INTO video_project_snapshots(id, project_id, seq, payload) VALUES (?, ?, 0, ?)').run(crypto.randomUUID(), timelineId, payload);
      const pin = versions.create(ownerId, timelineId, { name: 'Nguồn ban đầu', baseRevision: 0 });
      item.preparation = { projectId: timelineId, acceptedSeq: 0, versionId: pin.id };
      return { project: write(row, draft), timelineId };
    });
  }
  function capture(ownerId, id, { expectedRevision, listId, itemId, baseRevision }) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, expectedRevision);
      const { draft, item } = locate(row, listId, itemId);
      if (!item.preparation) throw fail('Mở timeline chuẩn bị trước.');
      const source = asset(ownerId, item.sourceRef.assetId), projectId = item.preparation.projectId;
      if (source.status !== 'ok' || source.content_hash !== item.sourceRef.contentHash) throw fail('Media đã đổi hoặc chưa sẵn sàng.', 409);
      if (projects.getLatestCommandSeq(projectId) !== baseRevision) throw fail('Timeline đang thay đổi. Chờ lưu hoàn tất rồi nhận lại.', 409);
      const document = projects.recoverProjectState(projectId);
      const trim = simpleTrim(document, source, projects.recoverProjectState(projectId, 0));
      const pin = versions.create(ownerId, projectId, { name: `Trim · ${baseRevision}`, baseRevision });
      item.sourceRef.trim = { ...trim, projectId, versionId: pin.id, seq: pin.seq, documentHash: digest(document) };
      item.preparation = { projectId, versionId: pin.id, acceptedSeq: pin.seq };
      return write(row, draft);
    });
  }
  function capturePrepared(ownerId, id, { expectedRevision, listId, itemId, baseRevision, asVariant = false }) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, expectedRevision);
      const { draft, item } = locate(row, listId, itemId);
      if (!item.preparation) throw fail('Mở timeline chuẩn bị trước.');
      const projectId = item.preparation.projectId;
      if (projects.getLatestCommandSeq(projectId) !== baseRevision) throw fail('Chờ editor lưu xong trước khi nhận công thức.', 409);
      const document = projects.recoverProjectState(projectId); assertAllInvariants(document);
      if (!document.tracks.some(t => t.clips.length)) throw fail('Công thức cần ít nhất một clip.');
      const dependencies = versions.dependencies(ownerId, document);
      if (dependencies.some(d => !d.contentHash || d.status !== 'ok')) throw fail('Nguồn công thức chưa sẵn sàng.', 409);
      const pin = versions.create(ownerId, projectId, { name: `Công thức · ${baseRevision}`, baseRevision });
      const target = asVariant ? { ...copy(item), id: crypto.randomUUID(), originItemId: item.id, rating: 0, enabled: true,
        manualOrder: draft.lists.find(l => l.id === listId).items.length, label: `${item.label || 'Công thức'} · variant` } : item;
      delete target.proxy;
      target.sourceRef = { kind:'timeline-version', projectId, versionId:pin.id, seq:pin.seq, documentHash:pin.documentHash, dependencies:pin.dependencies };
      target.preparation = { projectId, versionId:pin.id, acceptedSeq:pin.seq };
      if (asVariant) draft.lists.find(l => l.id === listId).items.push(target);
      return { project: write(row, draft), itemId: target.id };
    });
  }
  function startProxy(ownerId, id, request, createRenderJob) {
    const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
    const { draft, item } = locate(row, request.listId, request.itemId), ref = item.sourceRef;
    if (ref.kind !== 'timeline-version') throw fail('Chọn một công thức đã ghim.');
    const pin = versions.get(ownerId, ref.projectId, ref.versionId);
    if (pin.staleDependencies) throw fail('Nguồn của công thức đã đổi.', 409);
    const key = digest({ ref, profile: draft.settings, preset: 'original' });
    const cached=item.proxy?.key===key && item.proxy.assetId ? asset(ownerId,item.proxy.assetId) : null;
    if (cached && cached.status==='ok' && cached.content_hash===item.proxy.contentHash) return get(ownerId, id);
    const previous = item.proxy?.key === key && db.prepare('SELECT status FROM video_render_jobs WHERE id = ? AND owner_id = ?').get(item.proxy.jobId, ownerId);
    const attempt = previous && (['error','cancelled'].includes(previous.status) || cached) ? (item.proxy.attempt || 0) + 1 : item.proxy?.attempt || 0;
    const job = createRenderJob(ownerId, ref.projectId, { versionId:ref.versionId, baseRevision:ref.seq, presetId:'original', idempotencyKey:`batch-proxy-${key}-${attempt}` });
    item.proxy = { key, jobId:job.jobId, attempt };
    return write(row, draft);
  }
  async function acceptProxy(ownerId, id, request, promote) {
    const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
    const { item } = locate(row, request.listId, request.itemId);
    if (!item.proxy) throw fail('Chưa yêu cầu tạo proxy.');
    if (item.proxy.assetId) return get(ownerId, id);
    const job = db.prepare('SELECT * FROM video_render_jobs WHERE id = ? AND owner_id = ?').get(item.proxy.jobId, ownerId);
    if (!job || job.status !== 'done' || !job.manifest_json) throw fail('Proxy chưa hoàn tất và xác minh.', 409);
    const media = await promote(job, ownerId);
    return transaction(() => {
      const current = own(ownerId, id); checkRevision(current, request.expectedRevision);
      const { draft, item: target } = locate(current, request.listId, request.itemId);
      if (target.proxy.jobId !== job.id || media.status !== 'ok') throw fail('Proxy không khớp hoặc chưa sẵn sàng.', 409);
      target.proxy.assetId = media.id; target.proxy.contentHash = media.content_hash;
      return write(current, draft);
    });
  }
  function preparedDocument(ownerId, id, { listId, itemId }) {
    const row = own(ownerId, id), { item } = locate(row, listId, itemId), ref = item.sourceRef;
    if (ref.kind !== 'timeline-version') throw fail('Item chưa có công thức đã ghim.');
    return versions.get(ownerId, ref.projectId, ref.versionId).document;
  }
  function addShape(ownerId, id, request) {
    return transaction(() => {
      const row = own(ownerId, id); checkRevision(row, request.expectedRevision);
      const draft = JSON.parse(row.draft_json), list = draft.lists.find(l => l.id === request.listId);
      if (!list || draft.lists.flatMap(l=>l.items).length >= 1000) throw fail('Chọn list có chỗ cho shape.');
      const { type = 'rectangle', width = 160, height = 160, fillColor = '#7755cc' } = request.shape || {};
      if (!['rectangle','ellipse','triangle','star'].includes(type) || !integer(width,2,4096) || !integer(height,2,4096) || !/^#[0-9a-f]{6}$/i.test(fillColor)) throw fail('Shape không hợp lệ.');
      const shape = { ...require('../../shared/video-vector').SHAPE_DEFAULTS, type, width, height, fillColor };
      const component = automation.vectorComponent(ownerId, `Shape · ${type}`, shape), itemId = crypto.randomUUID();
      list.items.push({ id:itemId, sourceRef:{kind:'vector-component',componentVersionId:component.id,contentHash:component.contentHash}, rating:0, manualOrder:list.items.length, enabled:true });
      return { project:write(row,draft), itemId };
    });
  }
  return { create, get, list, save, archive, prepare, capture, preflight, sample, resolveSnapshot, runs, getRun, createRun, renderSelected, manifest, templates, pinTemplate,
    capturePrepared, startProxy, acceptProxy, preparedDocument, verifySources, existingRun, addShape, archiveWithinTransaction, applySpeech };
}

module.exports = { createBatchService };
