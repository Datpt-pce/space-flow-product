const { assertAllInvariants } = require('../../shared/video-commands/invariants');
const { compileComposition } = require('./compositionCompiler');
const { digest } = require('./versionService');
const { expandPrepared } = require('./batchPrepared');
const { slotCandidates } = require('../../shared/video-batch-planner');

// Resolve integer frame positions once; the resulting native document is also
// the input to the existing composition compiler and editor preview.
function compileBatchRow(snapshot, row) {
  const { settings, tracks } = snapshot.draft;
  const ms = frame => frame * 1000 / settings.fps;
  const document = { schemaVersion: 1, resolution: { width: settings.width, height: settings.height }, fps: settings.fps,
    colorSpace: snapshot.template?.colorSpace || 'sRGB', audioRate: snapshot.template?.audioRate || 48000, sequence: { markers: [], transitionTiming: 'centered-v1' }, transitions: [], tracks: [] };
  const items = Object.fromEntries(snapshot.lists.flatMap(l => l.items).map(i => [i.id, i]));
  const assignments = Object.fromEntries(row.assignments.map(a => [a.slotId, a.itemId]));
  let visualEnd = 0;
  const pendingPrepared = [], origins = {};
  const clipFor = (slot, start, frames, item, suffix = '') => {
    const templateId = snapshot.draft.template?.bindings[slot.id];
    const original = snapshot.template?.tracks.flatMap(t => t.clips).find(c => c.id === templateId);
    origins[`${slot.id}${suffix}`] = { slotId:slot.id, itemId: item.id, sourceRef: item.sourceRef };
    if (item.sourceRef.kind === 'vector-component') return { ...structuredClone(snapshot.vectors[item.id]), id:`${slot.id}${suffix}`, sourceInMs:0, sourceOutMs:ms(frames), timelineInMs:ms(start), timelineOutMs:ms(start+frames), speed:1,
      transform:original?.transform || {x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1}, effects:original?.effects || [], keyframes:original?.keyframes || [] };
    if (item.sourceRef.kind === 'timeline-version') {
      if (item.proxy?.assetId) {
        const clip = clipFor(slot, start, frames, { ...item, sourceRef: { kind:'media', assetId:item.proxy.assetId, contentHash:item.proxy.contentHash } }, suffix);
        origins[clip.id] = { slotId:slot.id, itemId:item.id, sourceRef:item.sourceRef, proxy:item.proxy }; return clip;
      }
      pendingPrepared.push({ slot, item, clipId: `${slot.id}${suffix}` });
      return { ...(original ? structuredClone(original) : {}), id: `${slot.id}${suffix}`, assetId:undefined, sourceInMs:0, sourceOutMs:ms(frames), timelineInMs:ms(start), timelineOutMs:ms(start + frames), speed:1,
        compoundRef: { ...item.sourceRef }, transform:original?.transform || {x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1}, effects:original?.effects || [], keyframes:original?.keyframes || [] };
    }
    const asset = snapshot.assets[item.sourceRef.assetId];
    const sourceInMs = item.sourceRef.trim?.sourceInMs ?? original?.sourceInMs ?? 0;
    const available = item.sourceRef.trim?.sourceOutMs ?? asset.duration_ms;
    if (asset.kind !== 'image' && sourceInMs + ms(frames) > available + .01) throw new Error(`Block ${slot.id}: ${item.name} quá ngắn (${row.rowIndex + 1}).`);
    const fade = Math.min(Math.round(settings.fps / 2), Math.floor(frames / 2));
    const fadeIn = slot.fadeInFrames ?? (original?.audioFadeInMs !== undefined ? Math.round(original.audioFadeInMs / ms(1)) : fade);
    const fadeOut = slot.fadeOutFrames ?? (original?.audioFadeOutMs !== undefined ? Math.round(original.audioFadeOutMs / ms(1)) : fade);
    if (fadeIn + fadeOut > frames) throw new Error(`Block ${slot.id}: tổng fade vượt thời lượng.`);
    return { ...(original ? structuredClone(original) : {}), id: `${slot.id}${suffix}`, assetId: asset.id, sourceInMs, sourceOutMs: sourceInMs + ms(frames),
      timelineInMs: ms(start), timelineOutMs: ms(start + frames), speed: 1,
      transform: original?.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: original?.effects || [], keyframes: original?.keyframes || [],
      volume: slot.muteSourceAudio ? 0 : slot.volume ?? original?.volume ?? 1, audioFadeInMs: ms(fadeIn), audioFadeOutMs: ms(fadeOut) };
  };
  for (const track of tracks.filter(t => t.type !== 'bgm')) {
    let cursor = 0;
    const clips = track.slots.map(slot => {
      const item = items[assignments[slot.id]];
      let frames = slot.durationFrames;
      if ((track.type === 'video' ? slot.durationMode !== 'fixed' : slot.durationMode === 'source') && item.kind !== 'image'
        && !snapshot.draft.template?.bindings[slot.id]) {
        const asset = snapshot.assets[item.proxy?.assetId || item.sourceRef.assetId];
        const prepared = snapshot.prepared?.[item.id];
        const duration = (item.sourceRef.trim?.sourceOutMs ?? asset?.duration_ms
          ?? (prepared && Math.max(0, ...prepared.tracks.flatMap(t => t.clips.map(c => c.timelineOutMs)))))
          - (item.sourceRef.trim?.sourceInMs ?? 0);
        // Keep each assignment's source window, aligned to complete output frames.
        frames = Math.floor((duration + .001) * settings.fps / 1000);
        if (!Number.isSafeInteger(frames) || frames < 1) throw new Error(`Block ${slot.id}: ${item.name} không đủ một frame.`);
      }
      const clip = clipFor(slot, cursor, frames, item);
      cursor += frames; return clip;
    });
    if (track.type === 'video') visualEnd = Math.max(visualEnd, cursor);
    if (clips.length) document.tracks.push({ id: track.id, name: track.name, type: track.type, order: document.tracks.length, locked: false, muted: false, visible: true, clips });
  }
  if (!visualEnd) throw new Error('Công thức cần ít nhất một block hình.');
  if (document.tracks.some(t => t.type === 'audio' && t.clips.some(c => c.timelineOutMs > ms(visualEnd) + .01))) throw new Error('Audio thường dài hơn phần hình. Giảm thời lượng block audio.');
  for (const track of tracks.filter(t => t.type === 'bgm' && t.slots.length)) {
    if (track.selectionMode === 'one' && track.slots.length !== 1) throw new Error('Chế độ một bài/output cần đúng một block list nhạc.');
    const clips = [];
    const playlist=track.selectionMode==='one' ? track.slots.map(slot=>({slot,item:items[assignments[slot.id]]}))
      : track.slots.flatMap(slot=>slotCandidates(snapshot.lists.find(l=>l.id===slot.listId), {...slot, kind:'audio'}).map(item=>({slot,item})));
    if(!playlist.length) throw new Error('Playlist nhạc nền không có item sẵn sàng.');
    let cursor = 0, index = 0;
    while (cursor < visualEnd) {
      if (index >= playlist.length && track.policy !== 'loop') throw new Error('Nhạc nền ngắn hơn phần hình. Chọn Loop hoặc thêm bài.');
      const {slot,item} = playlist[index % playlist.length];
      const asset = snapshot.assets[item.proxy?.assetId || item.sourceRef.assetId];
      const preparedDuration = snapshot.prepared?.[item.id] && Math.max(0, ...snapshot.prepared[item.id].tracks.flatMap(t => t.clips.map(c => c.timelineOutMs)));
      const available = Math.floor(((item.sourceRef.trim?.sourceOutMs ?? asset?.duration_ms ?? preparedDuration) - (item.sourceRef.trim?.sourceInMs || 0)) * settings.fps / 1000);
      if (available < 1) throw new Error('Nhạc nền không đủ một frame.');
      const frames = Math.min(available, visualEnd - cursor);
      clips.push(clipFor(slot, cursor, frames, item, `-bgm-${index}`)); cursor += frames; index++;
      if (index > 1000) throw new Error('Nhạc nền cần quá nhiều đoạn loop.');
    }
    document.tracks.push({ id: track.id, name: track.name, type: 'audio', order: document.tracks.length, locked: false, muted: false, visible: true, clips });
  }
  // Builder is foreground-first, matching the editor's descending native order.
  document.tracks.forEach((t, i) => { t.order = document.tracks.length - i; });
  const expandedLanes = new Map();
  for (const pending of pendingPrepared) {
    const parentTrack = document.tracks.find(t => t.clips.some(c => c.id === pending.clipId));
    const prepared = snapshot.prepared[pending.item.id];
    const result = expandPrepared(document, parentTrack.id, pending.clipId, prepared, pending.slot, ms(1));
    parentTrack.clips = parentTrack.clips.filter(c => c.id !== pending.clipId);
    let visualRank = 0, audioRank = 0;
    for (const nested of [...result.newTracks].sort((a,b) => b.order - a.order)) {
      if (nested.visible === false) continue;
      const audio = nested.type === 'audio', rank = audio ? audioRank++ : visualRank++;
      if (parentTrack.type === 'audio' && !audio) throw new Error('Không đặt prepared có hình vào track audio.');
      for (const clip of nested.clips) {
        if (nested.muted) clip.volume = 0;
        origins[clip.id] = { slotId:pending.slot.id, itemId:pending.item.id, sourceRef:pending.item.sourceRef };
      }
      if (rank === 0 && ((parentTrack.type === 'audio') === audio)) parentTrack.clips.push(...nested.clips);
      else {
        const key = `${parentTrack.id}-${audio ? 'audio' : 'visual'}-${rank}`;
        let lane = expandedLanes.get(key);
        if (!lane) { lane = { id:key, type:audio?'audio':'video', name:`${parentTrack.name} · ${audio?'Audio':'Hình'} ${rank+1}`, order:parentTrack.order - (rank+1)/100,
          locked:false, muted:false, visible:true, clips:[] }; expandedLanes.set(key, lane); }
        lane.clips.push(...nested.clips);
      }
    }
  }
  document.tracks.push(...expandedLanes.values());
  require('../../shared/video-speech').applySpeechTracks(document, items, origins);
  const bgmIds = new Set(tracks.filter(t => t.type === 'bgm').map(t => t.id));
  document.tracks = document.tracks.filter(t => t.clips.length).sort((a,b) => Number(bgmIds.has(a.id)) - Number(bgmIds.has(b.id)) || Number(a.type === 'audio') - Number(b.type === 'audio') || b.order - a.order);
  document.tracks.forEach((t,i) => { t.order = document.tracks.length - i; t.clips.sort((a,b) => a.timelineInMs - b.timelineInMs); });
  for (const track of tracks.filter(t=>t.type === 'video')) for (const [index, slot] of track.slots.entries()) {
    if (!slot.transition) continue;
    const next = track.slots[index + 1];
    if (!next) throw new Error(`Block ${slot.id}: transition cần một block ngay sau.`);
    const native = document.tracks.find(t=>t.id === track.id);
    const from = native?.clips.filter(c=>origins[c.id]?.slotId === slot.id).at(-1);
    const to = native?.clips.find(c=>origins[c.id]?.slotId === next.id);
    if (!from || !to || Math.abs(from.timelineOutMs - to.timelineInMs) > .001) throw new Error('Transition cần hai clip hình liền nhau trên cùng track sau khi bung prepared.');
    document.transitions.push({ id:`transition-${slot.id}`, fromClipId:from.id, toClipId:to.id, type:slot.transition.type,
      durationMs:ms(slot.transition.durationFrames), timingMode:'centered-v1' });
  }
  if (document.tracks.filter(t => !['audio', 'caption'].includes(t.type)).length > 10 || document.tracks.filter(t => t.type === 'audio' && !bgmIds.has(t.id)).length > 20) throw new Error('Prepared sau khi bung vượt số track hỗ trợ. Giảm track hoặc tạo proxy.');
  assertAllInvariants(document);
  const slots = document.tracks.flatMap(t => t.clips.map(c => ({ clipId: c.id, trackId: t.id, trackType: t.type, label: `${t.name} · ${c.id}` })));
  const recipe = { id: 'batch-recipe', payload: { document, slots } }; recipe.contentHash = digest(recipe.payload);
  const components = {}, bindings = {};
  for (const track of document.tracks) for (const clip of track.clips) {
    const id = `component-${clip.id}`, payload = { schemaVersion: 1, trackType: track.type, clip, assetHash: snapshot.assets[clip.assetId]?.content_hash || null };
    components[id] = { id, payload, contentHash: digest(payload) }; bindings[clip.id] = id;
  }
  const creative = { id: 'batch-creative', payload: { recipeVersionId: recipe.id, components: bindings } }; creative.contentHash = digest(creative.payload);
  return { ...compileComposition(recipe, creative, components, snapshot.assets), durationFrames: visualEnd, origins };
}
module.exports = { compileBatchRow };
