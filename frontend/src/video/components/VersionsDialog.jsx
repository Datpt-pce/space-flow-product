import { useEffect, useState } from 'react';
import { useDialogFocus } from '../useDialogFocus.js';
import { useVideoStore } from '../store.js';
import { videoVersionRequest } from '../../lib/api.js';
import VersionFrameCompare from './VersionFrameCompare.jsx';
import AutomationDialog from './AutomationDialog.jsx';

const button = 'rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent)]';
export default function VersionsDialog({ onClose }) {
  const [automationOpen, setAutomationOpen] = useState(false);
  const ref = useDialogFocus(onClose, !automationOpen);
  const project = useVideoStore(s => s.project);
  const revision = useVideoStore(s => s.currentRevision);
  const pending = useVideoStore(s => s.pendingCommands.length > 0 || s.staleVersionDetected || s.saveStatus === 'error');
  const [versions, setVersions] = useState([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState(null);
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otherId, setOtherId] = useState('');
  const [framePair, setFramePair] = useState(null);
  const reload = () => videoVersionRequest(project.id).then(setVersions);
  useEffect(() => { let disposed = false; videoVersionRequest(project.id).then(v => { if (!disposed) setVersions(v); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, [project.id, revision]);
  async function act(fn) {
    setBusy(true); setError('');
    try { await fn(); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const current = versions.find(v => v.id === selected);
  if (automationOpen) return <AutomationDialog project={project} sourceVersion={current} onClose={() => setAutomationOpen(false)} onOpen={onClose} />;
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Bản lưu và duyệt" className="w-[850px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl bg-[var(--card)] p-5 text-[var(--text)]">
      <div className="sticky top-0 z-10 bg-[var(--card)] flex justify-between items-center mb-4 py-2"><h2 className="font-semibold">Bản lưu và duyệt</h2><button className={button} onClick={onClose}>Đóng bản lưu</button></div>
      <p className="text-xs text-[var(--n600)] mb-3">Đặt tên bản đã lưu để dùng trong workflow và giữ lại quyết định duyệt. Thay đổi mới sẽ không sửa nội dung bản cũ.</p>
      <button type="button" className={`${button} mb-3`} onClick={() => setAutomationOpen(true)}>Mẫu, biến thể và nguồn gốc</button>
      <form className="flex gap-2 mb-3" onSubmit={e => { e.preventDefault(); act(async () => { const v = await videoVersionRequest(project.id, '', { name, baseRevision: revision }); setSelected(v.id); setName(''); setChanges(null); }); }}>
        <input aria-label="Tên bản lưu" maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Bản gửi duyệt lần 1" className="min-w-0 flex-1 border rounded-lg px-3 bg-[var(--card)]" />
        <button className={button} disabled={busy || pending || !name.trim()}>Lưu phiên bản r{revision}</button>
      </form>
      {pending && <p role="status" className="text-xs mb-3">Cần lưu và đồng bộ các chỉnh sửa trước.</p>}
      {error && <p role="alert" className="text-sm text-[var(--video-error)] mb-3">{error}</p>}
      {!versions.length && <p className="text-sm text-[var(--n600)]">Chưa có bản lưu được đặt tên.</p>}
      <div className="flex flex-wrap gap-2 mb-4">{versions.map(v => <button key={v.id} className={`${button} ${selected === v.id ? 'ring-2 ring-[var(--accent)]' : ''}`} onClick={() => { setSelected(v.id); setChanges(null); setNote(''); }}>
        {v.name} · r{v.seq}{v.staleDocument || v.staleDependencies ? ' · Bản cũ' : ''}
      </button>)}</div>
      {current && <div className="border-t border-[var(--card-border)] pt-3 space-y-3">
        {versions.length > 1 && <div className="flex gap-2 flex-wrap">
          <select aria-label="Bản lưu đối chiếu" value={otherId} onChange={e => setOtherId(e.target.value)} className="min-w-0 border rounded-lg p-2 text-xs bg-[var(--card)]">
            <option value="">Chọn bản lưu để đối chiếu</option>{versions.filter(v => v.id !== current.id).map(v => <option key={v.id} value={v.id}>{v.name} · r{v.seq}</option>)}
          </select>
          <button type="button" className={button} disabled={!otherId || otherId === current.id} onClick={() => setFramePair({ left: current, right: versions.find(v => v.id === otherId) })}>So sánh hình hai bản</button>
        </div>}
        {framePair && <VersionFrameCompare key={`${framePair.left.id}:${framePair.right.id}`} projectId={project.id} {...framePair} onClose={() => setFramePair(null)} />}
        <p className="text-xs">{current.staleDocument ? 'Timeline có chỉnh sửa mới.' : 'Nội dung khớp timeline hiện tại.'} {current.staleDependencies && 'Media hoặc quyền sử dụng đã thay đổi; cần kiểm tra lại.'}</p>
        <button className={button} disabled={busy} onClick={() => act(async () => setChanges((await videoVersionRequest(project.id, `/${current.id}/compare`)).changes))}>So với bản đang sửa</button>
        {changes && <div aria-label="Khác biệt phiên bản" className="max-h-40 overflow-auto text-xs space-y-1">{changes.length ? changes.map((c, i) => <p key={i} className="break-all">{({ added: 'Thêm', removed: 'Xoá', changed: 'Đổi' })[c.kind]} {c.path}: {JSON.stringify(c.before) ?? '—'} → {JSON.stringify(c.after) ?? '—'}</p>) : <p>Không có khác biệt nội dung.</p>}</div>}
        <div aria-label="Kết quả QC" className="text-xs space-y-2">{current.issues.length ? current.issues.map((issue, i) => <button key={i} className="block text-left underline" onClick={() => {
          if (issue.timeMs !== undefined) useVideoStore.getState().setPlayheadMs(issue.timeMs);
          const clipId = issue.clipId || issue.path?.split('/clips/')[1]?.split('/')[0];
          if (clipId) useVideoStore.setState({ selectedIds: [clipId], primaryId: clipId });
          onClose();
        }}>{issue.severity === 'error' ? 'Lỗi' : 'Cần kiểm tra'}: {issue.message}{issue.timeMs !== undefined ? ` (${(issue.timeMs / 1000).toFixed(1)}s)` : ''}</button>) : <p>QC tự động: không phát hiện lỗi. Hãy xem bản render trước khi duyệt.</p>}</div>
        <textarea aria-label="Ghi chú duyệt" value={note} onChange={e => setNote(e.target.value)} maxLength={4000} placeholder="Ghi chú hoặc yêu cầu chỉnh sửa" className="w-full h-20 border rounded-lg p-2 text-sm bg-[var(--card)]" />
        <div className="flex gap-2">{[['approved', 'Duyệt bản này'], ['changes_requested', 'Yêu cầu sửa']].map(([decision, label]) => <button key={decision} className={button} disabled={busy || pending || (decision === 'approved' && (current.staleDocument || current.staleDependencies || current.issues.some(i => i.severity === 'error')))} onClick={() => act(async () => { await videoVersionRequest(project.id, `/${current.id}/review`, { decision, note }); setNote(''); })}>{label}</button>)}</div>
        <div className="text-xs space-y-2">{current.decisions.map(d => <p key={d.id}>{d.decision === 'approved' ? 'Đã duyệt' : 'Yêu cầu sửa'}{d.stale ? ' · Cần duyệt lại do có thay đổi' : ''} — {d.created_at}{d.note && ` · ${d.note}`}</p>)}</div>
      </div>}
    </section>
  </div>;
}
