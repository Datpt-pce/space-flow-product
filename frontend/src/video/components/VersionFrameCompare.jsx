import { useEffect, useRef, useState } from 'react';
import { startRenderJob, streamRenderJob, videoVersionRequest } from '../../lib/api.js';
import { useVideoStore } from '../store.js';

const button = 'rounded border border-[var(--card-border)] px-3 py-2 text-xs disabled:opacity-40';
export default function VersionFrameCompare({ projectId, left, right, onClose }) {
  const [jobs, setJobs] = useState({});
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [durations, setDurations] = useState({});
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState('none');
  const [fps, setFps] = useState(24);
  const videos = useRef({});
  const clock = useRef(null);
  const ready = ['left', 'right'].every(side => durations[side] > 0);
  const duration = Math.max(...Object.values(durations), 0);

  useEffect(() => {
    let disposed = false;
    const stops = [];
    useVideoStore.getState().pause();
    setJobs({}); setError(''); setDurations({}); setTime(0); setPlaying(false);
    for (const [side, version] of [['left', left], ['right', right]]) {
      (async () => {
        const pin = await videoVersionRequest(projectId, `/${version.id}`);
        if (side === 'left' && !disposed) setFps(pin.document.fps || 24);
        if (disposed) return;
        const id = await startRenderJob(projectId, 'original', { versionId: version.id, idempotencyKey: `frame-compare-${version.id}` });
        if (disposed) return;
        setJobs(j => ({ ...j, [side]: { id, status: 'queued' } }));
        stops.push(streamRenderJob(projectId, id, update => {
          if (!disposed) setJobs(j => ({ ...j, [side]: { ...j[side], ...update } }));
        }));
      })().catch(e => { if (!disposed) setError(e.message); });
    }
    return () => { disposed = true; stops.forEach(stop => stop()); };
  }, [projectId, left.id, right.id]);

  function seek(next) {
    const seconds = Math.max(0, Math.min(duration, next));
    setPlaying(false); setTime(seconds);
    for (const video of Object.values(videos.current)) if (video) {
      video.pause(); video.currentTime = Math.min(seconds, Math.max(0, video.duration - 0.001));
    }
  }
  useEffect(() => {
    if (!playing) { Object.values(videos.current).forEach(v => v?.pause()); return undefined; }
    let cancelled = false;
    const start = performance.now() - time * 1000;
    Promise.all(Object.values(videos.current).map(v => v?.play())).catch(e => { if (!cancelled) { setError(e.message); setPlaying(false); } });
    function tick(now) {
      const seconds = Math.min(duration, (now - start) / 1000);
      setTime(seconds);
      for (const video of Object.values(videos.current)) if (video && seconds < video.duration && Math.abs(video.currentTime - seconds) > 0.08) video.currentTime = seconds;
      if (seconds >= duration) setPlaying(false);
      else clock.current = requestAnimationFrame(tick);
    }
    clock.current = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(clock.current); Object.values(videos.current).forEach(v => v?.pause()); };
    // Start a new clock only for an explicit play/pause action, not every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  return <section aria-label="So sánh hình hai bản lưu" className="space-y-3 border rounded-lg border-[var(--card-border)] p-3">
    <div className="flex justify-between gap-2 items-center"><h3 className="text-sm font-semibold">So sánh hình tại cùng thời điểm</h3><button type="button" className={button} onClick={onClose}>Đóng so sánh hình</button></div>
    <p className="text-xs text-[var(--n600)]">Hai video xuất từ đúng bản lưu. Bản ngắn hơn giữ hình cuối khi bản còn lại tiếp tục.</p>
    {error && <p role="alert" className="text-xs text-[var(--video-error)]">{error}</p>}
    <div className="grid grid-cols-2 gap-3">{[['left', left], ['right', right]].map(([side, version]) => <div key={side} className="min-w-0">
      <p className="text-xs mb-1 break-words">{version.name} · r{version.seq}</p>
      {jobs[side]?.status === 'done' ? <video ref={v => { videos.current[side] = v; }} aria-label={side === 'left' ? 'Video bản bên trái' : 'Video bản bên phải'} preload="auto" muted={sound !== side}
        onLoadedMetadata={e => setDurations(d => ({ ...d, [side]: e.target.duration }))}
        onError={() => setError('Không đọc được video đã render. Tạo lại bản xem từ cửa sổ xuất.')}
        className="w-full max-h-[32dvh] bg-black rounded" src={`/api/video-render/${projectId}/render/${jobs[side].id}/download?inline=1`} />
        : <p role="status" className="text-xs">{jobs[side]?.error_message || (jobs[side]?.status === 'cancelled' ? 'Đã hủy render.' : `Đang tạo bản xem… ${Math.round(jobs[side]?.progress_pct || 0)}%`)}</p>}
    </div>)}</div>
    <label className="flex items-center gap-2 text-xs">Thời điểm so sánh
      <input className="flex-1 min-w-0" aria-label="Thời điểm so sánh" type="range" disabled={!ready} min="0" max={duration} step={1 / fps} value={time} onChange={e => seek(Number(e.target.value))} />
      <output>{time.toFixed(2)}s / {duration.toFixed(2)}s</output>
    </label>
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" className={button} disabled={!ready} onClick={() => seek(time - 1 / fps)}>Lùi một khung hình</button>
      <button type="button" className={button} disabled={!ready} onClick={() => { if (!playing && time >= duration) seek(0); setPlaying(!playing); }}>{playing ? 'Dừng hai video' : 'Phát hai video'}</button>
      <button type="button" className={button} disabled={!ready} onClick={() => seek(time + 1 / fps)}>Tiến một khung hình</button>
      <select aria-label="Âm thanh so sánh" className="text-xs border rounded p-2 bg-[var(--card)]" value={sound} onChange={e => setSound(e.target.value)}><option value="none">Tắt âm</option><option value="left">Nghe bản trái</option><option value="right">Nghe bản phải</option></select>
    </div>
  </section>;
}
