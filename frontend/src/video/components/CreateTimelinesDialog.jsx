// 08.2.4 (specs/ai-creative-operations-platform/08-2-4-asset-gallery-and-timeline-creation.md §4):
// "Creation dialog tóm tắt mode, count, order, naming, target collection và conflict" before
// batchCreateFromVideos() actually runs. Preview here is a CLIENT-SIDE approximation only (a
// fresh fetchVideoProjects() call for existing names, mirroring the server's own uniqueName()
// suffix logic) — not authoritative, the server resolves the real names/atomicity; see the
// 08.2.6+08.2.4 slice plan's "Preview tính hoàn toàn ở client" scope decision for why there's no
// separate `:preview` endpoint. No drag-to-reorder (same plan decision) — order is fixed to
// whatever order the caller's selection was already in (Gallery's current sort/filter).

import { useDialogFocus } from '../useDialogFocus.js';
import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { fetchVideoProjects } from '../../lib/api.js';

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function basenameNoExt(sourcePath) {
  return sourcePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
}

// uniqueNameLocal/takenNames: mirrors backend/routes/video-projects.js's uniqueName() exactly —
// same " (2)", " (3)"... deterministic suffix — so the preview shown here matches what Apply will
// actually create (barring a genuine race with another concurrent create, which the server alone
// resolves for real).
function uniqueNameLocal(candidate, takenNames) {
  if (!takenNames.has(candidate)) return candidate;
  let n = 2;
  while (takenNames.has(`${candidate} (${n})`)) n++;
  return `${candidate} (${n})`;
}

export default function CreateTimelinesDialog({ mode, orderedAssets, onClose, onConfirm }) {
  const dialogRef = useDialogFocus(onClose);
  const [baseName, setBaseName] = useState('Untitled Project');
  const [existingNames, setExistingNames] = useState(null); // null = still loading
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchVideoProjects()
      .then((list) => { if (!cancelled) setExistingNames(new Set(list.map((p) => p.name))); })
      .catch(() => { if (!cancelled) setExistingNames(new Set()); }); // preview-only — a failed fetch just skips collision preview, Apply still works
    return () => { cancelled = true; };
  }, []);

  const totalDurationMs = orderedAssets.reduce((sum, a) => sum + (a.durationMs || 0), 0);

  // previewNames: [{ assetId, name }] — one entry for one-video-one-timeline, or a single
  // combined-name entry for all-selected-one-timeline (assetId omitted).
  let previewNames = [];
  if (existingNames) {
    const taken = new Set(existingNames);
    if (mode === 'all-selected-one-timeline') {
      const name = uniqueNameLocal(baseName || 'Untitled Project', taken);
      previewNames = [{ name }];
    } else {
      previewNames = orderedAssets.map((asset) => {
        const name = uniqueNameLocal(basenameNoExt(asset.sourcePath), taken);
        taken.add(name);
        return { assetId: asset.id, name };
      });
    }
  }

  async function handleApply() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(mode, orderedAssets.map((a) => a.id), mode === 'all-selected-one-timeline' ? baseName : undefined);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Tạo timeline" className="w-[420px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-sm font-semibold text-[var(--text,#111827)]">
            {mode === 'all-selected-one-timeline' ? 'Tạo 1 timeline chứa tất cả' : 'Tạo 1 timeline mỗi video'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 text-xs">
          <p className="text-[var(--n600,#4b5563)]">
            {orderedAssets.length} video · tổng thời lượng {formatDuration(totalDurationMs)} · thứ tự theo Media Bin hiện tại
          </p>

          {mode === 'all-selected-one-timeline' && (
            <label className="flex flex-col gap-1">
              <span className="font-medium text-[var(--n600,#4b5563)]">Tên timeline</span>
              <input
                type="text"
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              />
            </label>
          )}

          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--n600,#4b5563)]">
              {mode === 'all-selected-one-timeline' ? 'Thứ tự clip trên Track 1' : 'Tên timeline sẽ tạo'}
            </span>
            {existingNames === null ? (
              <p className="flex items-center gap-1.5 text-[var(--n600,#4b5563)]"><Loader2 size={12} className="animate-spin" /> Đang tính tên…</p>
            ) : mode === 'all-selected-one-timeline' ? (
              <ol className="flex flex-col gap-0.5 list-decimal list-inside">
                {orderedAssets.map((a) => (
                  <li key={a.id} className="truncate text-[var(--n600,#4b5563)]" title={a.sourcePath}>{basenameNoExt(a.sourcePath)}</li>
                ))}
              </ol>
            ) : (
              <ol className="flex flex-col gap-0.5 list-decimal list-inside">
                {previewNames.map((p) => (
                  <li key={p.assetId} className="truncate text-[var(--n600,#4b5563)]">{p.name}</li>
                ))}
              </ol>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-[var(--status-error,#ef4444)]"><AlertCircle size={12} className="shrink-0" /> {error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-12 border-t border-[var(--card-border,#f3f4f6)]">
          <button type="button" onClick={onClose} disabled={submitting} className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={submitting || existingNames === null}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}
