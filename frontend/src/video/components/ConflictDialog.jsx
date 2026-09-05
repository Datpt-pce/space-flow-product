import { useEffect, useState } from 'react';
import { documentDiff } from '@shared/video-document-diff';
import { useDialogFocus } from '../useDialogFocus.js';
import { useVideoStore } from '../store.js';
import { fetchVideoProject } from '../../lib/api.js';
export default function ConflictDialog({ onClose }) {
  const ref = useDialogFocus(onClose);
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState('');
  const local = useVideoStore(s => s.projectState);
  const project = useVideoStore(s => s.project);
  useEffect(() => { let disposed = false; fetchVideoProject(project.id).then(remote => { if (!disposed) setChanges(documentDiff(remote.payload, local)); }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, [project.id, local]);
  const button = 'rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs';
  function downloadLocal() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ projectId: project.id, document: local }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'timeline-chua-dong-bo.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Khác biệt chưa đồng bộ" className="w-[800px] max-w-[calc(100vw-32px)] max-h-[80dvh] overflow-y-auto rounded-2xl p-5 bg-[var(--card)] text-[var(--text)]">
    <h2 className="font-semibold mb-3">Khác biệt chưa đồng bộ</h2>
    <p className="text-xs mb-3">So sánh bản trên máy chủ → bản đang chỉnh sửa. Tải bản cục bộ trước khi bỏ các thao tác chưa lưu nếu bạn muốn giữ lại để đối chiếu.</p>
    {error && <p role="alert">{error}</p>}
    <div className="text-xs max-h-80 overflow-auto space-y-2">{changes ? changes.length ? changes.map((c, i) => <p key={i} className="break-all">{c.path}: {JSON.stringify(c.before) ?? '—'} → {JSON.stringify(c.after) ?? '—'}</p>) : <p>Nội dung giống nhau.</p> : <p>Đang so sánh…</p>}</div>
    <div className="flex flex-wrap gap-2 mt-4"><button className={button} onClick={onClose}>Tiếp tục xem bản cục bộ</button><button className={button} onClick={downloadLocal}>Tải bản cục bộ</button><button className={button} onClick={async () => { await useVideoStore.getState().discardPendingAndResync(); onClose(); }}>Bỏ thao tác chưa lưu và đồng bộ</button></div>
  </section></div>;
}
