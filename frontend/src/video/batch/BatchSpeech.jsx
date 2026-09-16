import { useEffect, useRef, useState } from 'react';
import { X, Play, Plus, Scissors, Trash2, Download, Mic, Captions } from 'lucide-react';
import { useVideoStore } from '../store';
import { useDialogFocus } from '../useDialogFocus';
import { previewUrl } from '../../lib/api';
import { formatSrt, formatVtt } from '../subtitleFormat';
import { batchRequest } from './batchApi';
import { validateSpeech, splitCaptionCues } from '@shared/video-speech';
import CaptionStyleControls from '../components/CaptionStyleControls';
import CaptionGraphic from '../components/CaptionGraphic';

const label = speaker => speaker === 'unknown' ? 'Chưa rõ giọng' : speaker.replace('speaker-', 'Người nói ');
export default function BatchSpeech({ project, item, asset, onClose }) {
  const key = `${project.id}:${item.id}`, sourceHash = item.proxy?.contentHash || item.sourceRef.contentHash;
  const draft = useVideoStore(s => s.batchSpeechDrafts[key]);
  const assets = useVideoStore(s => s.assets), referenceId = useVideoStore(s => s.batchVoiceReference);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [language, setLanguage] = useState('auto');
  const [playhead, setPlayhead] = useState(0), [selected, setSelected] = useState(null);
  const [referenceStart, setReferenceStart] = useState(0), [referenceEnd, setReferenceEnd] = useState(10);
  const player = useRef(null), convertedPlayer = useRef(null), stopAt = useRef(null);
  const ref = useDialogFocus(onClose);
  const update = fn => useVideoStore.setState(s => {
    const value = structuredClone(s.batchSpeechDrafts[key]);
    if (!value) return {};
    fn(value); return { batchSpeechDrafts:{ ...s.batchSpeechDrafts, [key]:value } };
  });
  const style = draft?.style || { preset:'outline', fontSize:Math.max(24, Math.round(Math.min(project.draft.settings.width,project.draft.settings.height)*.044)) };
  const cues = draft?.cues || [], running = ['queued', 'running'].includes(draft?.job?.status), disabled = busy || running;
  const reference = assets.find(a => a.id === referenceId);
  const durationMs = project.media[item.id]?.durationMs || asset.durationMs;
  const sourcePath = project.media[item.id]?.speechSourcePath || asset.sourcePath;
  const speakers = [...new Set(cues.map(c => c.speaker))];
  const active = cues.find(c => playhead >= c.startMs && playhead < c.endMs);
  const applyResult = (result, task) => update(d => {
    d.job = { ...result, task };
    if (result.status !== 'completed') return;
    if (task === 'analyze') { d.cues = splitCaptionCues(result.cues,project.draft.settings,d.style); d.conversionJobId = null; d.outputPath = null; d.warnings = result.warnings; }
    else { if (!d.cues.length && result.speech) { d.cues = result.speech.cues; d.style = result.speech.style; } d.conversionJobId = result.id; d.outputPath = result.outputPath; }
  });
  useEffect(() => {
    const state = useVideoStore.getState();
    if (!state.batchSpeechDrafts[key] || state.batchSpeechDrafts[key].sourceHash !== sourceHash) {
      useVideoStore.setState({ batchSpeechDrafts:{ ...state.batchSpeechDrafts, [key]:{
        sourceHash, cues:structuredClone(item.speech?.cues || []), style:item.speech?.style || style,
        conversionJobId:item.speech?.conversionJobId || null,
      } } });
    }
    let alive = true;
    batchRequest(`/${project.id}/speech?itemId=${encodeURIComponent(item.id)}`).then(jobs => {
      if (!alive || !jobs.length) return;
      const latest = jobs[0], current = useVideoStore.getState().batchSpeechDrafts[key];
      if (['running', 'queued'].includes(latest.status)) update(d => {
        d.job = latest;
        if (latest.task === 'convert' && latest.speech) { d.cues = latest.speech.cues; d.style = latest.speech.style; }
      });
      else if (!current.cues.length && latest.task === 'analyze' && latest.status === 'completed') applyResult(latest, 'analyze');
      else if (!current.cues.length && latest.task === 'convert' && latest.status === 'completed') applyResult(latest, 'convert');
      else if (current.conversionJobId) {
        const previous = jobs.find(j => j.id === current.conversionJobId && j.status === 'completed');
        if (previous) update(d => { d.outputPath = previous.outputPath; });
      }
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return;
    let alive = true, timer;
    const poll = async () => {
      try {
        const result = await batchRequest(`/${project.id}/speech/${draft.job.id}`);
        if (!alive) return;
        setError('');
        applyResult(result, draft.job.task);
        if (['queued', 'running'].includes(result.status)) timer = setTimeout(poll, 1500);
      } catch (e) { if (alive) { setError(e.message); timer = setTimeout(poll, 5000); } }
    };
    timer = setTimeout(poll, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [draft?.job?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const attempt = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const speech = () => validateSpeech({ cues:splitCaptionCues(cues,project.draft.settings,style), style }, durationMs);
  const changeStyle = patch => {
    try { const next={ ...style,...patch }, parts=splitCaptionCues(cues,project.draft.settings,next);update(d=>{ d.style=next;d.cues=parts; });setError(''); }
    catch(e) { setError(e.message); }
  };
  const start = task => attempt(async () => {
    const payload = { expectedRevision:project.revision, itemId:item.id, task, language };
    if (task === 'convert') Object.assign(payload, { speech:speech(), referenceAssetId:referenceId, referenceStartMs:referenceStart*1000,
      referenceEndMs:Math.min(referenceEnd*1000, reference?.durationMs || Infinity) });
    const job = await batchRequest(`/${project.id}/speech`, payload);
    update(d => { d.job = { ...job, task }; });
  });
  const editCue = (id, patch, changesAudio = false) => update(d => {
    const cue = d.cues.find(c => c.id === id); Object.assign(cue, patch);
    if ('content' in patch || changesAudio) cue.words = [];
    if (changesAudio) { d.conversionJobId = null; d.outputPath = null; }
  });
  const setAction = (speaker, action) => update(d => {
    d.cues.forEach(c => { if (!speaker || c.speaker === speaker) c.action = action; });
    d.conversionJobId = null; d.outputPath = null;
  });
  const listen = (cue, converted = false) => {
    player.current?.pause(); convertedPlayer.current?.pause();
    const target = converted ? convertedPlayer.current : player.current;
    if (!target) return;
    target.currentTime = cue.startMs/1000; stopAt.current = cue.endMs/1000;
    setSelected(cue.id); target.play().catch(e => setError(e.message));
  };
  const timeUpdate = event => {
    setPlayhead(event.currentTarget.currentTime*1000);
    if (stopAt.current != null && event.currentTarget.currentTime >= stopAt.current) { event.currentTarget.pause(); stopAt.current = null; }
  };
  const download = type => {
    const blob = new Blob([type === 'srt' ? formatSrt(speech().cues) : formatVtt(speech().cues)], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `captions.${type}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const save = () => attempt(async () => {
    await useVideoStore.getState().batchApplySpeech({ itemId:item.id, sourceHash, speech:speech(), conversionJobId:draft.conversionJobId });
    await useVideoStore.getState().fetchAssets(); onClose();
  });
  return <div className="batch-dialog-backdrop"><section className="batch-dialog batch-speech" role="dialog" aria-modal="true" aria-label="Voice & captions" ref={ref}>
    <div className="batch-section-heading"><div><h2><Captions size={20}/> Voice &amp; captions</h2><p className="batch-muted">{asset.name || sourcePath?.split(/[\\/]/).pop()} · Áp dụng cho mọi timeline dùng nguồn này</p></div><button onClick={onClose} aria-label="Đóng Voice & captions"><X size={18}/></button></div>
    <div className="batch-toolbar"><label>Ngôn ngữ<select aria-label="Ngôn ngữ lời nói" value={language} onChange={e => setLanguage(e.target.value)} disabled={disabled}>{[['auto','Tự nhận diện'],['vi','Tiếng Việt'],['en','English'],['zh','中文'],['ja','日本語'],['ko','한국어'],['th','ไทย']].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <button className="batch-primary" disabled={disabled} onClick={() => start('analyze')}><Captions size={15}/>{cues.length ? 'Phân tích lại lời nói' : 'Tạo captions tự động'}</button>
      {!!cues.length && <><button disabled={disabled} onClick={() => download('srt')}><Download size={14}/> SRT</button><button disabled={disabled} onClick={() => download('vtt')}>VTT</button></>}
    </div>
    {(error || draft?.job?.error) && <p role="alert">{error || draft.job.error}</p>}
    {running && <div className="batch-speech-progress" role="status"><progress max="100" value={draft.job.percent || 0}/><span>{draft.job.phase || 'AI local đang xử lý'} · Có thể đóng và mở lại</span><button disabled={busy} onClick={() => attempt(async () => applyResult(await batchRequest(`/${project.id}/speech/${draft.job.id}/cancel`, {}), draft.job.task))}>Hủy tác vụ</button></div>}
    <div className="batch-speech-body">
      <aside className="batch-speech-options">
        <div className="batch-speech-preview">
          {asset.kind === 'audio' ? <audio ref={player} controls src={previewUrl(sourcePath)} onTimeUpdate={timeUpdate}/> : <video ref={player} controls src={previewUrl(sourcePath)} onTimeUpdate={timeUpdate}/>}
          {active && asset.kind !== 'audio' && <CaptionGraphic text={{ ...style,content:active.content }} resolution={project.draft.settings}/>}
        </div>
        <div className="batch-speech-style"><strong>Kiểu captions · Áp dụng tất cả</strong><CaptionStyleControls style={style} onChange={changeStyle} disabled={disabled}/><p className="batch-muted">Câu dài tự chia thành nhiều phần, tối đa hai dòng trong safe zone.</p></div>
        <div className="batch-speech-style"><strong><Mic size={15}/> Đồng bộ giọng</strong><p className="batch-muted">Chọn cùng một giọng mẫu cho các video. Mặc định giữ nguyên mọi đoạn.</p>
          <label>Giọng mẫu<select aria-label="Giọng mẫu" value={referenceId} disabled={disabled} onChange={e => useVideoStore.setState({ batchVoiceReference:e.target.value })}><option value="">Chọn video/audio từ thư viện</option>{assets.filter(a => ['video','audio'].includes(a.kind) && a.status === 'ok').map(a => <option key={a.id} value={a.id}>{a.sourcePath?.split(/[\\/]/).pop()}</option>)}</select></label>
          <div className="batch-inline"><label>Từ (giây)<input aria-label="Giọng mẫu từ giây" type="number" min="0" step=".1" disabled={disabled} value={referenceStart} onChange={e => setReferenceStart(Number(e.target.value))}/></label><label>Đến (giây)<input aria-label="Giọng mẫu đến giây" type="number" min="3" step=".1" disabled={disabled} value={referenceEnd} onChange={e => setReferenceEnd(Number(e.target.value))}/></label></div>
          {reference && <audio controls src={previewUrl(reference.sourcePath)}/>}
          <p className="batch-muted">Mẫu rõ lời 3–30 giây. Đổi giọng thay audio trong đoạn đã chọn, gồm cả nhạc/tiếng nền ở đoạn đó. Nghe lại nếu nguồn có nhạc hoặc nói chồng.</p>
          {speakers.map(s => <label className="batch-inline" key={s}>{label(s)}<select aria-label={`Xử lý ${label(s)}`} disabled={disabled} value={cues.filter(c => c.speaker === s).every(c => c.action === 'convert') ? 'convert' : cues.filter(c => c.speaker === s).every(c => c.action === 'keep') ? 'keep' : 'mixed'} onChange={e => setAction(s,e.target.value)}><option value="keep">Giữ nguyên</option><option value="convert">Đổi sang giọng mẫu</option><option value="mixed" disabled>Tùy từng đoạn</option></select></label>)}
          <div className="batch-inline"><button disabled={disabled || !cues.length} onClick={() => setAction(null,'keep')}>Giữ tất cả</button><button disabled={disabled || !cues.length} onClick={() => setAction(null,'convert')}>Đổi tất cả</button></div>
          <button disabled={disabled || !referenceId || !cues.some(c => c.action === 'convert')} onClick={() => start('convert')}>Đổi giọng {cues.filter(c => c.action === 'convert').length} đoạn</button>
          {draft?.outputPath && <><strong>Nghe kết quả đổi giọng</strong><audio ref={convertedPlayer} controls src={previewUrl(draft.outputPath)} onTimeUpdate={timeUpdate}/></>}
        </div>
      </aside>
      <div className="batch-speech-cues"><div className="batch-section-heading"><strong>{cues.length} câu phụ đề</strong><button disabled={disabled} onClick={() => update(d => { const startMs = d.cues.at(-1)?.endMs || 0; if (startMs < durationMs) d.cues.push({ id:crypto.randomUUID(), startMs, endMs:Math.min(startMs+2000,durationMs), content:'', speaker:'speaker-1', action:'keep', words:[] }); })}><Plus size={14}/> Thêm câu</button></div>
        <p className="batch-muted">Nhóm giọng là gợi ý theo từng nguồn. Sửa nhóm hoặc chọn giữ riêng từng câu. Sửa nội dung/thời gian trước khi áp dụng.</p>
        {draft?.warnings?.map(w => <p key={w} className="batch-muted">{w}</p>)}
        {!cues.length && <div className="batch-speech-empty"><Captions size={38}/><h3>Tạo phụ đề từ lời nói</h3><p>Mỗi câu thành một clip riêng, sửa được trên timeline như trong CapCut.</p><p>AI chạy trên máy của bạn. Lần đầu tự cài và tải model; cần mạng và có thể mất vài phút.</p></div>}
        {cues.map((cue,index) => <article key={cue.id} className={`batch-speech-cue ${selected === cue.id || active?.id === cue.id ? 'active' : ''}`} onFocus={() => setSelected(cue.id)}>
          <div className="batch-speech-cue-heading"><span>{String(index+1).padStart(2,'0')}</span><button aria-label={`Nghe câu ${index+1}`} onClick={() => listen(cue)}><Play size={13}/></button><label>Từ<input aria-label={`Câu ${index+1} từ giây`} type="number" min="0" step=".01" value={cue.startMs/1000} disabled={disabled} onChange={e => editCue(cue.id,{ startMs:Number(e.target.value)*1000 },true)}/></label><label>Đến<input aria-label={`Câu ${index+1} đến giây`} type="number" min="0" step=".01" value={cue.endMs/1000} disabled={disabled} onChange={e => editCue(cue.id,{ endMs:Number(e.target.value)*1000 },true)}/></label><button aria-label={`Xóa câu ${index+1}`} disabled={disabled} onClick={() => update(d => { d.cues = d.cues.filter(c => c.id !== cue.id); d.conversionJobId = null; d.outputPath = null; })}><Trash2 size={13}/></button></div>
          <textarea aria-label={`Nội dung câu ${index+1}`} rows={2} value={cue.content} disabled={disabled} onChange={e => editCue(cue.id,{ content:e.target.value })} onBlur={()=>changeStyle({})}/>
          <div className="batch-speech-cue-footer"><select aria-label={`Người nói câu ${index+1}`} value={cue.speaker} disabled={disabled} onChange={e => editCue(cue.id,{ speaker:e.target.value === 'new' ? `speaker-${Date.now()}` : e.target.value })}>{speakers.map(s => <option key={s} value={s}>{label(s)}</option>)}<option value="new">+ Người nói mới</option></select><select aria-label={`Xử lý câu ${index+1}`} value={cue.action} disabled={disabled} onChange={e => editCue(cue.id,{ action:e.target.value },true)}><option value="keep">Giữ nguyên giọng</option><option value="convert">Đổi sang giọng mẫu</option></select><button title="Tách tại giữa câu" aria-label={`Tách câu ${index+1}`} disabled={disabled || cue.endMs-cue.startMs < 200} onClick={() => update(d => {
            const c = d.cues[index], at = Math.round((c.startMs+c.endMs)/2), words = c.content.split(/\s+/), middle = Math.ceil(words.length/2);
            d.cues.splice(index,1,{ ...c,endMs:at,content:words.slice(0,middle).join(' '),words:[] },{ ...c,id:crypto.randomUUID(),startMs:at,content:words.slice(middle).join(' '),words:[] }); d.conversionJobId = null; d.outputPath = null;
          })}><Scissors size={13}/></button>{draft?.outputPath && <button aria-label={`Nghe giọng mới câu ${index+1}`} onClick={() => listen(cue,true)}>Nghe mới</button>}</div>
        </article>)}
      </div>
    </div>
    <div className="batch-section-heading"><span className="batch-muted">Nguồn gốc được giữ nguyên · Phụ đề có thể sửa tiếp trong Video Editor</span><div className="batch-inline"><button disabled={disabled || !item.speech} onClick={() => attempt(async () => { await useVideoStore.getState().batchApplySpeech({ itemId:item.id,sourceHash,speech:null }); onClose(); })}>Gỡ voice/captions</button><button className="batch-primary" disabled={disabled || !cues.length} onClick={save}>Áp dụng vào Lab</button></div></div>
  </section></div>;
}
