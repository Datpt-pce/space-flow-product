import { useEffect, useState } from 'react';
import { subscribePeaks } from '../waveform.js';

export default function AudioWaveform({ assetId, sourcePath, clip, durationMs, width }) {
  const [peaks, setPeaks] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!assetId || !sourcePath) return;
    let cancelled = false;
    setFailed(false); setPeaks(null);
    subscribePeaks(assetId, sourcePath, (p) => { if (!cancelled) { setPeaks(p); setFailed(!p); } });
    return () => { cancelled = true; };
  }, [assetId, sourcePath]);
  if (!peaks) return <span className="text-[9px] opacity-60" aria-label={failed ? 'Không đọc được sóng âm' : 'Đang tải sóng âm'}>{failed ? 'Không đọc được sóng âm' : 'Đang tải sóng âm…'}</span>;
  const count = Math.max(2, Math.min(600, Math.round(width / 3)));
  const start = Math.max(0, Math.floor(clip.sourceInMs / durationMs * peaks.length));
  const end = Math.min(peaks.length, Math.ceil(clip.sourceOutMs / durationMs * peaks.length));
  const bucketSize = (end - start) / count;
  const bars = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const bucket = clip.speed < 0 ? count - 1 - i : i;
    for (let j = Math.floor(start + bucket * bucketSize); j < Math.min(peaks.length, Math.ceil(start + (bucket + 1) * bucketSize)); j++) max = Math.max(max, peaks[j]);
    bars.push(max);
  }
  return (
    <div data-audio-waveform="true" className="absolute inset-0 flex items-center gap-px px-0.5 pointer-events-none overflow-hidden" aria-hidden="true">
      {bars.map((v, i) => (
        <div key={i} className="flex-1 bg-[var(--status-done,#22c55e)]/50 rounded-sm" style={{ height: `${Math.max(8, v * 90)}%` }} />
      ))}
    </div>
  );
}

