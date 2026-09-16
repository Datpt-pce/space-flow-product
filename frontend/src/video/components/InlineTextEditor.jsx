import { useEffect, useRef, useState } from 'react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';
import { vectorSize } from '@shared/video-vector';
import { computeCanvasPlacement } from '@shared/video-transform';
import { evaluateClipTransform } from '@shared/video-keyframes';

export default function InlineTextEditor({ clip, mediaRect, resolution, playheadMs, onClose }) {
  const [draft, setDraft] = useState(clip.text.content), cancelled = useRef(false), finished = useRef(false);
  useEffect(() => () => useVideoStore.getState().clearLivePreviewPatch(), []);
  if (!mediaRect) return null;
  const p = clip.text, placement = computeCanvasPlacement(evaluateClipTransform(clip, playheadMs - clip.timelineInMs), resolution, vectorSize(clip));
  const scale = mediaRect.width / resolution.width;
  const finish = () => {
    if (finished.current) return; finished.current = true;
    const s = useVideoStore.getState(), location = findClipLocation(s.projectState, clip.id);
    if (!cancelled.current && location && !location.track.locked && draft !== location.clip.text.content) {
      s.execute('SetProperty', { path: ['tracks', s.projectState.tracks.indexOf(location.track), 'clips', location.index, 'text', 'content'], from: location.clip.text.content, to: draft });
    }
    s.clearLivePreviewPatch(); onClose();
  };
  return <textarea autoFocus aria-label="Sửa chữ trên preview" value={draft}
    className="absolute z-40 resize-none rounded border border-[var(--accent)] outline-none bg-[var(--card)]/90"
    style={{ left: mediaRect.left + placement.destX * scale, top: mediaRect.top + placement.destY * scale,
      width: placement.destWidth * scale, height: placement.destHeight * scale,
      fontFamily: p.fontFamily, fontSize: p.fontSize * scale * (clip.transform?.scaleY || 1), fontWeight: p.bold ? 700 : 400,
      fontStyle: p.italic ? 'italic' : 'normal', textAlign: p.align, color: 'var(--text)',
      lineHeight: `${((p.fontSize || 72) * (p.lineHeight || 1.2) + (p.lineSpacing || 0)) * scale}px`,
      letterSpacing: (p.letterSpacing || 0) * scale,
      transform: `rotate(${placement.rotationRadians}rad)`, transformOrigin: 'center' }}
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    onChange={e => { setDraft(e.target.value); useVideoStore.getState().setLivePreviewPatch([{ clipId: clip.id, path: ['text', 'content'], value: e.target.value }]); }}
    onBlur={finish} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { cancelled.current = true; finish(); } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') finish(); }} />;
}
