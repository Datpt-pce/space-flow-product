import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check } from 'lucide-react';
import { useVideoStore } from '../store.js';

export default function TimelineTransition({ track, fromClip, toClip, transition, timeToX, pxToMs, msToPx, onToggle }) {
  const [draft, setDraft] = useState(null), [menu, setMenu] = useState(null), menuRef = useRef(null);
  const cancelResizeRef = useRef(null);
  useEffect(() => () => cancelResizeRef.current?.(), []);
  const duration = draft ?? transition?.durationMs ?? 0;
  useEffect(() => {
    if (!menu) return;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !menuRef.current?.contains(e.target)) setMenu(null); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  const update = (key, value) => {
    const s = useVideoStore.getState(), index = s.projectState.transitions.findIndex(t => t.id === transition.id);
    s.execute('SetProperty', { path: ['transitions', index, key], from: s.projectState.transitions[index][key], to: value });
  };
  function resize(edge, event) {
    event.preventDefault(); event.stopPropagation(); if (track.locked) return;
    const origin = event.clientX, initial = transition.durationMs;
    const min = 1000 / (useVideoStore.getState().projectState.fps || 30);
    const max = Math.min(fromClip.timelineOutMs - fromClip.timelineInMs, toClip.timelineOutMs - toClip.timelineInMs) - min;
    let latest = initial;
    const move = e => {
      latest = Math.max(min, Math.min(max, initial + pxToMs(e.clientX - origin) * (edge === 'left' ? -2 : 2))); setDraft(latest);
      useVideoStore.getState().setLivePreviewPatch([{ transitionId: transition.id, path: ['durationMs'], value: latest }]);
    };
    const cleanup = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel); setDraft(null); cancelResizeRef.current = null; useVideoStore.getState().clearLivePreviewPatch(); };
    const up = () => { cleanup(); if (latest !== initial) update('durationMs', latest); };
    const cancel = () => cleanup();
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    cancelResizeRef.current = cancel;
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);
  }
  return <>
    <div className="absolute top-4 h-10 z-20 rounded border border-[var(--accent)] bg-[var(--accent-tint)]" style={{ left: timeToX(toClip.timelineInMs) - Math.max(16, msToPx(duration)) / 2, width: Math.max(16, msToPx(duration)) }}
      onMouseDown={e => e.stopPropagation()} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 190) }); }}>
      <button type="button" data-transition-marker={toClip.timelineInMs} disabled={track.locked} onClick={onToggle} className="w-full h-full flex items-center justify-center text-[var(--accent)]"
        aria-label={transition ? `Transition ${Math.round(duration)}ms — bấm để xoá` : 'Thêm transition (crossfade) giữa 2 clip'}
        title={`${transition?.type || 'crossfade'} · ${Math.round(duration)} ms · Phát hoặc tua qua vùng này để xem transition`}><ArrowLeftRight size={12} /></button>
      {transition && ['left', 'right'].map(edge => <div key={edge} role="separator" aria-label={`Kéo transition ${edge}`} aria-orientation="vertical" className="absolute top-0 bottom-0 w-2 cursor-ew-resize" style={{ [edge]: 0 }} onMouseDown={e => resize(edge, e)} />)}
    </div>
    {menu && <div ref={menuRef} role="menu" aria-label="Loại transition" className="fixed z-50 bg-[var(--card)] border border-[var(--card-border)] rounded-lg shadow-xl p-2 text-xs" style={{ left: menu.x, top: menu.y }}>
      {['crossfade', 'pull-in', 'pull-out'].map(type => <button key={type} type="button" role="menuitemradio" aria-checked={(transition?.type || 'crossfade') === type} disabled={track.locked} className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-[var(--accent-tint)]" onClick={() => {
        if (transition) update('type', type);
        else useVideoStore.getState().execute('AddTransition', { transition: { id: crypto.randomUUID(), fromClipId: fromClip.id, toClipId: toClip.id, type, durationMs: Math.min(500, (fromClip.timelineOutMs - fromClip.timelineInMs) / 2, (toClip.timelineOutMs - toClip.timelineInMs) / 2), params: {} } });
        setMenu(null);
      }}><Check aria-hidden="true" size={12} className={(transition?.type || 'crossfade') === type ? 'text-[var(--accent)]' : 'invisible'} />{type === 'crossfade' ? 'Cross fade' : type === 'pull-in' ? 'Pull-in' : 'Pull-out'}</button>)}
    </div>}
  </>;
}
