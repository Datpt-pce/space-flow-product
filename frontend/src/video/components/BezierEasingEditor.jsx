// 08-G G5 (ADR 0036, docs/decisions/0036-keyframe-custom-bezier-easing-minimal-slice.md): a small,
// self-contained cubic-bezier curve editor — the SAME visual idiom every browser DevTools' own
// `cubic-bezier()` picker and cubic-bezier.com already use (an ABSTRACT [0,1]x[Y-range] square, 2
// draggable control points, fixed anchors at (0,0)/(1,1)) rather than a real value-vs-time plot
// against the clip's own duration/value range — see the ADR for why that fuller Graph Editor is a
// separate, bigger decision. Opened from Timeline.jsx's keyframe-marker context menu.
//
// Pure presentational + gesture component: reports a FINAL {x1,y1,x2,y2} via onCommit only on
// mouseup (one gesture, one caller-side command — Timeline.jsx decides what command that is), and
// onClose when the user is done looking (click-outside is handled by the CALLER, matching every
// other popover in this codebase — see Timeline.jsx's clipContextMenu/keyframeContextMenu).

import { useState, useRef, useEffect } from 'react';

const SIZE = 160;
const PAD = 20;
const Y_MIN = -0.5;
const Y_MAX = 1.5;

function toScreenX(x) { return PAD + x * (SIZE - 2 * PAD); }
function toScreenY(y) { return (SIZE - PAD) - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (SIZE - 2 * PAD); }
function fromScreenX(sx) { return Math.max(0, Math.min(1, (sx - PAD) / (SIZE - 2 * PAD))); }
function fromScreenY(sy) { return Y_MIN + ((SIZE - PAD - sy) / (SIZE - 2 * PAD)) * (Y_MAX - Y_MIN); }

// bezierPoint: the RAW parametric curve (X(u), Y(u)) for drawing — distinct from shared/
// video-easing.js's cubicBezierY, which instead SOLVES x(u)=t to answer "what's the eased value at
// linear time t". This editor only needs to draw the curve's shape, never evaluate it at a time.
function bezierPoint(p1, p2, u) {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}
function curvePathD(x1, y1, x2, y2) {
  const steps = 24;
  let d = `M ${toScreenX(0)} ${toScreenY(0)}`;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    d += ` L ${toScreenX(bezierPoint(x1, x2, u))} ${toScreenY(bezierPoint(y1, y2, u))}`;
  }
  return d;
}

export default function BezierEasingEditor({ x, y, value, onCommit, onClose }) {
  const [draft, setDraft] = useState(value); // { x1, y1, x2, y2 } — live during a drag, committed value otherwise
  const draggingRef = useRef(null); // 'p1' | 'p2' | null
  const svgRef = useRef(null);

  // Resync from the caller's `value` whenever it changes for a reason OTHER than this component's
  // own commit (e.g. Timeline.jsx re-renders for an unrelated reason — playback advancing the
  // playhead — while this popover is open but NOT mid-drag). Guarded by draggingRef so a parent
  // re-render during an ACTIVE drag never stomps the live preview: `value` itself doesn't change
  // during a drag (no command has committed yet), but Timeline.jsx constructs a brand-new object
  // literal on every render regardless, so this effect would otherwise fire — and reset the visual
  // preview back to the pre-drag value — on every single frame of an unrelated re-render.
  useEffect(() => {
    if (draggingRef.current === null) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.x1, value.y1, value.x2, value.y2]);

  function screenPointFromEvent(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const sy = ((e.clientY - rect.top) / rect.height) * SIZE;
    return { x: fromScreenX(sx), y: fromScreenY(sy) };
  }

  function handlePointerDown(which) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = which;
      // `latest` is a plain closure variable, NOT React state — onUp reads it directly rather than
      // through a setState updater callback (calling onCommit — which dispatches a real command —
      // from inside a state updater is unsafe: React/StrictMode may invoke an updater function more
      // than once, which would fire the command twice). Same "plain local variable across
      // onMove/onUp" pattern Timeline.jsx's own drag gestures already use (handleKeyframeMarker
      // MouseDown's `latestMs`, handleTrimStart's `latestBounds`) — `setDraft` here exists ONLY to
      // drive the live-preview render, mirroring those files' own separation of preview state from
      // the committed value.
      let latest = draft;
      function onMove(ev) {
        const p = screenPointFromEvent(ev);
        latest = which === 'p1' ? { ...latest, x1: p.x, y1: p.y } : { ...latest, x2: p.x, y2: p.y };
        setDraft(latest);
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        draggingRef.current = null;
        onCommit(latest);
      }
      function onKeyDown(ev) {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        draggingRef.current = null;
        setDraft(value); // revert to the last COMMITTED value, no onCommit call
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKeyDown);
    };
  }

  const p1Screen = { x: toScreenX(draft.x1), y: toScreenY(draft.y1) };
  const p2Screen = { x: toScreenX(draft.x2), y: toScreenY(draft.y2) };
  const originScreen = { x: toScreenX(0), y: toScreenY(0) };
  const endScreen = { x: toScreenX(1), y: toScreenY(1) };

  return (
    <div
      data-testid="bezier-easing-editor"
      className="fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl p-3"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--n600,#4b5563)]">Custom easing (bezier)</span>
        <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] text-xs">✕</button>
      </div>
      <svg ref={svgRef} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="bg-[var(--n100,#f3f4f6)] rounded-lg touch-none">
        {/* reference diagonal (linear) */}
        <line x1={originScreen.x} y1={originScreen.y} x2={endScreen.x} y2={endScreen.y} stroke="var(--card-border,#e5e7eb)" strokeDasharray="2 2" />
        {/* guide lines from each fixed anchor to its own control point */}
        <line x1={originScreen.x} y1={originScreen.y} x2={p1Screen.x} y2={p1Screen.y} stroke="var(--n400,#9ca3af)" strokeWidth={1} />
        <line x1={endScreen.x} y1={endScreen.y} x2={p2Screen.x} y2={p2Screen.y} stroke="var(--n400,#9ca3af)" strokeWidth={1} />
        {/* the actual curve */}
        <path d={curvePathD(draft.x1, draft.y1, draft.x2, draft.y2)} fill="none" stroke="var(--accent,#7C5CFA)" strokeWidth={2} />
        {/* fixed anchors */}
        <circle cx={originScreen.x} cy={originScreen.y} r={3} fill="var(--n500,#6b7280)" />
        <circle cx={endScreen.x} cy={endScreen.y} r={3} fill="var(--n500,#6b7280)" />
        {/* draggable control points */}
        <circle
          data-testid="bezier-handle-p1" cx={p1Screen.x} cy={p1Screen.y} r={6}
          fill="var(--accent,#7C5CFA)" stroke="var(--card,#fff)" strokeWidth={1.5}
          className="cursor-pointer" onMouseDown={handlePointerDown('p1')}
        />
        <circle
          data-testid="bezier-handle-p2" cx={p2Screen.x} cy={p2Screen.y} r={6}
          fill="var(--accent,#7C5CFA)" stroke="var(--card,#fff)" strokeWidth={1.5}
          className="cursor-pointer" onMouseDown={handlePointerDown('p2')}
        />
      </svg>
      <div className="mt-1 text-[10px] font-mono text-[var(--n600,#4b5563)] text-center">
        cubic-bezier({draft.x1.toFixed(2)}, {draft.y1.toFixed(2)}, {draft.x2.toFixed(2)}, {draft.y2.toFixed(2)})
      </div>
    </div>
  );
}
