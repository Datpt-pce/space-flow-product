// 08-G Graph Editor V1 (ADR 0037, docs/decisions/0037-graph-editor-value-time-plot-v1.md; ADR 0036's
// own Follow-Up already anticipated this as "its own ADR"): a real value-vs-time plot across the
// clip's own duration/value range, generalizing BezierEasingEditor.jsx's abstract [0,1] unit-square
// idiom to the actual property's axis. Deliberately NOT a schema change — V1 keeps the existing
// one-bezier-per-segment model (shared/video-keyframes.js, ADR 0036) and only changes HOW that same
// data is drawn/edited: the tangent handles for the SELECTED segment are the exact same
// easingX1/Y1/X2/Y2 unit-square control points BezierEasingEditor already edits, just mapped onto
// that segment's own real time/value rectangle instead of a fixed abstract square. Independent
// Incoming/outgoing tangents at an interior keyframe already belong to two different
// segment records. Editing one does not constrain the other (ADR 0039 refinement).
//
// Pure presentational + gesture component, same contract as BezierEasingEditor.jsx: reports a FINAL
// {x1,y1,x2,y2} via onCommitTangents(keyframeId, changes) only on mouseup — Timeline.jsx decides
// what command that is (SetKeyframeFields, already generic enough, no new command needed).
// Click-outside/onClose is handled by the caller, matching every other popover in this codebase.

import { useState, useRef, useEffect, useMemo } from 'react';
import { TRANSFORM_KEYS, keyframesForProperty, isPropertyAnimated, interpolateAtTime } from '@shared/video-keyframes';

const WIDTH = 360;
const HEIGHT = 200;
const PAD_X = 16;
const PAD_Y = 16;
const SAMPLE_STEPS = 96; // fine enough to look smooth at this size, cheap enough to resample on every drag tick
const SEGMENT_Y_MIN = -0.5; // same abstract-square convention as BezierEasingEditor.jsx, mapped onto the segment's own value delta instead of a fixed [0,1]
const SEGMENT_Y_MAX = 1.5;

// PROPERTY_LABEL: short display names — same 8 keys shared/video-keyframes.js's TRANSFORM_KEYS
// defines, no new property ever animatable here.
const PROPERTY_LABEL = {
  x: 'Position X', y: 'Position Y', scaleX: 'Scale X', scaleY: 'Scale Y',
  rotation: 'Rotation', opacity: 'Opacity', pivotX: 'Pivot X', pivotY: 'Pivot Y',
};

function clipDurationMs(clip) {
  return Math.max(1, clip.timelineOutMs - clip.timelineInMs);
}

// sampleCurve(clip, key, steps) -> [{ms, value}] — reuses interpolateAtTime() directly (the SAME
// evaluator Canvas/Inspector/Timeline read, per 08-g's §4 acceptance: "Canvas/Inspector/Timeline/
// Graph đọc cùng evaluated value tại playhead") rather than re-deriving the curve shape from
// easing math — guarantees this plot can never drift from what preview/export actually produce.
function sampleCurve(clip, key, steps) {
  const kfs = keyframesForProperty(clip, `transform.${key}`);
  if (kfs.length === 0) return [];
  const durationMs = clipDurationMs(clip);
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const ms = (i / steps) * durationMs;
    points.push({ ms, value: interpolateAtTime(kfs, ms) });
  }
  return points;
}

function axisRangeFor(points) {
  if (points.length === 0) return { min: 0, max: 1 };
  let min = points[0].value;
  let max = points[0].value;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const range = max - min;
  const pad = range > 0 ? range * 0.1 : (Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1);
  return { min: min - pad, max: max + pad };
}

