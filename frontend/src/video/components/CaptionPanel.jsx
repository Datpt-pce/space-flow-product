import { useEffect, useState } from 'react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';
import { splitCaptionCues } from '@shared/video-speech';
import CaptionStyleControls from './CaptionStyleControls.jsx';

// Text remains per cue. Formatting and automatic splits form one undoable edit.
export default function CaptionPanel() {
  const state=useVideoStore(s=>s.projectState), ids=useVideoStore(s=>s.selectedIds), execute=useVideoStore(s=>s.execute);
  const targets=state ? ids.map(id=>findClipLocation(state,id)).filter(t=>t?.track.type === 'caption') : [];
  const target=targets[0], clip=target?.clip;
  const [draft,setDraft]=useState(clip?.text?.content || ''), [applyAll,setApplyAll]=useState(true), [error,setError]=useState('');
  useEffect(()=>{ setDraft(clip?.text?.content || ''); },[clip?.id,clip?.text?.content]);
  if (!target) return <p className="p-3 text-xs">Chọn captions để chỉnh nội dung hoặc kiểu chữ.</p>;
  const edit=(patch,contentOnly=false) => {
    try {
      const changes=[];
      state.tracks.forEach(track=>{
        if (track.type !== 'caption' || track.locked) return;
        let changed=false;
        const clips=track.clips.flatMap(c=>{
          if (!(contentOnly ? c.id === clip.id : applyAll || ids.includes(c.id))) return [c];
          if (Object.entries(patch).every(([key,value])=>Object.is(c.text?.[key],value))) return [c];
          changed=true;
          const text={ ...c.text,...patch,...(contentOnly ? { words:[] } : {}) };
          const parts=splitCaptionCues([{ id:c.id,content:text.content,startMs:c.timelineInMs,endMs:c.timelineOutMs,words:text.words || [] }],{ ...state.resolution,fps:state.fps },text);
          return parts.map((part,i)=>({ ...c,id:i ? crypto.randomUUID() : c.id,sourceInMs:0,sourceOutMs:part.endMs-part.startMs,
            timelineInMs:part.startMs,timelineOutMs:part.endMs,text:{ ...text,content:part.content,words:part.words } }));
        });
        if(changed) changes.push({ trackId:track.id,from:track.clips,to:clips });
      });
      if(changes.length) execute('ReplaceCaptionClips',{ changes });
      setError('');
    } catch(e) { setError(e.message); }
  };
  return <div className="w-full h-full overflow-y-auto border-l border-[var(--card-border)] p-3 space-y-3 text-xs">
    {target.track.locked && <p>Track đang khóa. Mở khóa để chỉnh captions này.</p>}
    {error && <p role="alert">{error}</p>}
    {targets.length === 1 ? <>
      <p>{Math.round(clip.timelineInMs)}ms → {Math.round(clip.timelineOutMs)}ms</p>
      <label className="block">Nội dung phụ đề<textarea id="caption-content" aria-label="Nội dung phụ đề" value={draft} disabled={target.track.locked}
        onChange={e=>setDraft(e.target.value)} onBlur={()=>edit({ content:draft },true)} rows={4}
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-2"/></label>
    </> : <p>Đang chọn {targets.length} captions.</p>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={applyAll} onChange={e=>setApplyAll(e.target.checked)}/>Áp dụng kiểu cho tất cả captions (bỏ qua track khóa)</label>
    <CaptionStyleControls timeline style={clip.text || {}} onChange={patch=>edit(patch)} disabled={!applyAll && targets.every(t=>t.track.locked)}/>
    <p>Câu dài tự chia thành nhiều clip liên tiếp, tối đa hai dòng trong safe zone.</p>
  </div>;
}
