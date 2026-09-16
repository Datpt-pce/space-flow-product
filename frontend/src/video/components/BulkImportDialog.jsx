// BulkImportDialog.jsx — 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md): apply a set of
// assets onto several timelines at once (opened from TimelineDashboard.jsx's multi-select, 08-F
// F6). 3 steps: pick assets (ordered, multi-kind) -> preview the placement matrix (read-only,
// backend/routes/video-bulk-import.js's previewBulkImport — exactly what Apply will do) -> apply,
// then a per-target result list with a "Thử lại lỗi" retry for any target that failed. See
// video-bulk-import.js's own header for what this slice deliberately leaves out (arbitrary
// placement/conflict preview, undo) and why.

import { useDialogFocus } from '../useDialogFocus.js';
import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, Film, Image as ImageIcon, Music, ArrowRight } from 'lucide-react';
import { fetchVideoAssets, previewBulkImport, createBulkImportOperation, retryBulkImportOperation, undoBulkImportOperation } from '../../lib/api.js';

const KIND_ICON = { video: Film, image: ImageIcon, audio: Music };

function assetLabel(asset) {
  return asset.sourcePath.split(/[\\/]/).pop();
}

export default function BulkImportDialog({ timelines, onClose }) {
  const dialogRef = useDialogFocus(onClose);
  const [assets, setAssets] = useState(null); // null = loading
  const [orderedAssetIds, setOrderedAssetIds] = useState([]);
  const [imageDurationMs, setImageDurationMs] = useState(3000);
  const [placement, setPlacement] = useState('append');
  const [startMs, setStartMs] = useState(0);
  const [step, setStep] = useState('pick'); // 'pick' | 'preview' | 'result'
  const [preview, setPreview] = useState(null);
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchVideoAssets()
      .then((list) => setAssets(list.filter((a) => a.status === 'ok')))
      .catch((err) => { setAssets([]); setError(err.message); });
  }, []);

  function toggleAsset(id) {
    setOrderedAssetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    try {
      const timelineIds = timelines.map((t) => t.id);
      const options = { imageDurationMs, placement, startMs };
      const result = await previewBulkImport(timelineIds, orderedAssetIds, options);
      setPreview(result);
      setStep('preview');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const timelineIds = timelines.map((t) => t.id);
      const options = { imageDurationMs, placement, startMs };
      const op = await createBulkImportOperation(timelineIds, orderedAssetIds, options, crypto.randomUUID());
      setOperation(op);
      setStep('result');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      const op = await retryBulkImportOperation(operation.id);
      setOperation(op);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const timelineNameById = Object.fromEntries(timelines.map((t) => [t.id, t.name]));
  const hasErrors = operation?.status !== 'undone' && operation?.results?.some((r) => r.status === 'error');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nhập hàng loạt" className="w-[560px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-sm font-semibold text-[var(--text,#111827)]">
            Nhập hàng loạt vào {timelines.length} timeline
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 text-xs">
          {error && (
            <p className="flex items-center gap-1.5 text-[var(--status-error,#ef4444)]"><AlertCircle size={12} className="shrink-0" /> {error}</p>
          )}

          {step === 'pick' && (
            <>
              <label>Cách đặt media <select aria-label="Cách đặt media" value={placement} onChange={e => setPlacement(e.target.value)} className="ml-2 h-8 border rounded bg-[var(--card)]">
                <option value="append">Nối cuối track</option><option value="new_tracks">Tạo track mới</option><option value="at_time">Chèn vào khoảng trống</option>
              </select></label>
              {placement === 'at_time' && <label>Thời điểm chèn (giây) <input aria-label="Thời điểm chèn (giây)" type="number" min="0" step="0.1" value={startMs / 1000} onChange={e => setStartMs(Number(e.target.value) * 1000)} className="w-24 h-8 border rounded bg-[var(--card)]" /></label>}
              <p className="text-[var(--n600,#4b5563)]">
                Chọn asset (video/ảnh/audio), theo đúng thứ tự sẽ được nối tiếp vào mỗi timeline. Video/ảnh vào Visual Zone, audio vào Audio Zone.
              </p>
              <label className="flex items-center gap-2">
                <span className="font-medium text-[var(--n600,#4b5563)]">Thời lượng mỗi ảnh (ms)</span>
                <input
                  type="number" min="100" step="100" value={imageDurationMs}
                  onChange={(e) => setImageDurationMs(Number(e.target.value) || 0)}
                  className="w-20 h-7 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)]"
                />
              </label>
              {assets === null ? (
                <p className="flex items-center gap-1.5 text-[var(--n600,#4b5563)] py-2"><Loader2 size={12} className="animate-spin" /> Đang tải asset…</p>
              ) : assets.length === 0 ? (
                <p className="text-[var(--n600,#4b5563)] py-2">Chưa có asset nào sẵn sàng.</p>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)]">
                  {assets.map((asset) => {
                    const Icon = KIND_ICON[asset.kind] || Film;
                    const orderIndex = orderedAssetIds.indexOf(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleAsset(asset.id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--n100,#f3f4f6)] ${orderIndex >= 0 ? 'bg-[var(--accent,#7C5CFA)]/10 text-[var(--accent,#7C5CFA)] font-medium' : 'text-[var(--n600,#4b5563)]'}`}
                      >
                        <Icon size={12} className="shrink-0" />
                        <span className="flex-1 truncate">{assetLabel(asset)}</span>
                        {orderIndex >= 0 && <span className="shrink-0 text-[10px]">#{orderIndex + 1}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 'preview' && preview && (
            <>
              <p className="text-[var(--n600,#4b5563)]">Xem trước — chưa có gì được áp dụng.</p>
              {preview.targets.map((target) => (
                <div key={target.timelineId} className="rounded-lg border border-[var(--card-border,#e5e7eb)] p-2">
                  <p className="font-medium text-[var(--text,#111827)] mb-1 truncate">{target.timelineName}</p>
                  {target.placements.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-[var(--n600,#4b5563)] pl-2">
                      {(() => { const Icon = KIND_ICON[p.kind] || Film; return <Icon size={10} className="shrink-0" />; })()}
                      <span>{(p.startMs / 1000).toFixed(1)}s → {((p.startMs + p.durationMs) / 1000).toFixed(1)}s</span>
                      <span className="text-[var(--n600,#4b5563)]">{p.isNewTrack ? '(track mới)' : '(track có sẵn)'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {step === 'result' && operation && (
            <>
              <p className="text-[var(--n600,#4b5563)]">
                Kết quả: {operation.status === 'undone' ? 'Đã hoàn tác' : operation.status === 'completed' ? 'Hoàn tất' : operation.status === 'failed' ? 'Thất bại toàn bộ' : 'Hoàn tất một phần'}
              </p>
              <div className="flex flex-col gap-1">
                {operation.results.map((r) => (
                  <div key={r.timelineId} className="flex items-center gap-1.5">
                    {r.status === 'success'
                      ? <CheckCircle2 size={12} className="text-[var(--status-success,#22c55e)] shrink-0" />
                      : <AlertCircle size={12} className="text-[var(--status-error,#ef4444)] shrink-0" />}
                    <span className="truncate flex-1">{timelineNameById[r.timelineId] || r.timelineId}</span>
                    {r.status === 'error' && <span className="text-[10px] text-[var(--status-error,#ef4444)]">{r.error}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-12 border-t border-[var(--card-border,#f3f4f6)]">
          {step === 'result' ? (
            <>
              {operation?.status !== 'undone' && operation?.results?.some(r => r.status === 'success') && <button type="button" disabled={busy} className="h-8 px-3 rounded-lg border border-[var(--card-border)]" onClick={async () => {
                setBusy(true); setError(null);
                try { setOperation(await undoBulkImportOperation(operation.id)); }
                catch (e) { setError(e.message); }
                finally { setBusy(false); }
              }}>Hoàn tác lần nhập</button>}
              <button type="button" onClick={onClose} className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
                Đóng
              </button>
              {hasErrors && (
                <button
                  type="button" onClick={handleRetry} disabled={busy}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
                >
                  {busy && <Loader2 size={13} className="animate-spin" />} Thử lại lỗi
                </button>
              )}
            </>
          ) : step === 'preview' ? (
            <>
              <button type="button" onClick={() => setStep('pick')} disabled={busy} className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
                Quay lại
              </button>
              <button
                type="button" onClick={handleApply} disabled={busy}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              >
                {busy && <Loader2 size={13} className="animate-spin" />} Áp dụng
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
                Huỷ
              </button>
              <button
                type="button" onClick={handlePreview} disabled={busy || orderedAssetIds.length === 0}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />} Xem trước
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
