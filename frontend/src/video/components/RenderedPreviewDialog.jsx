import { useEffect, useRef, useState } from 'react';
import { useVideoStore } from '../store.js';
import { useDialogFocus } from '../useDialogFocus.js';
import { fetchRenderJobs, startRenderJob, streamRenderJob } from '../../lib/api.js';

// Exact inspection uses the same verified artifact as export, including effects
// and audio that cannot be reproduced by the interactive Canvas 2D compositor.
export default function RenderedPreviewDialog({ onClose }) {
  useEffect(() => { useVideoStore.getState().pause(); }, []);
  const project = useVideoStore(s => s.project);
  const revision = useVideoStore(s => s.currentRevision);
  const pending = useVideoStore(s => s.pendingCommands);
  const stale = useVideoStore(s => s.staleVersionDetected);
  const saveStatus = useVideoStore(s => s.saveStatus);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(null);
  const dialogRef = useDialogFocus(onClose);
  const blocked = pending.length > 0 || stale || saveStatus === 'error';

  useEffect(() => {
    let disposed = false;
    if (blocked) return undefined;
    const projectId = project.id;
    const pinnedSeq = revision;
    setBusy(true);
    setError('');
    setJob(null);
    (async () => {
      const jobs = await fetchRenderJobs(projectId);
      let selected = generation === 0 && jobs.find(j => j.pinned_seq === pinnedSeq && j.preset_id === 'original' && j.status === 'done');
      if (!selected) {
        const id = await startRenderJob(projectId, 'original', {
          baseRevision: pinnedSeq,
          idempotencyKey: generation === 0 ? `preview-r${pinnedSeq}` : crypto.randomUUID(),
        });
        selected = { id, status: 'queued', pinned_seq: pinnedSeq };
      }
      if (disposed) return;
      setJob(selected);
      if (selected.status !== 'done') {
        stopRef.current = streamRenderJob(projectId, selected.id, update => {
          if (!disposed) setJob(current => ({ ...current, ...update }));
        });
      }
    })().catch(e => { if (!disposed) setError(e.message); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; stopRef.current?.(); stopRef.current = null; };
  }, [project.id, revision, generation, blocked]);

  const button = 'rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40';
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="rendered-preview-title" className="w-[1000px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl bg-[var(--card)] p-5 text-[var(--text)]">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 id="rendered-preview-title" className="font-semibold">Xem bản render · r{job?.pinned_seq ?? revision}</h2>
          <button className={button} onClick={onClose}>Đóng bản render</button>
        </div>
        <p className="text-xs text-[var(--n600)] mb-4">Xem chính xác hình và âm thanh của video xuất ra từ bản đã lưu. Đóng cửa sổ này để tiếp tục chỉnh sửa.</p>
        {blocked ? <p role="status">Lưu và đồng bộ thay đổi trước khi tạo bản xem.</p> : (
          <>
            {(busy || job?.status === 'queued' || job?.status === 'running') && <p role="status">Đang tạo bản xem… {Math.round(job?.progress_pct || 0)}%</p>}
            {(error || job?.error_message || job?.status === 'cancelled') && <p role="alert" className="text-[var(--video-error)]">{error || job.error_message || 'Đã huỷ bản render.'}</p>}
            {job?.status === 'done' && <video key={job.id} controls preload="metadata" aria-label="Video render đã xác minh" className="w-full max-h-[65dvh] bg-black rounded-lg" src={`/api/video-render/${project.id}/render/${job.id}/download?inline=1`} />}
            <button className={`${button} mt-4`} disabled={busy || ['queued', 'running'].includes(job?.status)} onClick={() => setGeneration(n => n + 1)}>Tạo lại bản xem</button>
          </>
        )}
      </section>
    </div>
  );
}