export default function GraphEditorPanel({ x, y, clip, initialPropertyKey, onCommitTangents, onClose, docked = false, onDock }) {
  const animatedKeys = useMemo(() => TRANSFORM_KEYS.filter((k) => isPropertyAnimated(clip, k)), [clip]);
  const [selectedKey, setSelectedKey] = useState(
    animatedKeys.includes(initialPropertyKey) ? initialPropertyKey : (animatedKeys[0] || null)
  );
  const keyframes = selectedKey ? keyframesForProperty(clip, `transform.${selectedKey}`) : [];
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0); // index into `keyframes` — the segment STARTING at this keyframe
  useEffect(() => { setSelectedSegmentIndex(0); }, [selectedKey]);

  const draggingRef = useRef(null); // 'p1' | 'p2' | null — mirrors BezierEasingEditor.jsx's own draggingRef
  const startKf = keyframes[selectedSegmentIndex];
  const endKf = keyframes[selectedSegmentIndex + 1];
  const hasEditableSegment = !!startKf && !!endKf;
  const initialDraft = hasEditableSegment
    ? (startKf.easing === 'custom'
        ? { x1: startKf.easingX1, y1: startKf.easingY1, x2: startKf.easingX2, y2: startKf.easingY2 }
        : { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 })
    : null;
  const [draft, setDraft] = useState(initialDraft);
  // Resync when the caller's underlying data changes for a reason OTHER than this component's own
  // commit (undo/redo, a different gesture elsewhere) — same guard BezierEasingEditor.jsx uses.
  useEffect(() => {
    if (draggingRef.current === null) setDraft(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKf?.easingX1, startKf?.easingY1, startKf?.easingX2, startKf?.easingY2, startKf?.easing, selectedSegmentIndex]);

  const svgRef = useRef(null);
  const points = useMemo(() => (selectedKey ? sampleCurve(clip, selectedKey, SAMPLE_STEPS) : []), [clip, selectedKey]);
  const axis = useMemo(() => axisRangeFor(points), [points]);
  const durationMs = clipDurationMs(clip);

  const xForMs = (ms) => PAD_X + (ms / durationMs) * (WIDTH - 2 * PAD_X);
  const yForValue = (v) => (HEIGHT - PAD_Y) - ((v - axis.min) / (axis.max - axis.min)) * (HEIGHT - 2 * PAD_Y);
  const msForX = (sx) => Math.max(0, Math.min(durationMs, ((sx - PAD_X) / (WIDTH - 2 * PAD_X)) * durationMs));
  const valueForY = (sy) => axis.min + ((HEIGHT - PAD_Y - sy) / (HEIGHT - 2 * PAD_Y)) * (axis.max - axis.min);

  // ghostCurvesForOtherProperties: multi-property overlay (08-G Graph Editor acceptance) — each
  // OTHER animated property, normalized to ITS OWN min/max (different units entirely — pixels vs
  // degrees vs a 0-1 ratio — so overlaying them meaningfully means normalizing each to its own
  // range, not the selected property's real axis). Display-only, never interactive.
  const ghostCurves = useMemo(() => {
    return animatedKeys
      .filter((k) => k !== selectedKey)
      .map((k) => {
        const pts = sampleCurve(clip, k, SAMPLE_STEPS);
        const { min, max } = axisRangeFor(pts);
        const norm = (v) => (max === min ? 0.5 : (v - min) / (max - min));
        return {
          key: k,
          d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xForMs(p.ms)} ${(HEIGHT - PAD_Y) - norm(p.value) * (HEIGHT - 2 * PAD_Y)}`).join(' '),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, selectedKey, animatedKeys, durationMs, axis.min, axis.max]);

  if (!selectedKey) return null; // no animated property on this clip at all — caller should not open this in that case, but stay defensive

  const mainPathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xForMs(p.ms)} ${yForValue(p.value)}`).join(' ');

  // segment-local unit-square -> world -> screen, same mapping shape as BezierEasingEditor.jsx's
  // toScreenX/toScreenY but re-derived per segment (segment's own time/value span instead of a
  // fixed [0,1] square) — see this file's header comment for why this is still the same underlying
  // control-point data, just drawn in place instead of in an abstract popover.
  const segWorldMsForU = (u) => startKf.timeMs + u * (endKf.timeMs - startKf.timeMs);
  const segWorldValueForFrac = (frac) => startKf.value + frac * (endKf.value - startKf.value);
  const segScreenForUnit = (u, frac) => ({ x: xForMs(segWorldMsForU(u)), y: yForValue(segWorldValueForFrac(frac)) });
  const segUnitForScreen = (sx, sy) => {
    const worldMs = msForX(sx);
    const worldValue = valueForY(sy);
    const denomMs = endKf.timeMs - startKf.timeMs || 1;
    const denomValue = endKf.value - startKf.value;
    const u = Math.max(0, Math.min(1, (worldMs - startKf.timeMs) / denomMs));
    const frac = denomValue === 0 ? 0 : (worldValue - startKf.value) / denomValue;
    return { u, frac };
  };

  function handlePointerDown(which) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = which;
      let latest = draft; // plain closure variable, not React state — same reasoning as BezierEasingEditor.jsx (an updater callback could double-fire the eventual command)
      function onMove(ev) {
        const rect = svgRef.current.getBoundingClientRect();
        const sx = ((ev.clientX - rect.left) / rect.width) * WIDTH;
        const sy = ((ev.clientY - rect.top) / rect.height) * HEIGHT;
        const { u, frac } = segUnitForScreen(sx, sy);
        const clampedFrac = Math.max(SEGMENT_Y_MIN, Math.min(SEGMENT_Y_MAX, frac));
        latest = which === 'p1' ? { ...latest, x1: u, y1: clampedFrac } : { ...latest, x2: u, y2: clampedFrac };
        setDraft(latest);
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        draggingRef.current = null;
        const changes = [
          { field: 'easing', from: startKf.easing, to: 'custom' },
          { field: 'easingX1', from: startKf.easingX1, to: latest.x1 },
          { field: 'easingY1', from: startKf.easingY1, to: latest.y1 },
          { field: 'easingX2', from: startKf.easingX2, to: latest.x2 },
          { field: 'easingY2', from: startKf.easingY2, to: latest.y2 },
        ].filter((c) => !Object.is(c.from, c.to));
        if (changes.length > 0) onCommitTangents(startKf.id, changes);
      }
      function onKeyDown(ev) {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        draggingRef.current = null;
        setDraft(initialDraft);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKeyDown);
    };
  }

  function commitNumeric(field, raw) {
    if (!hasEditableSegment || raw === '' || !Number.isFinite(Number(raw))) return;
    const value = field.startsWith('x') ? Math.max(0, Math.min(1, Number(raw))) : Number(raw);
    const next = { ...draft, [field]: value };
    const changes = [
      { field: 'easing', from: startKf.easing, to: 'custom' },
      ...Object.entries(next).map(([key, to]) => ({ field: `easing${key.toUpperCase()}`, from: startKf[`easing${key.toUpperCase()}`], to })),
    ].filter(c => !Object.is(c.from, c.to));
    if (changes.length) onCommitTangents(startKf.id, changes);
  }

  return (
    <div
      data-testid="graph-editor-panel"
      data-docked={docked}
      className={docked ? 'min-w-0 p-3 text-[var(--text)]' : 'fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl p-3'}
      style={docked ? undefined : { left: Math.max(8, Math.min(x, window.innerWidth - WIDTH - 32)), top: Math.max(8, Math.min(y, window.innerHeight - 460)), maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs text-[var(--n600,#4b5563)]">Graph Editor</span>
        <select
          data-testid="graph-editor-property-select"
          aria-label="Thuộc tính đường cong"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="text-xs rounded-md border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-1 py-0.5"
        >
          {animatedKeys.map((k) => <option key={k} value={k}>{PROPERTY_LABEL[k] || k}</option>)}
        </select>
        <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] text-xs">✕</button>
      </div>
      {onDock && <button type="button" onClick={onDock} className="text-xs text-[var(--accent)] mb-2">{docked ? 'Bỏ ghim Graph Editor' : 'Ghim vào bảng thuộc tính'}</button>}
      {hasEditableSegment && <label className="flex items-center gap-2 mb-2 text-xs text-[var(--n600)]">Đoạn keyframe
        <select aria-label="Đoạn keyframe" value={selectedSegmentIndex} onChange={e => setSelectedSegmentIndex(Number(e.target.value))} className="border rounded bg-[var(--card)] px-2 py-1">
          {keyframes.slice(0, -1).map((kf, i) => <option key={kf.id} value={i}>{i + 1} → {i + 2}</option>)}
        </select>
      </label>}
      <svg ref={svgRef} width={WIDTH} height={HEIGHT} style={docked ? { width: '100%', height: 'auto' } : undefined} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="bg-[var(--n100,#f3f4f6)] rounded-lg touch-none">
        {ghostCurves.map((g) => (
          <path key={g.key} d={g.d} fill="none" stroke="var(--n400,#9ca3af)" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
        ))}
        <path d={mainPathD} fill="none" stroke="var(--accent,#7C5CFA)" strokeWidth={2} />
        {keyframes.map((kf, i) => (
          <circle
            key={kf.id}
            data-testid={`graph-editor-keyframe-dot-${i}`}
            cx={xForMs(kf.timeMs)} cy={yForValue(kf.value)} r={4}
            fill={i === selectedSegmentIndex || i === selectedSegmentIndex + 1 ? 'var(--accent,#7C5CFA)' : 'var(--n500,#6b7280)'}
            stroke="var(--card,#fff)" strokeWidth={1}
            className={i < keyframes.length - 1 ? 'cursor-pointer' : ''}
            onMouseDown={i < keyframes.length - 1 ? () => setSelectedSegmentIndex(i) : undefined}
          />
        ))}
        {hasEditableSegment && draft && (() => {
          const anchor1 = segScreenForUnit(0, 0);
          const anchor2 = segScreenForUnit(1, 1);
          const p1Screen = segScreenForUnit(draft.x1, draft.y1);
          const p2Screen = segScreenForUnit(draft.x2, draft.y2);
          return (
            <>
              <line x1={anchor1.x} y1={anchor1.y} x2={p1Screen.x} y2={p1Screen.y} stroke="var(--n400,#9ca3af)" strokeWidth={1} />
              <line x1={anchor2.x} y1={anchor2.y} x2={p2Screen.x} y2={p2Screen.y} stroke="var(--n400,#9ca3af)" strokeWidth={1} />
              <circle
                data-testid="graph-editor-handle-p1" cx={p1Screen.x} cy={p1Screen.y} r={5}
                fill="var(--accent,#7C5CFA)" stroke="var(--card,#fff)" strokeWidth={1.5}
                className="cursor-pointer" onMouseDown={handlePointerDown('p1')}
              />
              <circle
                data-testid="graph-editor-handle-p2" cx={p2Screen.x} cy={p2Screen.y} r={5}
                fill="var(--accent,#7C5CFA)" stroke="var(--card,#fff)" strokeWidth={1.5}
                className="cursor-pointer" onMouseDown={handlePointerDown('p2')}
              />
            </>
          );
        })()}
      </svg>
      {hasEditableSegment && draft && <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-[var(--n600)]">
        {[['x1', 'Tiếp tuyến ra — thời gian'], ['y1', 'Tiếp tuyến ra — giá trị'], ['x2', 'Tiếp tuyến vào — thời gian'], ['y2', 'Tiếp tuyến vào — giá trị']].map(([field, label]) => <label key={`${startKf.id}:${field}:${draft[field]}`} className="flex flex-col gap-1">{label}
          <input type="number" step="0.05" min={field.startsWith('x') ? 0 : undefined} max={field.startsWith('x') ? 1 : undefined} defaultValue={Number(draft[field].toFixed(5))}
            onBlur={e => commitNumeric(field, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="w-full min-w-0 rounded border border-[var(--card-border)] bg-[var(--card)] px-2 py-1 text-[var(--text)]" />
        </label>)}
      </div>}
      <div className="mt-1 text-[10px] text-[var(--n600,#4b5563)] text-center">
        {hasEditableSegment
          ? `Đoạn ${selectedSegmentIndex + 1}/${keyframes.length - 1} — hai tiếp tuyến độc lập với đoạn liền kề`
          : 'Cần ít nhất 2 keyframe để chỉnh tangent'}
      </div>
    </div>
  );
}
