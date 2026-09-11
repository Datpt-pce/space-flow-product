import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { planBatch, orderedCandidates, slotCandidates } from '@shared/video-batch-planner';
import { useVideoStore } from '../store';
import { batchRequest } from './batchApi';
import BatchSample from './BatchSample';
import { useDialogFocus } from '../useDialogFocus';
import transitionCatalog from '../../../../shared/video-transition-catalog.json';
import BatchInlineName from './BatchInlineName';

export const BATCH_DRAG = 'application/x-spaceflow-batch';
const state = () => useVideoStore.getState();
const safe = promise => promise.catch(e => useVideoStore.setState({ batchError: e.message }));
const trackKind = track => track.type === 'video' ? track.mediaKind || 'visual' : 'audio';
const acceptsKind = (track, item) => trackKind(track) === 'visual' ? ['image', 'video'].includes(item.kind) : trackKind(track) === item.kind;

function DurationSeconds({ frames, fps, disabled, onChange }) {
  const [input, setInput] = useState(null);
  return <input aria-label="Độ dài block giây" type="number" min={1 / fps} max={3600} step="any"
    value={input ?? Number((frames / fps).toFixed(6))} disabled={disabled}
    onChange={e => {
      setInput(e.target.value);
      const seconds = Number(e.target.value), next = Math.round(seconds * fps);
      if (seconds >= 1 / fps && seconds <= 3600 && Number.isSafeInteger(next)) onChange(next);
    }} onBlur={() => setInput(null)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>;
}

export default function BatchBuilder({ project, blocked, metaFor, activeId, setActiveId, inspectorTarget, nameFor, onRenameList, onCapcut, onCapcutRender }) {
  const preview = useVideoStore(s => s.batchPreview), dirty = useVideoStore(s => s.batchDirty);
  const [matrix, setMatrix] = useState(false), [sample, setSample] = useState(null);
  const [templates, setTemplates] = useState([]);
  const transitionDrag=useRef(null),[dragFrames,setDragFrames]=useState(null);
  const matrixRef=useDialogFocus(()=>setMatrix(false),matrix && !sample);
  useEffect(() => { let active = true; batchRequest('/templates').then(rows => { if (active) setTemplates(rows); }).catch(() => {}); return () => { active = false; }; }, [project?.id]);
  const tracks = project?.draft.tracks || [];
  const lists = project?.draft.lists || [];
  const normalized = lists.map(l => ({ ...l, items: l.items.map(metaFor) }));
  const slots = tracks.flatMap(t => t.slots.map(s => ({ ...s, kind: trackKind(t),...(t.type==='bgm' && t.selectionMode!=='one'?{playlist:true}:{}) })));
  let localPlan, problem;
  try { localPlan = planBatch({ lists: normalized, slots }); } catch (e) { problem = e.message; }
  const activeTrack = tracks.find(t => t.slots.some(s => s.id === activeId)), active = activeTrack?.slots.find(s => s.id === activeId);
  const activeList = lists.find(l => l.id === active?.listId);
  const matchingItems = activeList?.items.filter(i => acceptsKind(activeTrack, metaFor(i))) || [];
  const stale = dirty || preview?.snapshot.revision !== project?.revision;
  const edit = fn => state().batchEdit(p => { p.draft.tracks ||= []; fn(p.draft.tracks); });
  function addTrack(kind) {
    const type = kind === 'image' ? 'video' : kind;
    edit(all => {
      if (all.filter(t => t.type === type).length >= (type === 'bgm' ? 1 : 10)) return;
      const track = { id: crypto.randomUUID(), name: type === 'bgm' ? 'Nhạc nền' : `${kind === 'image' ? 'Ảnh' : kind === 'video' ? 'Video' : 'Audio'} ${all.filter(t => t.type === type && (type !== 'video' || t.mediaKind === kind)).length + 1}`, type, slots: [], ...(type === 'video' ? { mediaKind: kind } : {}), ...(type === 'bgm' ? { policy: 'loop' } : {}) };
      if (kind === 'image') all.unshift(track);
      else if (kind === 'video') {
        const index = all.findIndex(t => t.mediaKind !== 'image');
        all.splice(index < 0 ? all.length : index, 0, track);
      }
      else all.push(track);
      all.sort((a, b) => ['video', 'audio', 'bgm'].indexOf(a.type) - ['video', 'audio', 'bgm'].indexOf(b.type));
    });
  }
  function insert(trackId, listId, beforeId) {
    const id = crypto.randomUUID(), list = normalized.find(l => l.id === listId), track = tracks.find(t => t.id === trackId);
    if (!list || !track) return;
    if (list.items.length && !list.items.some(item => acceptsKind(track, item))) {
      useVideoStore.setState({ batchError: `${track.name}: list không có asset đúng loại track.` }); return;
    }
    const duration = 3000; // Display duration for still images; timed assets use their source window.
    edit(all => {
      const target = all.find(t => t.id === trackId), index = target.slots.findIndex(s => s.id === beforeId);
      target.slots.splice(index < 0 ? target.slots.length : index, 0, { id, listId, vary: false, durationMode: 'source', durationFrames: Math.max(1, Math.floor(duration * project.draft.settings.fps / 1000)) });
    }); setActiveId(id);
  }
  function drop(e, trackId, beforeId) {
    e.preventDefault(); e.stopPropagation(); if (blocked) return;
    let data; try { data = JSON.parse(e.dataTransfer.getData(BATCH_DRAG)); } catch { return; }
    if (data.slotId) {
      if (data.slotId === beforeId) return;
      const source = tracks.find(t => t.slots.some(s => s.id === data.slotId)), target = tracks.find(t => t.id === trackId);
      if (!source || !target) return;
      const slot = source.slots.find(s => s.id === data.slotId), list = normalized.find(l => l.id === slot.listId);
      if ((source.type === 'video') !== (target.type === 'video')
        || (trackKind(source) !== trackKind(target) && ![trackKind(source), trackKind(target)].includes('visual'))
        || trackKind(source) !== trackKind(target) && !slotCandidates(list, { ...slot, kind: trackKind(target) }).length) {
        useVideoStore.setState({ batchError: 'Không chuyển block sang track khác loại nguồn. Hãy dùng track ảnh, video hoặc audio tương ứng.' }); return;
      }
      edit(all => {
        const from = all.find(t => t.id === source.id), to = all.find(t => t.id === trackId);
        const index = from.slots.findIndex(s => s.id === data.slotId), [slot] = from.slots.splice(index, 1);
        const at = to.slots.findIndex(s => s.id === beforeId); to.slots.splice(at < 0 ? to.slots.length : at, 0, slot);
      }); setActiveId(data.slotId);
    } else if (data.listId) insert(trackId, data.listId, beforeId);
  }
  function changeSlot(patch) { edit(all => Object.assign(all.find(t => t.id === activeTrack.id).slots.find(s => s.id === active.id), patch)); }
  function removeSlot(trackId, slotId) {
    edit(all => { const t = all.find(t => t.id === trackId); t.slots = t.slots.filter(s => s.id !== slotId); });
    if (activeId === slotId) setActiveId(null);
  }
  function move(delta) {
    edit(all => { const t = all.find(t => t.id === activeTrack.id), index = t.slots.findIndex(s => s.id === active.id); if (index + delta >= 0 && index + delta < t.slots.length) [t.slots[index], t.slots[index + delta]] = [t.slots[index + delta], t.slots[index]]; });
  }
  function setTransitionFrames(slotId,frames) {edit(all=>{const slot=all.flatMap(t=>t.slots).find(s=>s.id===slotId);slot.transition.durationFrames=frames;});}
  function moveTrack(trackId,delta) {edit(all=>{const index=all.findIndex(t=>t.id===trackId),next=index+delta;if(all[next]?.type===all[index].type)[all[index],all[next]]=[all[next],all[index]];});}
  async function check(offset = 0) { await state().batchSave(); await state().batchPreflight(offset); setMatrix(true); }
  async function showSample(rowIndex) {
    const p = state().batchProject;
    const result = await batchRequest(`/${p.id}/sample`, { expectedRevision: p.revision, rowIndex }); setSample(result.document);
  }
  async function chooseTemplate(value) {
    await state().batchSave();
    const chosen = templates.find(t => t.versionId === value), p = state().batchProject;
    const result = await batchRequest(`/${p.id}/template`, { expectedRevision: p.revision, projectId: chosen?.projectId, versionId: chosen?.versionId || null });
    useVideoStore.setState({ batchProject: result, batchDirty: false, batchPreview: null, batchRunKey: null });
  }
  return <section className="batch-builder" aria-label="Batch Timeline blocks">
    <div className="batch-builder-heading"><div><h2>Batch Timeline</h2><p>Kéo list vào track để xếp công thức · Chọn số lượng để tạo biến thể</p></div>
      <span className="batch-spacer"/><strong>{localPlan ? `${localPlan.totalCount} timeline` : 'Chưa có công thức'}</strong>
      <button disabled={blocked || !localPlan} onClick={() => safe(check())}>Xem ma trận</button>
    </div>
    <div className="batch-builder-toolbar">
      <select aria-label="Template đã ghim" disabled={blocked || !project} value={project?.draft.template?.versionId || ''} onChange={e => safe(chooseTemplate(e.target.value))}><option value="">Công thức tự dựng</option>{templates.map(t => <option key={t.versionId} value={t.versionId}>{t.projectName} · {t.name} · bản {t.seq}</option>)}</select>
      {['image', 'video', 'audio', 'bgm'].map(kind => <button key={kind} disabled={blocked || !project || tracks.filter(t => t.type === (kind === 'image' ? 'video' : kind)).length >= (kind === 'bgm' ? 1 : 10)} onClick={() => addTrack(kind)}><Plus size={14}/>{kind === 'image' ? 'Track ảnh' : kind === 'video' ? 'Track video' : kind === 'audio' ? 'Track audio' : 'Nhạc nền'}</button>)}
      <span className="batch-muted">{tracks.filter(t => t.type === 'video').length}/10 hình · {tracks.filter(t => t.type === 'audio').length}/10 audio</span>
    </div>
    <div className="batch-track-scroll">
      {!tracks.length && <div className="batch-builder-empty">Thêm track ảnh hoặc video, rồi kéo các list từ phía trên vào đây.</div>}
      {tracks.map(track => <div key={track.id} className={`batch-track batch-track-${track.type}`} data-batch-track={track.id}>
        <div className="batch-track-label"><strong>{track.name}</strong>{track.type === 'video'
          ? <select aria-label={`Loại nguồn ${track.name}`} disabled={blocked} value={track.mediaKind || ''} onChange={e => edit(all => { const target = all.find(t => t.id === track.id); if (e.target.value) target.mediaKind = e.target.value; else delete target.mediaKind; })}>
            {!track.mediaKind && <option value="">Video · Ảnh (track cũ)</option>}<option value="image">Chỉ ảnh</option><option value="video">Chỉ video</option>
          </select> : <span>{track.type === 'bgm' ? 'BGM · cuối phần hình' : 'Audio'}</span>}
          <div className="batch-track-actions"><button aria-label={`Đưa ${track.name} lên`} disabled={blocked || tracks[tracks.indexOf(track)-1]?.type!==track.type} onClick={()=>moveTrack(track.id,-1)}>↑</button><button aria-label={`Đưa ${track.name} xuống`} disabled={blocked || tracks[tracks.indexOf(track)+1]?.type!==track.type} onClick={()=>moveTrack(track.id,1)}>↓</button><button aria-label={`Xóa ${track.name}`} disabled={blocked || !!track.slots.length} onClick={() => edit(all => all.splice(all.findIndex(t => t.id === track.id), 1))}><X size={12}/></button></div>
        </div>
        <div className="batch-track-blocks" aria-label={`Thả list vào ${track.name}`} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, track.id)}>
          {track.slots.map((slot, index) => {
            const list = normalized.find(l => l.id === slot.listId);
            let n = 0; try { n = list ? slotCandidates(list, { ...slot, kind: trackKind(track) }).length : 0; } catch { /* Preflight displays invalid selections. */ }
            return <div key={slot.id} className={`batch-block ${slot.fixedItemId ? 'batch-block-fixed' : ''} ${activeId === slot.id ? 'batch-block-active' : ''}`} data-batch-slot={slot.id} draggable={!blocked}
              onDragStart={e => { e.dataTransfer.setData(BATCH_DRAG, JSON.stringify({ slotId: slot.id })); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, track.id, slot.id)}>
              <div className="batch-block-name"><BatchInlineName name={list?.name || 'List đã bỏ'} label={`Chọn block ${index + 1} ${list?.name}`} prefix={<GripVertical size={14}/>} disabled={blocked} onSelect={() => setActiveId(slot.id)} onRename={name => onRenameList(slot.listId, name)}/><button className="batch-remove-name" aria-label={`Xóa block ${index + 1} ${list?.name}`} disabled={blocked} onClick={() => removeSlot(track.id, slot.id)}><X size={13}/></button></div>
              <small className="batch-block-source-kind">{slot.fixedItemId ? 'Asset cố định' : slot.selectedItemIds !== undefined ? `${slot.selectedItemIds.length} asset đã chọn` : 'Cả list'}</small>
              <label className="batch-checkbox"><input type="checkbox" aria-label={`Biến thiên ${slot.id}`} checked={slot.vary && !slot.fixedItemId && !(track.type==='bgm' && track.selectionMode!=='one')} disabled={blocked || !!slot.fixedItemId || track.type==='bgm' && track.selectionMode!=='one'} onChange={e => edit(all => { all.find(t => t.id === track.id).slots.find(s => s.id === slot.id).vary = e.target.checked; })}/><b>{n}</b><span>{track.type==='bgm' && track.selectionMode!=='one'?'bài nối tiếp':'Biến thiên'}</span></label>
              {slot.transition && <div role="slider" tabIndex={blocked?-1:0} aria-label={`Độ dài transition sau block ${index+1}`} aria-valuemin={1} aria-valuemax={project.draft.settings.fps*60} aria-valuenow={dragFrames?.id===slot.id?dragFrames.frames:slot.transition.durationFrames} className="batch-transition-handle" draggable={false}
                onPointerDown={e=>{e.preventDefault();e.stopPropagation();if(blocked)return;e.currentTarget.setPointerCapture(e.pointerId);transitionDrag.current={id:slot.id,x:e.clientX,frames:slot.transition.durationFrames};}}
                onPointerMove={e=>{const drag=transitionDrag.current;if(drag?.id===slot.id)setDragFrames({id:slot.id,frames:Math.max(1,Math.min(project.draft.settings.fps*60,drag.frames+Math.round(e.clientX-drag.x)))});}}
                onPointerUp={()=>{if(transitionDrag.current?.id===slot.id && dragFrames?.id===slot.id)setTransitionFrames(slot.id,dragFrames.frames);transitionDrag.current=null;setDragFrames(null);}}
                onPointerCancel={()=>{transitionDrag.current=null;setDragFrames(null);}}
                onKeyDown={e=>{if(!blocked && ['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setTransitionFrames(slot.id,Math.max(1,Math.min(project.draft.settings.fps*60,slot.transition.durationFrames+(e.key==='ArrowRight'?1:-1))));}}}>
                {slot.transition.type} · {dragFrames?.id===slot.id?dragFrames.frames:slot.transition.durationFrames}f ↔
              </div>}
            </div>;
          })}
          <div className="batch-drop-hint"><span>Kéo list vào đây</span><select aria-label={`Thêm list vào ${track.name}`} disabled={blocked} value="" onChange={e => insert(track.id, e.target.value)}><option value="">+ Chọn list</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        </div>
      </div>)}
    </div>
    {active && inspectorTarget ? createPortal(<div className="batch-slot-controls" aria-label="Thuộc tính block">
      <div className="batch-block-name"><BatchInlineName key={active.listId} name={activeList.name} label="Tên list của block" disabled={blocked} onRename={name => onRenameList(active.listId, name)}/><button className="batch-remove-name" aria-label="Xóa block đang chọn" disabled={blocked} onClick={() => removeSlot(activeTrack.id, active.id)}><X size={14}/></button></div>
      <label>List<select aria-label="List của block" disabled={blocked} value={active.listId} onChange={e => changeSlot({ listId: e.target.value, fixedItemId: undefined, selectedItemIds: undefined })}>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>Nguồn<select aria-label="Nguồn block" disabled={blocked} value={active.selectedItemIds !== undefined ? 'subset' : active.fixedItemId ? `item:${active.fixedItemId}` : ''} onChange={e => {
        const value = e.target.value;
        changeSlot(value === 'subset' ? { fixedItemId: undefined, selectedItemIds: active.fixedItemId ? [active.fixedItemId] : matchingItems.map(i => i.id) }
          : { selectedItemIds: undefined, fixedItemId: value ? value.slice(5) : undefined, ...(value ? { vary: false } : {}) });
      }}><option value="">Cả list</option><option value="subset">Chọn nhiều asset</option>{activeList.items.map(i => <option key={i.id} value={`item:${i.id}`} disabled={!acceptsKind(activeTrack, metaFor(i))}>{nameFor(i)}</option>)}</select></label>
      {active.selectedItemIds !== undefined && <fieldset className="batch-source-subset" aria-label="Nhóm asset của block"><legend>{active.selectedItemIds.length}/{activeList.items.length} asset đã chọn</legend>
        <div className="batch-inline"><button disabled={blocked} onClick={() => changeSlot({ selectedItemIds: matchingItems.map(i => i.id) })}>Chọn tất cả asset</button><button disabled={blocked} onClick={() => changeSlot({ selectedItemIds: [] })}>Bỏ chọn tất cả</button></div>
        <div className="batch-source-checks">{activeList.items.map(i => { const meta = metaFor(i), eligible = orderedCandidates({ ...activeList, items: [meta] }, trackKind(activeTrack)).length > 0;
          return <label key={i.id} className="batch-checkbox"><input type="checkbox" aria-label={`Dùng asset ${nameFor(i)}`} disabled={blocked || (!acceptsKind(activeTrack, meta) && !active.selectedItemIds.includes(i.id))} checked={active.selectedItemIds.includes(i.id)} onChange={e => changeSlot({ selectedItemIds: e.target.checked ? [...active.selectedItemIds, i.id] : active.selectedItemIds.filter(id => id !== i.id) })}/><span>{nameFor(i)}{!eligible && <small> · Không dùng sau filter/loại nguồn</small>}</span></label>;
        })}</div>
        {!active.selectedItemIds.length && <p role="alert">Chọn ít nhất một asset để tạo batch.</p>}
      </fieldset>}
      {activeTrack.type !== 'bgm' && activeTrack.mediaKind !== 'image' && !project.draft.template?.bindings[active.id] && <label>Thời lượng asset<select aria-label={activeTrack.type === 'video' ? 'Thời lượng video của block' : 'Thời lượng audio của block'} disabled={blocked} value={active.durationMode || (activeTrack.type === 'video' ? 'source' : 'fixed')} onChange={e => changeSlot({ durationMode: e.target.value })}><option value="source">Giữ thời lượng từng asset</option><option value="fixed">Độ dài cố định</option></select></label>}
      {activeTrack.type !== 'bgm' && (['image', 'visual'].includes(trackKind(activeTrack)) || active.durationMode === 'fixed' || activeTrack.type === 'audio' && active.durationMode !== 'source' || project.draft.template?.bindings[active.id]) && <>
        <label className="batch-duration-control">{activeTrack.mediaKind === 'image' || activeTrack.type === 'video' && active.durationMode !== 'fixed' && !project.draft.template?.bindings[active.id] ? 'Độ dài mỗi ảnh (giây)' : 'Độ dài mỗi asset (giây)'}<DurationSeconds key={active.id} frames={active.durationFrames} fps={project.draft.settings.fps} disabled={blocked} onChange={durationFrames => changeSlot({ durationFrames })}/></label>
        <p className="batch-muted batch-duration-help">{activeTrack.type === 'video' && active.durationMode !== 'fixed' && !project.draft.template?.bindings[active.id]
          ? activeTrack.mediaKind === 'image' ? 'Áp dụng thời lượng này cho từng ảnh trong block.' : 'Ảnh tĩnh dùng thời lượng này; video giữ độ dài riêng.'
          : 'Áp dụng cho từng asset trong list của block này. Video/audio cần dài ít nhất bằng thời lượng đã nhập.'}</p>
      </>}
      {activeTrack.mediaKind !== 'image' && <>{['fadeInFrames', 'fadeOutFrames'].map((key, i) => <label key={key}>{i ? 'Fade ra' : 'Fade vào'} (frame)<input aria-label={i ? 'Fade ra frame' : 'Fade vào frame'} type="number" min={0} placeholder="Tự động" value={active[key] ?? ''} disabled={blocked} onChange={e => changeSlot({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })}/></label>)}
      <label>Âm lượng<input aria-label="Âm lượng block" type="number" min={0} max={10} step={0.1} value={active.volume ?? 1} disabled={blocked} onChange={e => changeSlot({volume:Number(e.target.value)})}/></label>
      {activeTrack.type === 'video' && <label className="batch-checkbox"><input type="checkbox" disabled={blocked} checked={!!active.muteSourceAudio} onChange={e => changeSlot({ muteSourceAudio: e.target.checked })}/>Tắt tiếng nguồn</label>}</>}
      {activeTrack.type === 'video' && <><label>Chuyển sang block sau<select aria-label="Transition sau block" disabled={blocked} value={active.transition?.type || ''} onChange={e => changeSlot({ transition: e.target.value ? { type:e.target.value, durationFrames:Math.max(1,Math.round(project.draft.settings.fps/2)) } : undefined })}><option value="">Không</option>{transitionCatalog.map(t => <option key={t.type} value={t.type}>{t.name}</option>)}</select></label>
        {active.transition && <label>Transition (frame)<input aria-label="Transition frame" type="number" min={1} step={1} disabled={blocked} value={active.transition.durationFrames} onChange={e => changeSlot({ transition:{...active.transition,durationFrames:Number(e.target.value)} })}/></label>}
      </>}
      {activeTrack.type === 'bgm' && <><label>Chọn nhạc<select aria-label="Chế độ chọn BGM" disabled={blocked} value={activeTrack.selectionMode || 'playlist'} onChange={e => edit(all => { all.find(t => t.id === activeTrack.id).selectionMode = e.target.value; })}><option value="playlist">Playlist theo block</option><option value="one">Một bài / output</option></select></label><label>Đủ phần hình<select disabled={blocked} value={activeTrack.policy || 'loop'} onChange={e => edit(all => { all.find(t => t.id === activeTrack.id).policy = e.target.value; })}><option value="loop">Lặp lại khi thiếu</option><option value="trim">Chỉ cắt phần dư</option></select></label></>}
      <button aria-label="Dời block trái" disabled={blocked} onClick={() => move(-1)}><ChevronLeft size={15}/></button><button aria-label="Dời block phải" disabled={blocked} onClick={() => move(1)}><ChevronRight size={15}/></button>
      <button disabled={blocked} onClick={() => removeSlot(activeTrack.id, active.id)}>Bỏ block</button>
    </div>, inspectorTarget) : <p className="batch-builder-note">{problem || (localPlan?.axes.some(a => a.vary) ? 'Các list không chọn Biến thiên sẽ lần lượt quay vòng theo output.' : 'Chưa chọn Biến thiên: tạo một bản thử từ item ưu tiên của mỗi list.')}</p>}
    {matrix && preview && <div className="batch-dialog-backdrop"><section ref={matrixRef} role="dialog" aria-modal="true" aria-label="Ma trận batch" className="batch-dialog batch-matrix">
      <div className="batch-section-heading"><h2>Ma trận · {preview.totalCount} timeline</h2><button autoFocus onClick={() => setMatrix(false)}>Đóng ma trận</button></div>
      {stale && <p role="alert">Công thức đã thay đổi. Kiểm tra lại trước khi tạo.</p>}
      {!!preview.issues.length && <div role="alert">{preview.issues.slice(0, 5).map((i, n) => <p key={n}>#{i.rowIndex + 1}: {i.message}</p>)}</div>}
      {!!preview.warnings.length && <p className="batch-muted">{preview.warnings.length} item chưa được dùng; bật Biến thiên ở list tương ứng để dùng hết.</p>}
      <div className="batch-table-scroll"><table><thead><tr><th>#</th>{preview.axes.map(a => <th key={a.slotId}>{lists.find(l => l.id === slots.find(s => s.id === a.slotId)?.listId)?.name}</th>)}<th>Frame</th><th>Kiểm tra</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.rowIndex}><td>{row.rowIndex + 1}</td>{row.assignments.map(a => <td key={a.slotId} title={a.playlistItemIds?.map(id=>project.media[id]?.name || id).join(' → ')}>{a.playlistItemIds ? `Playlist · ${a.playlistItemIds.length} bài` : project.media[a.itemId]?.name || a.itemId}</td>)}<td>{row.durationFrames || '—'}</td><td><button disabled={stale || row.issues.length > 0 || blocked} onClick={() => safe(showSample(row.rowIndex))}>Xem thử</button></td></tr>)}</tbody></table></div>
      <div className="batch-toolbar"><button disabled={blocked || preview.rows[0]?.rowIndex < 20} onClick={() => safe(check(preview.rows[0].rowIndex - 20))}>Trang trước</button><button disabled={blocked || preview.rows.at(-1)?.rowIndex >= preview.totalCount - 1} onClick={() => safe(check(preview.rows[0].rowIndex + 20))}>Trang sau</button><span className="batch-spacer"/>
        <button disabled={blocked} onClick={() => safe(check())}>Kiểm tra lại</button><button disabled={blocked || stale || !!preview.issues.length} onClick={() => { setMatrix(false); onCapcut(); }}>Convert to CapCut project</button><button disabled={blocked} onClick={() => { setMatrix(false); onCapcutRender(); }}>Render CapCut</button><button className="batch-primary" disabled={blocked || stale || !!preview.issues.length} onClick={() => safe(state().batchGenerate().then(() => setMatrix(false)))}>Tạo {preview.totalCount} timeline</button>
      </div>
    </section></div>}
    {sample && <BatchSample document={sample} onClose={() => setSample(null)}/>}
  </section>;
}
