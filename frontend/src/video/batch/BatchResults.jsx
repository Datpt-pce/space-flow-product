import { useEffect, useRef, useState } from 'react';
import { Bell, Download, FolderOpen, Trash2 } from 'lucide-react';
import { useVideoStore } from '../store';
import { batchRequest } from './batchApi';
import { cancelRenderJob, openFolder } from '../../lib/api';
import { apiFetch } from '../../lib/transport';
import BatchDelivery from './BatchDelivery';
import BatchPathInput from './BatchPathInput';
import { useDialogFocus } from '../useDialogFocus';

const labels = { queued: 'Chờ xuất', running: 'Đang xuất', done: 'Đã xác minh', error: 'Lỗi', cancelled: 'Đã hủy' };
const jobProgress = job => job?.status === 'done' ? 100 : job?.status === 'queued' ? 0
  : Number.isFinite(job?.progress) ? Math.max(0, Math.min(99, Math.round(job.progress))) : 0;
export default function BatchResults({ project, blocked }) {
  const run = useVideoStore(s => s.batchRun), runs = useVideoStore(s => s.batchRuns);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [page, setPage] = useState(0), [sourceIds, setSourceIds] = useState([]), [listId, setListId] = useState(''), [match, setMatch] = useState('all'), [status, setStatus] = useState('active');
  const [deliveryItem, setDeliveryItem] = useState(null), [downloadOpen, setDownloadOpen] = useState(false), [folder, setFolder] = useState(''), [lastFile, setLastFile] = useState(''), [progress, setProgress] = useState('');
  const selectionKey = useRef(crypto.randomUUID()), deliveryKeys = useRef(new Map());
  const resultsRef = useDialogFocus(() => { if (!busy) setOpen(false); }, open && !deliveryItem);
  const state = () => useVideoStore.getState();
  const safe = promise => promise.catch(e => setError(e.message));
  const pending = runs.reduce((n, r) => n + (r.pendingCount || 0), 0);
  const renderJobs = (run?.items || []).filter(i => !i.archived && i.jobs.length).map(i => i.jobs.at(-1));
  const rendering = renderJobs.some(j => ['queued', 'running'].includes(j.status));
  const renderProgress = renderJobs.length && renderJobs.every(j => j.status === 'done') ? 100
    : renderJobs.length ? Math.min(99, Math.round(renderJobs.reduce((n, j) => n + jobProgress(j), 0) / renderJobs.length)) : 0;
  const sources = [...new Map((run?.sources || []).map(s => [s.id, s])).values()];
  const lists = [...new Map((run?.sources || []).map(s => [s.listId, s])).values()];
  const filtered = (run?.items || []).filter(item => {
    if (item.archived !== (status === 'archived')) return false;
    const job = item.jobs.at(-1);
    if (status === 'done' && job?.status !== 'done') return false;
    if (status === 'pending' && job?.status === 'done' && job.pinnedSeq === item.currentSeq) return false;
    const itemIds = item.assignments.flatMap(a => a.playlistItemIds || [a.itemId]);
    const used = (run.sources || []).filter(s => itemIds.includes(s.itemId));
    if (listId && !used.some(s => s.listId === listId)) return false;
    return !sourceIds.length || (match === 'all' ? sourceIds.every(id => used.some(s => s.id === id)) : sourceIds.some(id => used.some(s => s.id === id)));
  });
  const rows = filtered.slice(page * 20, (page + 1) * 20);
  const chosen = filtered.filter(i => selected.includes(i.rowIndex));
  const downloadable = chosen.length > 0 && chosen.every(i => !i.archived && i.jobs.at(-1)?.status === 'done');
  const savedFile = lastFile || chosen.flatMap(i => i.deliveries || []).filter(d => d.state === 'done').at(-1)?.receipt?.target;
  function clearSelection() { setSelected([]); setPage(0); selectionKey.current = crypto.randomUUID(); }
  useEffect(() => { clearSelection(); setSourceIds([]); setListId(''); setStatus('active'); setLastFile(''); setProgress(''); setError(''); }, [run?.id]);
  useEffect(() => { if (page > 0 && page * 20 >= filtered.length) setPage(Math.max(0, Math.ceil(filtered.length / 20) - 1)); }, [filtered.length, page]);
  useEffect(() => {
    if (!project || !run || (!rendering && !runs.some(r => r.runningCount > 0))) return;
    const timer = setInterval(() => { if (!state().batchBusy && !busy) safe(state().batchLoadRun(run.id)); }, 2500);
    return () => clearInterval(timer);
  }, [project?.id, run?.id, runs, busy, rendering]);
  async function refresh() { if (run) await state().batchLoadRun(run.id); }
  async function perform(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function render(mode = 'current', indexes = chosen.map(i => i.rowIndex)) {
    const result = await batchRequest(`/${project.id}/runs/${run.id}/render`, { selectionKey: mode === 'retry' ? crypto.randomUUID() : selectionKey.current, rowIndexes: indexes, mode,
      expectedSeqs: Object.fromEntries(run.items.map(i => [i.rowIndex, i.currentSeq])) });
    setError(result.results.filter(r => r.error).map(r => `#${r.rowIndex + 1}: ${r.error}`).join('\n'));
    clearSelection(); await refresh();
  }
  async function archiveSelected() {
    const restore = status === 'archived';
    if (!restore && !window.confirm(`Chuyển ${chosen.length} timeline đã chọn vào thùng rác? Có thể khôi phục.\n${chosen.map(i => i.name).join('\n')}`)) return;
    await batchRequest(`/${project.id}/runs/${run.id}/archive`, { rowIndexes: chosen.map(i => i.rowIndex), restore });
    clearSelection(); await refresh();
  }
  async function downloadZip() {
    const response = await apiFetch(`/api/video-batch/${project.id}/runs/${run.id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndexes: chosen.map(i => i.rowIndex) }) });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Không tải được ZIP.'); }
    const blob = await response.blob();
    if (!blob.size || !response.headers.get('Content-Type')?.includes('application/zip')) throw new Error('Không nhận được ZIP đầy đủ. Thử tải lại.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'render-batch.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setProgress(`Đã gửi ZIP chứa ${chosen.length} MP4 cho trình duyệt.`);
  }
  async function saveToFolder() {
    await state().batchSave();
    let completed = 0;
    try {
      for (const item of chosen) {
        setProgress(`Đang lưu ${completed + 1}/${chosen.length}…`);
        const job = item.jobs.at(-1), base = `/${project.id}/runs/${run.id}/items/${item.rowIndex}/deliveries`;
        const key = `${run.id}:${item.rowIndex}:${job.jobId}:${folder.trim()}`;
        if (!deliveryKeys.current.has(key)) deliveryKeys.current.set(key, crypto.randomUUID());
        const receipt = await batchRequest(base, { requestKey: deliveryKeys.current.get(key), jobId: job.jobId, mode: 'variant', folder: folder.trim() });
        const result = await batchRequest(`${base}/${receipt.id}`, {});
        setLastFile(result.receipt?.target || ''); completed++;
      }
      setProgress(`Đã lưu ${completed} MP4 vào thư mục và thêm vào Lab.`);
    } finally {
      const latest = await batchRequest(`/${project.id}`);
      if (!state().batchDirty) useVideoStore.setState({ batchProject: latest, batchPreview: null, batchRunKey: null });
      await refresh();
    }
  }
  async function reveal(file) {
    const result = await openFolder(file);
    if (result.error) throw new Error(result.error);
  }
  function toggle(index) {
    setSelected(current => current.includes(index) ? current.filter(n => n !== index) : [...current, index]);
    selectionKey.current = crypto.randomUUID();
  }
  return <>
    <button className="batch-render-button" disabled={!project} onClick={() => { setOpen(true); if (run) safe(refresh()); }} aria-label={`RENDER BATCH · ${pending} timeline chờ render`}><Bell size={16}/>RENDER BATCH<span className="batch-render-badge" aria-label={`${pending} timeline chờ render`}>{pending}</span></button>
    {open && <div className="batch-dialog-backdrop"><section ref={resultsRef} role="dialog" aria-modal="true" aria-label="RENDER BATCH" className="batch-dialog batch-results">
      <div className="batch-section-heading"><div><h2>RENDER BATCH</h2><p className="batch-muted">{pending} timeline chờ render · {runs.length} lần tạo</p></div><button disabled={busy} onClick={() => setOpen(false)}>Đóng kết quả</button></div>
      {!run ? <p className="batch-muted">Chưa có timeline. Dựng công thức và tạo timeline từ ma trận để thêm vào đây.</p> : <>
        <div className="batch-toolbar"><select aria-label="Lần tạo batch" value={run.id} disabled={busy || blocked} onChange={e => safe(state().batchLoadRun(e.target.value))}>{runs.map((r, index) => <option key={r.id} value={r.id}>R{runs.length - index} · {r.activeCount ?? r.count} timeline · {r.pendingCount} chờ · {r.createdAt}</option>)}</select>
          <select aria-label="Lọc trạng thái render" value={status} disabled={busy} onChange={e => { setStatus(e.target.value); clearSelection(); }}><option value="active">Tất cả timeline</option><option value="pending">Chờ render</option><option value="done">Đã xuất MP4</option><option value="archived">Đã xóa · có thể khôi phục</option></select>
          <button disabled={busy || blocked} onClick={() => safe(refresh())}>Tải lại kết quả</button>
        </div>
        <details className="batch-result-filters"><summary>Lọc theo asset hoặc cụm asset{sourceIds.length ? ` · ${sourceIds.length} asset` : ''}</summary><div className="batch-toolbar">
          <label>List nguồn<select aria-label="Lọc theo list nguồn" value={listId} disabled={busy} onChange={e => { setListId(e.target.value); clearSelection(); }}><option value="">Mọi list</option>{lists.map(s => <option key={s.listId} value={s.listId}>{s.listName}</option>)}</select></label>
          <label>Asset<select multiple size={4} aria-label="Lọc theo asset" disabled={busy} value={sourceIds} onChange={e => { setSourceIds([...e.target.selectedOptions].map(o => o.value)); clearSelection(); }}>{sources.map(s => <option key={s.id} value={s.id}>{s.name} · {s.listName}</option>)}</select></label>
          <label>Cụm asset<select aria-label="Cách khớp cụm asset" disabled={busy} value={match} onChange={e => { setMatch(e.target.value); clearSelection(); }}><option value="all">Chứa tất cả asset đã chọn</option><option value="any">Chứa ít nhất một asset đã chọn</option></select></label>
          <button disabled={busy} onClick={() => { setSourceIds([]); setListId(''); clearSelection(); }}>Bỏ lọc nguồn</button>
        </div><p className="batch-muted">Ctrl/Cmd + click để chọn nhiều asset.</p></details>
        <div className="batch-toolbar"><label className="batch-checkbox"><input type="checkbox" aria-label="Chọn tất cả kết quả lọc" ref={el => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < filtered.length; }} disabled={busy || !filtered.length} checked={!!filtered.length && chosen.length === filtered.length} onChange={e => { setSelected(e.target.checked ? filtered.map(i => i.rowIndex) : []); selectionKey.current = crypto.randomUUID(); }}/>Chọn tất cả {filtered.length} kết quả (mọi trang)</label><span className="batch-spacer"/><span>Đã chọn {chosen.length}</span><button disabled={busy} onClick={() => { setSelected(rows.map(i => i.rowIndex)); selectionKey.current = crypto.randomUUID(); }}>Chọn trang này</button></div>
        {error && <p role="alert" style={{whiteSpace:'pre-wrap'}}>{error}</p>}
        {renderJobs.length > 0 && <div className="batch-render-progress"><span>{rendering ? 'Đang render' : 'Kết quả render'} · {renderJobs.filter(j => j.status === 'done').length}/{renderJobs.length} hoàn tất · {renderProgress}%</span><progress aria-label="Tiến trình render batch" max={100} value={renderProgress}/></div>}
        <div className="batch-table-scroll"><table><thead><tr><th>Chọn</th><th>Timeline</th><th>Bản đang lưu</th><th>Render</th><th>Thao tác</th></tr></thead><tbody>{rows.map(item => {
          const job = item.jobs.at(-1), delivered = item.deliveries?.filter(d => d.state === 'done').at(-1)?.receipt?.target;
          return <tr key={item.rowIndex}><td><input aria-label={`Chọn output ${item.rowIndex + 1}`} type="checkbox" disabled={busy} checked={selected.includes(item.rowIndex)} onChange={() => toggle(item.rowIndex)}/></td>
            <td>{item.archived ? item.name : <a href={`/video?${new URLSearchParams({ projectId: item.timelineId, labRunReturn: project.id })}`}>{item.name}</a>}</td><td>{item.currentSeq === 0 ? 'Bản tạo ban đầu' : `Đã chỉnh · bản ${item.currentSeq}`}</td>
            <td>{item.archived ? 'Trong thùng rác' : job ? `${labels[job.status] || job.status} · bản ${job.pinnedSeq ?? job.seq}` : 'Chưa xuất'}{!item.archived && job && ['queued', 'running', 'done'].includes(job.status) && <div className="batch-render-progress"><progress aria-label={`Tiến trình render output ${item.rowIndex + 1}`} max={100} value={jobProgress(job)}/><span>{jobProgress(job)}%</span></div>}{job?.error && <p className="batch-muted">{job.error}</p>}</td>
            <td><div className="batch-toolbar">
              {!item.archived && job?.status === 'done' && <><a href={`/api/video-render/${item.timelineId}/render/${job.jobId}/download`} download>Tải MP4</a><button disabled={busy || blocked} onClick={() => safe(state().batchSave().then(() => setDeliveryItem(item)))}>Lưu về nguồn</button>{delivered && <button aria-label={`Mở thư mục output ${item.rowIndex + 1}`} title={delivered} onClick={() => safe(reveal(delivered))}><FolderOpen size={16}/></button>}</>}
              {!item.archived && job && ['error', 'cancelled'].includes(job.status) && <button disabled={busy || blocked} onClick={() => perform(() => render('retry', [item.rowIndex]))}>Retry bản {job.seq}</button>}
              {job && ['queued', 'running'].includes(job.status) && <button disabled={busy} onClick={() => perform(() => cancelRenderJob(job.jobId).then(refresh))}>Hủy</button>}
              <a href={`/api/video-batch/${project.id}/runs/${run.id}/items/${item.rowIndex}/manifest`} target="_blank" rel="noreferrer">Manifest</a>
            </div></td></tr>;
        })}</tbody></table>{!filtered.length && <p className="batch-muted">Không có timeline khớp bộ lọc.</p>}</div>
        <div className="batch-toolbar"><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Trang trước</button><span>{page + 1}/{Math.max(1, Math.ceil(filtered.length / 20))}</span><button disabled={busy || (page + 1) * 20 >= filtered.length} onClick={() => setPage(page + 1)}>Trang sau</button><span className="batch-spacer"/>
          <button className="batch-danger-outline" disabled={busy || blocked || !chosen.length} onClick={() => perform(archiveSelected)}><Trash2 size={15}/>{status === 'archived' ? 'Khôi phục' : 'Xóa'} {chosen.length} đã chọn</button>
          <button disabled={busy || !downloadable} title="Chọn các timeline đã xuất MP4 để tải" onClick={() => setDownloadOpen(!downloadOpen)}><Download size={15}/>Download {chosen.length} đã chọn</button>
          <button className="batch-primary" disabled={busy || blocked || !chosen.length || status === 'archived'} onClick={() => perform(() => render())}>Xuất {chosen.length} bản đang lưu</button>
        </div>
        {downloadOpen && <div className="batch-download-panel"><div className="batch-toolbar"><button disabled={busy || !downloadable} onClick={() => perform(downloadZip)}>Tải ZIP · {chosen.length} MP4</button><span className="batch-muted">Hoặc lưu trực tiếp vào thư mục:</span><BatchPathInput label="Thư mục tải batch" value={folder} onChange={setFolder} disabled={busy || blocked} placeholder="Chọn thư mục trên máy của tôi" onError={setError}/><button disabled={busy || blocked || !downloadable || !folder.trim()} onClick={() => perform(saveToFolder)}>Lưu {chosen.length} MP4 vào thư mục</button><button aria-label="Mở thư mục đã tải" title={savedFile || 'Lưu MP4 vào thư mục để mở đúng vị trí'} disabled={busy || !savedFile} onClick={() => safe(reveal(savedFile))}><FolderOpen size={17}/></button></div><p className="batch-muted">Trình duyệt quản lý nơi lưu ZIP. Lưu MP4 vào thư mục cho phép mở đúng vị trí bằng icon folder.</p>{progress && <p role="status">{progress}</p>}</div>}
        <div className="batch-toolbar"><span className="batch-muted">Bộ đếm gồm timeline chưa xuất, đang xuất, lỗi hoặc đã có chỉnh sửa mới.</span><span className="batch-spacer"/><button disabled={busy || blocked} onClick={() => { useVideoStore.setState({ batchRunKey: null }); setOpen(false); }}>Chuẩn bị run mới</button></div>
      </>}
    </section></div>}
    {deliveryItem && <BatchDelivery projectId={project.id} runId={run.id} item={deliveryItem} onClose={() => { setDeliveryItem(null); safe(refresh()); }}/>}
  </>;
}
