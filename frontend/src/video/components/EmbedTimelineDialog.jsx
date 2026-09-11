// EmbedTimelineDialog.jsx — 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md):
// picks ANOTHER timeline (video_projects row) to embed as a compound clip into the currently open
// one. Explicit dialog, not drag-and-drop (see ADR 0034 Follow-Up for why) — a drop target can't
// stay synchronous while the embed's render+promote round-trip is in flight. Mirrors
// CreateTimelinesDialog.jsx's own project-list-fetch + apply/cancel shell.

import { useDialogFocus } from '../useDialogFocus.js';
import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Film } from 'lucide-react';
import { fetchVideoProjects, fetchVideoProject } from '../../lib/api.js';
import { useVideoStore } from '../store.js';
import { computeInsertIndex, findNextFreeSlot } from '../timelineUtils.js';

function projectDurationMs(payload) {
  let maxMs = 0;
  for (const track of payload.tracks) {
    for (const clip of track.clips) maxMs = Math.max(maxMs, clip.timelineOutMs);
  }
  return maxMs;
}

export default function EmbedTimelineDialog({ onClose }) {
  const dialogRef = useDialogFocus(onClose);
  const project = useVideoStore((s) => s.project);
  const projectState = useVideoStore((s) => s.projectState);
  const playheadMs = useVideoStore((s) => s.playheadMs);
  const execute = useVideoStore((s) => s.execute);
  const embedTimelineAsCompoundClip = useVideoStore((s) => s.embedTimelineAsCompoundClip);

  const [projects, setProjects] = useState(null); // null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDurationMs, setSelectedDurationMs] = useState(null); // null while probing the pick
  const [trackChoice, setTrackChoice] = useState('__new__');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVideoProjects()
      .then((list) => { if (!cancelled) setProjects(list.filter((p) => p.id !== project?.id)); })
      .catch((err) => { if (!cancelled) { setProjects([]); setError(err.message); } });
    return () => { cancelled = true; };
  }, [project?.id]);

  useEffect(() => {
    if (!selectedId) { setSelectedDurationMs(null); return; }
    let cancelled = false;
    setSelectedDurationMs(null);
    fetchVideoProject(selectedId)
      .then((full) => { if (!cancelled) setSelectedDurationMs(projectDurationMs(full.payload)); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const videoTracks = (projectState?.tracks || []).filter((t) => t.type === 'video' && t.visible && !t.locked);

  async function handleApply() {
    if (!selectedId || selectedDurationMs == null) return;
    setSubmitting(true);
    setError(null);
    try {
      let trackId = trackChoice;
      if (trackId === '__new__') {
        const order = 1 + projectState.tracks.reduce((max, t) => Math.max(max, t.order), -1);
        trackId = crypto.randomUUID();
        execute('AddTrack', { track: { id: trackId, type: 'video', order, locked: false, muted: false, visible: true, clips: [] } });
      }
      const track = trackChoice === '__new__'
        ? { id: trackId, clips: [] }
        : videoTracks.find((t) => t.id === trackId);
      const startMs = findNextFreeSlot(track, playheadMs, selectedDurationMs, null);
      const index = computeInsertIndex(track, null, startMs);

      const picked = projects.find((p) => p.id === selectedId);
      onClose();
      await embedTimelineAsCompoundClip({
        timelineProjectId: selectedId, timelineProjectName: picked?.name || 'Timeline',
        trackId, index, timelineInMs: startMs,
      });
    } catch (err) {
      setSubmitting(false);
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Ghép timeline khác" className="w-[420px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-sm font-semibold text-[var(--text,#111827)]">Ghép timeline khác (compound clip)</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 text-xs">
          <p className="text-[var(--n600,#4b5563)]">
            Timeline được chọn sẽ được render và chèn vào timeline hiện tại như 1 clip video duy nhất, tại vị trí playhead.
          </p>

          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--n600,#4b5563)]">Chọn timeline để ghép</span>
            {projects === null ? (
              <p className="flex items-center gap-1.5 text-[var(--n600,#4b5563)] py-2"><Loader2 size={12} className="animate-spin" /> Đang tải danh sách…</p>
            ) : projects.length === 0 ? (
              <p className="text-[var(--n600,#4b5563)] py-2">Chưa có timeline nào khác để ghép.</p>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)]">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--n100,#f3f4f6)] ${selectedId === p.id ? 'bg-[var(--accent,#7C5CFA)]/10 text-[var(--accent,#7C5CFA)] font-medium' : 'text-[var(--n600,#4b5563)]'}`}
                  >
                    <Film size={12} className="shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedId && (
            <label className="flex flex-col gap-1">
              <span className="font-medium text-[var(--n600,#4b5563)]">Track đích</span>
              <select
                value={trackChoice}
                onChange={(e) => setTrackChoice(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              >
                <option value="__new__">Track video mới</option>
                {videoTracks.map((t, i) => <option key={t.id} value={t.id}>Track video #{i + 1}</option>)}
              </select>
            </label>
          )}

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
            disabled={submitting || !selectedId || selectedDurationMs == null}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--accent,#7C5CFA)] text-[var(--n0,#fff)] hover:bg-[var(--accent-strong,#6B46F0)] disabled:opacity-40 inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            Ghép
          </button>
        </div>
      </div>
    </div>
  );
}
