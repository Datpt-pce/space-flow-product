import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVideoStore } from '../store';
import { batchRequest } from './batchApi';

export default function BatchReturn() {
  const pending = useVideoStore(s => s.pendingCommands);
  const project = useVideoStore(s => s.project);
  const revision = useVideoStore(s => s.currentRevision);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [captureMode, setCaptureMode] = useState('prepared');
  const params = new URLSearchParams(window.location.search);
  const labId = params.get('labReturn'), itemId = params.get('labItem'), listId = params.get('labList');
  const runReturn = params.get('labRunReturn');
  const mini = params.get('labMini') === '1' && window.parent !== window;
  function returnToLab(nextItemId = itemId) {
    if (mini) window.parent.postMessage({ type: 'batch-editor-closed', itemId: nextItemId }, location.origin);
    else window.location.assign(`/video?${new URLSearchParams({ lab: labId, list: listId, item: nextItemId })}`);
  }
  useEffect(() => {
    if (!mini) return;
    function receive(event) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'batch-editor-close-request') return;
      if (busy || useVideoStore.getState().pendingCommands.length) { setError('Đợi timeline lưu xong trước khi đóng.'); return; }
      returnToLab();
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'batch-editor-ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, [mini, busy, labId, listId, itemId]);
  if (runReturn) return <a className="rounded border px-2 py-1 text-xs" href={`/video?lab=${encodeURIComponent(runReturn)}`}>Về kết quả Lab</a>;
  if (!labId || !itemId || !listId) return null;
  async function capture() {
    setBusy(true); setError('');
    try {
      const lab = await batchRequest(`/${encodeURIComponent(labId)}`);
      const item = lab.draft.lists.find(l => l.id === listId)?.items.find(i => i.id === itemId);
      if (item?.preparation?.projectId !== project?.id) throw new Error('Mở lại đúng timeline chuẩn bị từ Lab.');
      const result = await batchRequest(`/${encodeURIComponent(labId)}/${captureMode === 'trim' ? 'capture' : 'capture-prepared'}`, { listId, itemId, expectedRevision: lab.revision, baseRevision: revision, asVariant: captureMode === 'variant' });
      returnToLab(result.itemId || itemId);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return <div className="flex items-center gap-2 text-xs max-w-md" aria-label="Quay lại Lab">
    <button type="button" className="rounded border px-2 py-1" disabled={busy || pending.length > 0} onClick={() => returnToLab()}>Về Lab</button>
    <select aria-label="Cách nhận về Lab" className="rounded border px-1 py-1 bg-[var(--card)] max-w-32" disabled={busy || pending.length > 0} value={captureMode} onChange={e => setCaptureMode(e.target.value)}><option value="prepared">Thay bằng công thức</option><option value="variant">Thêm variant</option><option value="trim">Chỉ nhận trim</option></select>
    <button type="button" className="rounded border px-2 py-1" disabled={busy || pending.length > 0} onClick={capture}>{captureMode === 'trim' ? 'Nhận trim & về Lab' : 'Lưu & về Lab'}</button>
    {error && createPortal(<div role="alert" className="fixed top-14 right-4 z-50 max-w-md p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card)] text-[var(--text)] shadow-xl text-sm">
      <p>{error}</p><button type="button" className="mt-3 rounded border px-3 py-1" onClick={() => setError('')}>Đóng thông báo</button>
    </div>, document.body)}
  </div>;
}
