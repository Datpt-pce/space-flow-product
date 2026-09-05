import { useState } from 'react';
import { useVideoStore } from '../store.js';
import { computeSpeedResizedDuration } from '../timelineUtils.js';
import PropertyField from './PropertyField.jsx';
export default function ClipSpeedPanel({ clip, track }) {
  const execute = useVideoStore(s => s.execute);
  const [error, setError] = useState('');
  const setSpeed = speed => {
    try {
      execute('SetClipSpeed', { trackId: track.id, clipId: clip.id,
        from: { speed: clip.speed ?? 1, timelineOutMs: clip.timelineOutMs },
        to: { speed, timelineOutMs: clip.timelineInMs + computeSpeedResizedDuration(clip, speed) } });
      setError('');
    } catch (e) { setError(e.message); }
  };
  return <fieldset disabled={track.locked} className="space-y-3">
    <PropertyField label="Tốc độ (×)" value={Math.abs(clip.speed ?? 1)} min={0.1} max={16} step={0.1} onCommit={speed => setSpeed((clip.speed < 0 ? -1 : 1) * speed)} />
    <PropertyField label="Đảo ngược" type="checkbox" value={clip.speed < 0} onCommit={reverse => setSpeed(Math.abs(clip.speed || 1) * (reverse ? -1 : 1))} />
    {clip.speed < 0 && <p className="text-[var(--n600)]">Âm thanh đảo ngược nghe trong Xem bản render. Preview tương tác chỉ phát hình đảo ngược.</p>}
    <p className="text-[var(--n600)]">Thời lượng: {((clip.timelineOutMs - clip.timelineInMs) / 1000).toFixed(2)} giây</p>
    <button type="button" onClick={() => setSpeed(1)} className="rounded border border-[var(--card-border)] px-2 py-1">Đặt lại tốc độ</button>
    {error && <p role="alert" className="text-[var(--status-error)]">{error}</p>}
  </fieldset>;
}
