// TimelineDashboard.jsx — 08-F F6 (specs/.../08-v2/08-f-timeline-authoring.md): the real Dashboard
// the work package's acceptance §6 asks for ("Dashboard 10 timeline chọn 3 qua filter/virtualization
// chính xác"), on top of the minimal group-badge slice ProjectSwitcher already ships (see the note
// at the top of video-collection-badge.spec.js). Scope decision (not a formal ADR — this doesn't
// touch canonical model/public API): literal list virtualization (windowing) is deferred until a
// real collection size shows plain rendering is too slow — every video_timeline_collections group
// today is created by one Gallery batch-create call, realistically dozens of rows at most. What the
// acceptance test actually exercises is SELECTION ACCURACY under a search filter: `selectedIds` is
// a Set of timeline IDs, independent of which rows the filter currently shows, so selecting 3 then
// typing a filter that hides some of them (or clearing it again) never loses or reattributes a
// selection — the property a naive index-keyed virtualized list is the one most likely to break.
//
// Thumbnails/duration/track-counts/review-QC-render-status/sort columns from the old 08-2-5 spec are
// OUT of this slice — no consumer needs them yet (no per-timeline review/QC/render status even
// exists as a queryable concept in 08-B/08-I today), and adding hardcoded placeholder columns would
// be speculative UI. Bulk actions on the selection (08-F F8, "BulkTimelineImportOperation") are a
// separate work package — `onBulkAction`/`bulkActionLabel` are optional so this component stays
// usable standalone and gains the action bar only once a real caller passes one in.

import { useDialogFocus } from '../useDialogFocus.js';
import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertCircle, Search, LayoutGrid } from 'lucide-react';
import { fetchTimelineCollectionGroup } from '../../lib/api.js';

export default function TimelineDashboard({ collectionId, currentProjectId, onOpenProject, onClose, onBulkAction, bulkActionLabel }) {
  const dialogRef = useDialogFocus(onClose);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetchTimelineCollectionGroup(collectionId)
      .then((group) => { if (!cancelled) setData(group); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [collectionId]);

  const timelines = data?.timelines || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return timelines;
    return timelines.filter((t) => t.name.toLowerCase().includes(q));
  }, [timelines, query]);

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedList = timelines.filter((t) => selectedIds.has(t.id));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Dashboard" className="w-[560px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text,#111827)]">
            <LayoutGrid size={14} /> Dashboard{data?.name ? ` — ${data.name}` : ''}
          </h2>
          <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
          <label className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-[var(--n600,#4b5563)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Lọc theo tên timeline…"
              aria-label="Lọc theo tên timeline"
              className="w-full h-8 pl-8 pr-2 text-xs rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            />
          </label>
          <p className="text-[11px] text-[var(--n600,#4b5563)]">
            {data ? `Hiển thị ${filtered.length}/${timelines.length} timeline` : ' '}
            {selectedIds.size > 0 && ` · Đã chọn ${selectedIds.size}`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 text-xs">
          {data === null && !error && (
            <p className="flex items-center gap-1.5 text-[var(--n600,#4b5563)] px-2 py-3"><Loader2 size={12} className="animate-spin" /> Đang tải…</p>
          )}
          {error && (
            <p className="flex items-center gap-1.5 text-[var(--status-error,#ef4444)] px-2 py-3"><AlertCircle size={12} className="shrink-0" /> {error}</p>
          )}
          {data && filtered.length === 0 && (
            <p className="text-[var(--n600,#4b5563)] px-2 py-3">Không có timeline nào khớp bộ lọc.</p>
          )}
          {filtered.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--n100,#f3f4f6)]">
              <input
                type="checkbox"
                checked={selectedIds.has(t.id)}
                onChange={() => toggleSelected(t.id)}
                aria-label={`Chọn ${t.name}`}
                className="shrink-0 accent-[var(--accent,#7C5CFA)]"
              />
              <button
                type="button"
                onClick={() => onOpenProject(t.id, t.name)}
                className={`flex-1 min-w-0 text-left truncate ${t.id === currentProjectId ? 'text-[var(--accent,#7C5CFA)] font-medium' : 'text-[var(--n600,#4b5563)]'}`}
              >
                {t.name}
                {t.id === currentProjectId && <span className="ml-1.5 text-[10px] text-[var(--n600,#4b5563)]">(đang mở)</span>}
              </button>
              <span className="shrink-0 text-[10px] text-[var(--n600,#4b5563)]">
                {new Date(t.updatedAt || t.updated_at).toLocaleDateString('vi-VN')}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-12 border-t border-[var(--card-border,#f3f4f6)]">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            Đóng
          </button>
          {onBulkAction && (
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => onBulkAction(selectedList)}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              {bulkActionLabel || 'Áp dụng'} {selectedIds.size > 0 && `(${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
