import { useEffect, useRef, useState } from 'react';
import { batchRequest } from './batchApi.js';
import { useDialogFocus } from '../useDialogFocus.js';
import BatchPathInput from './BatchPathInput.jsx';

export default function BatchCapcutRender({ project, onClose }) {
  const [packages, setPackages] = useState([]), [packageId, setPackageId] = useState('');
  const [timelineIds, setTimelineIds] = useState([]), [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [job, setJob] = useState(null);
  const key = `bcl-capcut-render:${project.id}`;
  const requestKey = useRef(crypto.randomUUID());
  const dialogRef = useDialogFocus(() => { if (!busy) onClose(); });
  const selected = packages.find(p => p.id === packageId);
  const running = job && ['queued', 'running'].includes(job.status);
  const locked = busy || running;
  const items = job?.items || (job?.result ? [{ timelineId:job.timelineId, status:job.status, result:job.result }] : []);
  const completed = items.filter(item => item.status === 'completed').length;
  const allSelected = !!selected?.report.timelines.length && selected.report.timelines.every(t => timelineIds.includes(t.id));
  useEffect(() => {
    let active = true;
    batchRequest(`/${project.id}/capcut`).then(async records => {
      if (!active) return;
      const installed = records.filter(p => p.status === 'installed' && p.report.timelines?.length);
      setPackages(installed);
      let previous;
      try { previous = JSON.parse(sessionStorage.getItem(key)); } catch { /* optional resume */ }
      const initial = installed.find(p => p.id === previous?.packageId) || installed[0];
      setPackageId(initial?.id || ''); setTimelineIds(initial ? [initial.report.timelines[0].id] : []);
      if (initial && initial.id === previous?.packageId) {
        const state = await batchRequest(`/${project.id}/capcut/${initial.id}/render/${previous.requestKey}`);
        if (!active) return;
        setJob(state); setTimelineIds(state.timelineIds || [state.timelineId]); setOutputDir(state.outputDir);
      }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [project.id, key]);
  useEffect(() => {
    if (!running) return undefined;
    let active = true, timer;
    async function poll() {
      try {
        const state = await batchRequest(`/${project.id}/capcut/${packageId}/render/${job.id}`);
        if (active) { setJob(state); setError(''); }
      } catch (e) { if (active) setError(e.message); }
      if (active) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [project.id, packageId, job?.id, running]);
  async function render() {
    setBusy(true); setError('');
    try {
      const state = await batchRequest(`/${project.id}/capcut/${packageId}/render`, { requestKey:requestKey.current, timelineIds, outputDir:outputDir.trim() });
      setJob(state);
      try { sessionStorage.setItem(key, JSON.stringify({ packageId, requestKey:state.id })); } catch { /* rendering still runs */ }
      requestKey.current = crypto.randomUUID();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function clearResult() { setJob(null); setError(''); requestKey.current = crypto.randomUUID(); }
  return <div className="batch-dialog-backdrop"><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Render CapCut" className="batch-dialog batch-capcut-dialog">
    <div className="batch-section-heading"><h2>Render CapCut</h2><button disabled={busy} onClick={onClose}>Đóng hộp thoại</button></div>
    <p>Chọn các timeline của bản convert để xuất lần lượt bằng CapCut trên máy agent.</p>
    <p className="batch-muted">Lưu project đang chỉnh trước khi bắt đầu. CapCut sẽ về Home để mở lần lượt các bản render. Giữ màn hình máy agent mở, dùng giao diện English và để CapCut hoàn tất xuất.</p>
    {!busy && !packages.length && <p>Chưa có project đã convert vào draft. Dùng Convert to CapCut project trước.</p>}
    {!!packages.length && <>
      <label>Project đã convert<select aria-label="Project CapCut để render" value={packageId} disabled={locked} onChange={e => { setPackageId(e.target.value); setTimelineIds([packages.find(p => p.id === e.target.value).report.timelines[0].id]); clearResult(); }}>
        {packages.map(p => <option key={p.id} value={p.id}>{p.report.projectName}</option>)}
      </select></label>
      <fieldset disabled={locked} className="batch-capcut-timelines"><legend>Timeline · Đã chọn {timelineIds.length}/{selected?.report.timelines.length || 0}</legend>
        <label className="batch-capcut-check"><input type="checkbox" checked={allSelected} onChange={e => { setTimelineIds(e.target.checked ? selected.report.timelines.map(t => t.id) : []); clearResult(); }}/>Chọn tất cả timeline</label>
        <div className="batch-capcut-timeline-list">{selected?.report.timelines.map((t, index) => <label key={t.id} className="batch-capcut-check"><input type="checkbox" aria-label={`Chọn timeline ${index + 1}: ${t.name}`} checked={timelineIds.includes(t.id)} onChange={e => { setTimelineIds(e.target.checked ? selected.report.timelines.filter(timeline => timelineIds.includes(timeline.id) || timeline.id === t.id).map(timeline => timeline.id) : timelineIds.filter(id => id !== t.id)); clearResult(); }}/><span>{index + 1}. {t.name} · {(t.durationUs / 1e6).toFixed(1)}s</span></label>)}</div>
      </fieldset>
      <label>Thư mục xuất MP4<BatchPathInput label="Thư mục MP4 CapCut" value={outputDir} disabled={locked} onChange={value => { setOutputDir(value); clearResult(); }} onError={setError} placeholder="Thư mục có sẵn trên máy agent"/></label>
      <p className="batch-muted">Render tạo project SFRender riêng từ bản convert; các chỉnh sửa sau đó trong CapCut không nằm trong bản này. MP4 dùng thiết lập xuất hiện tại của CapCut.</p>
    </>}
    {(busy || running) && <div role="status"><progress aria-label="Tiến trình render CapCut" {...(items.length ? { value:completed, max:items.length } : {})}/><p>{running ? job.phase : 'Đang xử lý…'}</p></div>}
    {!!items.length && <div role="status"><strong>{job.status === 'completed' ? 'Đã xuất MP4 bằng CapCut' : 'Kết quả render'} · {completed}/{items.length}</strong>
      <div className="batch-capcut-timeline-list">{items.map((item, index) => <div key={item.timelineId}><p>{index + 1}. {item.name || selected?.report.timelines.find(t => t.id === item.timelineId)?.name} · {{ queued:'Đang chờ', running:'Đang xuất', completed:'Hoàn tất', failed:'Lỗi', skipped:'Chưa chạy' }[item.status]}</p>
        {item.result && <><p className="batch-path">{item.result.path}</p><p>{item.result.durationSeconds.toFixed(2)}s · {(item.result.bytes / 1048576).toFixed(1)} MB</p></>}
      </div>)}</div>
    </div>}
    {(error || job?.error) && <p role="alert" className="batch-error">{error || job.error}</p>}
    <div className="batch-toolbar">{job?.status === 'failed' && <button disabled={locked} onClick={() => { setTimelineIds(items.filter(item => item.status !== 'completed').map(item => item.timelineId)); clearResult(); }}>Chọn timeline chưa hoàn tất</button>}<span className="batch-spacer"/><button className="batch-primary" disabled={locked || !timelineIds.length || !outputDir.trim()} onClick={render}>Xuất {timelineIds.length} timeline bằng CapCut</button></div>
  </section></div>;
}
