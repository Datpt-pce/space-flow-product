// 08.1 (specs/ai-creative-operations-platform/08-1-editor-ux-foundation.md §3: "Panel trái/phải
// và chiều cao timeline resizable; lưu preference theo user/workspace, không đưa vào composition
// lineage"). Deliberately outside the video Zustand store: panel size is a per-browser UI
// preference, not project data — it must never touch `commandStack`/undo history or get persisted
// to the project's own save. `localStorage` is the whole persistence story, same reasoning as
// `store.js`'s own header comment for why Media Bin's asset list has none (this is the opposite
// case: genuinely local-only UI state, not server data). Uses the same
// `window.addEventListener('pointermove'/'pointerup', ...)` drag pattern already established in
// TransformOverlay.jsx.
import { useCallback, useRef, useState } from 'react';

function readStoredSize(storageKey, initialPx, minPx, maxPx) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw == null ? null : Number(raw);
    // 08-L L5 (specs/ai-creative-operations-platform/08-v2/08-l-editor-experience-and-interaction-
    // system.md §4.2): clamp a previously-persisted size to the CURRENT minPx/maxPx — without this,
    // a value saved under an earlier (wider) range stays out-of-range forever after the range is
    // tightened, until the user happens to drag that panel again.
    return Number.isFinite(parsed) ? Math.min(maxPx, Math.max(minPx, parsed)) : initialPx;
  } catch {
    return initialPx; // private-browsing/storage-disabled — fall back silently, this is a convenience, not a requirement
  }
}

// axis: 'x' (drag changes width, e.g. a left/right panel) or 'y' (drag changes height, e.g. the
// timeline row). `invert`: for a LEFT-edge/BOTTOM-edge handle the size shrinks as the pointer
// moves toward the panel rather than away from it — invert the delta's sign for those. `clamp`
// (08-L L5, optional): a caller-supplied `(px) -> px` applied AFTER the plain minPx/maxPx clamp —
// used by VideoWorkspace.jsx to additionally cap Media/Inspector against the OTHER side panel's
// current size + viewport width, so Preview never drops below its own contract floor (§4.2:
// "Preview giữ tối thiểu 43%"). Left undefined by any caller that doesn't need coordination (e.g.
// the Timeline height panel, which has no sibling to coordinate with).
export function useResizablePanel({
  storageKey, initialPx, minPx, maxPx, axis = 'x', invert = false, clamp,
}) {
  const [sizePx, setSizePx] = useState(() => readStoredSize(storageKey, initialPx, minPx, maxPx));
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem(`${storageKey}.collapsed`) === 'true'; } catch { return false; } });
  const dragRef = useRef(null);

  const persist = useCallback((px) => {
    try { window.localStorage.setItem(storageKey, String(px)); } catch { /* best-effort only */ }
  }, [storageKey]);

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startClient: axis === 'x' ? e.clientX : e.clientY, startSize: sizePx };
    function handleMove(ev) {
      const st = dragRef.current;
      if (!st) return;
      const deltaRaw = axis === 'x' ? ev.clientX - st.startClient : ev.clientY - st.startClient;
      const delta = invert ? -deltaRaw : deltaRaw;
      const withinOwnRange = Math.min(maxPx, Math.max(minPx, st.startSize + delta));
      setSizePx(clamp ? Math.max(minPx, clamp(withinOwnRange)) : withinOwnRange);
    }
    function handleUp() {
      dragRef.current = null;
      setSizePx((current) => { persist(current); return current; });
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [axis, invert, minPx, maxPx, sizePx, persist, clamp]);

  const toggleCollapse = useCallback(() => setCollapsed((c) => {
    try { window.localStorage.setItem(`${storageKey}.collapsed`, String(!c)); } catch { /* optional preference */ }
    return !c;
  }), [storageKey]);

  // collapseIfNotAlready (08-L L5 responsive collapse, §4.2 "Dưới width threshold: collapse panel
  // phụ theo thứ tự đã chốt"): a one-directional setter (never un-collapses) so
  // VideoWorkspace.jsx's resize listener can react to crossing the width threshold without ever
  // fighting a user who deliberately expanded the panel back out while still narrow.
  const collapseIfNotAlready = useCallback(() => setCollapsed((c) => (c ? c : true)), []);

  return {
    sizePx, onDragStart, collapsed, toggleCollapse, collapseIfNotAlready,
  };
}
