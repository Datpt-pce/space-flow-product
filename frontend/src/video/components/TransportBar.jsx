// 08-UI §6.2 Priority 0 bước 4: Transport bar riêng dưới Preview — thay VideoToolbar.jsx (đã xoá,
// action theo-selection dời sang Timeline toolbar duy nhất, xem Timeline.jsx). Chỉ giữ đúng những
// gì §6.2 liệt kê cho transport: seek previous/next, play/pause, timecode, volume, view action
// (Fit/100%) — không có editing action nào ở đây.
import { useState } from 'react';
import { ChevronFirst, ChevronLast, Play, Pause, Volume2, VolumeX, Maximize, Frame } from 'lucide-react';
import { useVideoStore } from '../store.js';
import { SHORTCUTS } from '../shortcuts.js';
import AspectRatioControl from './AspectRatioControl.jsx';

function formatTimecode(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const frames = Math.floor((totalMs % 1000) / 33);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// getClipBoundaries: mọi mốc timelineIn/Out của mọi clip trên mọi track, dùng cho seek previous/
// next (nhảy giữa các "điểm cắt" thay vì tua liên tục — đúng nghĩa "seek" của 1 transport bar,
// khác với ArrowLeft/Right frame-step đã có sẵn ở Timeline.jsx).
function getClipBoundaries(projectState) {
  const set = new Set([0]);
  for (const t of projectState.tracks) {
    for (const c of t.clips) { set.add(c.timelineInMs); set.add(c.timelineOutMs); }
  }
  return [...set].sort((a, b) => a - b);
}

export default function TransportBar({ zoomMode, setZoomMode, previewVolume, setPreviewVolume }) {
  const projectState = useVideoStore((s) => s.projectState);
  const playheadMs = useVideoStore((s) => s.playheadMs);
  const setPlayheadMs = useVideoStore((s) => s.setPlayheadMs);
  const isPlaying = useVideoStore((s) => s.isPlaying);
  const togglePlay = useVideoStore((s) => s.togglePlay);
  const [mutedBefore, setMutedBefore] = useState(1);

  function seekPrev() {
    if (!projectState) return;
    const boundaries = getClipBoundaries(projectState);
    const prev = [...boundaries].reverse().find((b) => b < playheadMs - 1);
    setPlayheadMs(prev ?? 0);
  }
  function seekNext() {
    if (!projectState) return;
    const boundaries = getClipBoundaries(projectState);
    const next = boundaries.find((b) => b > playheadMs + 1);
    if (next !== undefined) setPlayheadMs(next);
  }
  function toggleMute() {
    if (previewVolume > 0) { setMutedBefore(previewVolume); setPreviewVolume(0); }
    else setPreviewVolume(mutedBefore || 1);
  }

  function iconBtn(icon, label, onClick, disabled = false) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 shrink-0 border-t border-[var(--card-border,#f3f4f6)] bg-[var(--card,#fff)]">
      {iconBtn(<ChevronFirst size={16} />, 'Về điểm cắt trước', seekPrev, !projectState)}
      {iconBtn(isPlaying ? <Pause size={16} /> : <Play size={16} />, `${isPlaying ? 'Tạm dừng' : 'Phát'} (${SHORTCUTS.togglePlay})`, togglePlay)}
      {iconBtn(<ChevronLast size={16} />, 'Tới điểm cắt sau', seekNext, !projectState)}
      <span className="font-mono tabular-nums text-xs text-[var(--text,#111827)] px-1 shrink-0">{formatTimecode(playheadMs)}</span>
      <div className="flex-1" />
      {iconBtn(previewVolume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />, previewVolume > 0 ? 'Tắt tiếng preview' : 'Bật tiếng preview', toggleMute)}
      <input
        type="range" min={0} max={1} step={0.05} value={previewVolume}
        onChange={(e) => setPreviewVolume(parseFloat(e.target.value))}
        title="Âm lượng preview" aria-label="Âm lượng preview"
        className="w-20 accent-[var(--accent,#7C5CFA)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
      />
      <div className="w-px h-5 bg-[var(--card-border,#e5e7eb)] mx-1" />
      <div className="flex items-center rounded-lg border border-[var(--card-border,#e5e7eb)] overflow-hidden">
        <button
          type="button" title="Fit khung preview" aria-label="Fit khung preview"
          onClick={() => setZoomMode('fit')}
          className={`w-8 h-8 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] ${zoomMode === 'fit' ? 'bg-[var(--accent-tint,#EDE9FE)] text-[var(--accent,#7C5CFA)]' : 'text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)]'}`}
        >
          <Frame size={15} />
        </button>
        <button
          type="button" title="Xem 100% (pixel thật)" aria-label="Xem 100% (pixel thật)"
          onClick={() => setZoomMode('100')}
          className={`w-8 h-8 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] ${zoomMode === '100' ? 'bg-[var(--accent-tint,#EDE9FE)] text-[var(--accent,#7C5CFA)]' : 'text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)]'}`}
        >
          <Maximize size={15} />
        </button>
      </div>
      <AspectRatioControl />
    </div>
  );
}
