import { useRef, useState } from 'react';
import { maskSvg } from '@shared/video-mask';
import PropertyField from './PropertyField.jsx';

export default function MaskDrawing({ mask, onChange, disabled }) {
  const [drawing, setDrawing] = useState(null), pointsRef = useRef(null);
  const point = e => { const box = e.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - box.x) / box.width)), Math.max(0, Math.min(1, (e.clientY - box.y) / box.height))]; };
  const paths = [...(mask.paths || []), ...(drawing ? [drawing] : [])];
  return <div className="space-y-2">
    {mask.type === 'text' ? <>
      <PropertyField label="Chữ trong mask" type="text" value={mask.text || 'TEXT'} onCommit={value => onChange('text', value.slice(0, 200))} />
      <PropertyField label="Cỡ chữ mask" value={mask.fontSize || 300} min={20} max={800} onCommit={value => onChange('fontSize', value)} />
    </> : <>
      {mask.type === 'brush' && <PropertyField label="Cỡ cọ mask" value={Math.round((mask.brushWidth || .1) * 100)} min={1} max={50} onCommit={value => onChange('brushWidth', value / 100)} />}
      <p className="text-[var(--n600)]">{mask.type === 'brush' ? 'Kéo để tô vùng giữ lại.' : 'Kéo vẽ đường bao kín của vùng giữ lại.'} Trắng: giữ; đen: ẩn.</p>
      <div role="img" aria-label="Vùng vẽ mask" tabIndex={0} className="relative aspect-square w-full touch-none rounded-lg overflow-hidden border border-[var(--card-border)] cursor-crosshair"
        onPointerDown={e => { if (disabled || e.button !== 0 || (mask.paths || []).length >= 64) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); pointsRef.current = [point(e)]; setDrawing(pointsRef.current); }}
        onPointerMove={e => { if (!pointsRef.current || pointsRef.current.length >= 256) return; const next = point(e), last = pointsRef.current.at(-1); if (Math.hypot(next[0] - last[0], next[1] - last[1]) < .005) return; pointsRef.current = [...pointsRef.current, next]; setDrawing(pointsRef.current); }}
        onPointerUp={() => { if (pointsRef.current?.length >= (mask.type === 'draw' ? 3 : 2)) onChange('paths', [...(mask.paths || []), pointsRef.current]); pointsRef.current = null; setDrawing(null); }}
        onPointerCancel={() => { pointsRef.current = null; setDrawing(null); }}
        onKeyDown={e => { if (e.key === 'Escape') { pointsRef.current = null; setDrawing(null); e.stopPropagation(); } }}>
        <img draggable={false} alt="" className="w-full h-full pointer-events-none" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(maskSvg({ ...mask, x: .5, y: .5, width: 1, height: 1, rotation: 0, paths }))}`} />
      </div>
      <div className="flex gap-2">
        <button type="button" className="h-8 px-2 rounded border border-[var(--card-border)] disabled:opacity-40" disabled={!mask.paths?.length} onClick={() => onChange('paths', mask.paths.slice(0, -1))}>Bỏ nét cuối</button>
        <button type="button" className="h-8 px-2 rounded border border-[var(--card-border)] disabled:opacity-40" disabled={!mask.paths?.length} onClick={() => onChange('paths', [])}>Xoá nét vẽ</button>
      </div>
    </>}
  </div>;
}
