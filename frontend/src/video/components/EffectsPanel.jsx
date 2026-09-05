// Video Editor Phase 10 (specs/space-flow-master-plan/04-video-editor.md §5): "Mask/feather/
// blend-mode/chroma-key" — mask/feather deferred (a genuinely separate feature needing its own
// shape/gradient UI, see the phase's own write-up), this panel covers the other 2 via the generic
// AddEffect/RemoveEffect commands (Phase 10's own addition — `clip.effects`, §2 schema, had no
// real caller until now).
//
// Chroma-key is EXPORT-only (backend/video/renderPlanner.js's real `colorkey` filter) — no live
// preview. Blend-mode is full preview (canvasEngine.js's real `ctx.globalCompositeOperation`) AND
// export (Phase 12, §0: renderPlanner.js now composites every visible video track, not just one —
// see that phase's write-up) — but export only has anything to blend AGAINST when the clip sits on
// a video track that is NOT the bottom-most (`.order`) one; on the sole/base track there's no layer
// underneath, so the export is unaffected regardless of this setting (same as before Phase 12). The
// label below says so rather than pretending unconditional parity. Both toggles stay visible and
// functional regardless — each does what it can verify for real.
//
// Phase 11 (§0) adds 3 more `clip.effects` types, same AddEffect/RemoveEffect/SetProperty
// pattern: `colorGrade` (brightness/contrast/saturation/gamma/hue sliders — preview via
// timelineUtils.js's colorGradeFilterFor, export via renderPlanner.js's real `eq`/`hue`),
// `lut` (a .cube file's absolute path — export-only, backend `lut3d` filter), `curves` (a fixed
// ffmpeg preset — export-only, backend `curves=preset=`). LUT/curves have no preview: real-time
// per-pixel LUT lookup/tone-curve mapping in JS on every canvas redraw was judged too expensive
// for this pass, the same reasoning already used for chroma-key above.

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';
import { evaluateClipTransform, TRANSFORM_DEFAULTS, isPropertyAnimated, keyframesForProperty } from '@shared/video-keyframes';
import { CROP_DEFAULTS, computeCanvasPlacement, normalizedCropFor } from '@shared/video-transform';
import MaskDrawing from './MaskDrawing.jsx';
import { vectorSize } from '@shared/video-vector';
import { MASK_DEFAULTS } from '@shared/video-mask';
import { NUDGE_STEPS, stepFor } from '../shortcuts.js';
import PropertyField from './PropertyField.jsx';
import ClipSpeedPanel from './ClipSpeedPanel.jsx';

// 08-UI §6.3 Priority 0 bước 3: disclosure section (header 32-36px, chevron) cho các nhóm "advanced"
// (chroma-key/blend-mode/LUT/curves — export-only, ít dùng theo đúng mô tả guideline) — Transform
// (section chính) không bọc, luôn hiện. Local component nhỏ, chỉ dùng trong panel này.
function Disclosure({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--card-border,#e5e7eb)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full h-8 flex items-center justify-between text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
      >
        <span>{title}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// 08-UI §5.1 Priority 0 bước 3: banner cảnh báo dùng --status-run (amber có sẵn) qua color-mix()
// thay vì literal Tailwind amber-* — tái dùng 1 token duy nhất cho cả text/bg/border thay vì thêm
// token mới (chỉ 1 chỗ cần "warning" trong toàn app, chưa đủ lý do có --status-warn riêng).
function WarningBanner({ children }) {
  return (
    <div
      className="rounded-lg px-2 py-1"
      style={{
        color: 'var(--status-run,#f59e0b)',
        backgroundColor: 'color-mix(in srgb, var(--status-run,#f59e0b) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--status-run,#f59e0b) 35%, transparent)',
      }}
    >
      {children}
    </div>
  );
}

const CHROMA_KEY_PARAMS = { color: '0x00FF00', similarity: 0.3, blend: 0.1 }; // green screen preset — the overwhelmingly common case, no color picker needed
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
const DEFAULT_COLOR_GRADE = { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 };
// 08.3.1 §1 (Inspector transform fields) — same clamp TransformOverlay.jsx's canvas resize handle
// already enforces, duplicated here on purpose (both are independent authoring paths for the same
// `transform.scaleX/scaleY`, matching that file's own precedent rather than a new shared const).
const MIN_SCALE = 0.02;
const MAX_SCALE = 4;
const clampScale = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
// meta per transform field family: `step` for label-scrub rounding, `precision` for display/
// commit rounding, `scrubSensitivity` = project units per horizontal drag pixel, `nudgeSteps` =
// the shortcuts.js registry entry Shift(coarse)/Alt(fine) read from.
const POSITION_META = { step: 1, precision: 0, scrubSensitivity: 1, nudgeSteps: NUDGE_STEPS.position };
const SCALE_META = { step: 0.01, precision: 3, scrubSensitivity: 0.005, nudgeSteps: NUDGE_STEPS.scale };
const ROTATION_META = { step: 1, precision: 1, scrubSensitivity: 0.5, nudgeSteps: NUDGE_STEPS.rotation };
// Exact set ffmpeg's own `curves` filter defines as built-in presets (verified against real
// ffmpeg — an unlisted value errors loudly at export time, no client-side validation needed).
const CURVES_PRESETS = [
  'color_negative', 'cross_process', 'darker', 'increase_contrast', 'lighter',
  'linear_contrast', 'medium_contrast', 'negative', 'strong_contrast', 'vintage',
];

export default function EffectsPanel({ embedded = false, transformOnly = false } = {}) {
  const projectState = useVideoStore((s) => s.projectState);
  const assets = useVideoStore((s) => s.assets);
  const selectedIds = useVideoStore((s) => s.selectedIds);
  const playheadMs = useVideoStore((s) => s.playheadMs);
  const execute = useVideoStore((s) => s.execute);
  const setLivePreviewPatch = useVideoStore((s) => s.setLivePreviewPatch);
  const clearLivePreviewPatch = useVideoStore((s) => s.clearLivePreviewPatch);

  // 08.2.1 §4/§6: multiple non-caption clips selected -> a SEPARATE, smaller "Mixed" editing
  // section further down (`targets.length > 1` branch) rather than this single-target path.
  // VideoWorkspace.jsx already only mounts THIS panel when every selected item is non-caption, but
  // filtering here too is cheap defensive consistency, not a real expected case.
  const allTargets = projectState ? selectedIds.map((id) => findClipLocation(projectState, id)).filter((t) => t && t.track.type !== 'caption') : [];
  const target = allTargets.length === 1 ? allTargets[0] : null;
  const lutEffectForDraft = target ? (target.clip.effects || []).find((e) => e.type === 'lut') : null;

  // Hooks must run unconditionally (React's Rules of Hooks) — `target` can be null (no clip
  // selected) on some renders and non-null on others, so this has to sit ABOVE the early return
  // below, not next to the rest of the LUT logic further down.
  const [lutPathDraft, setLutPathDraft] = useState(lutEffectForDraft?.params.path || '');
  // Selecting a different clip should re-seed the draft from THAT clip's own lut effect, not
  // leave the previous clip's typed-but-uncommitted text behind.
  useEffect(() => { setLutPathDraft(lutEffectForDraft?.params.path || ''); }, [target?.clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 08.1 (§5, "một gesture tạo một command"): volume/colorGrade range sliders used to fire one
  // SetProperty PER pointermove tick. `*DraftRef` holds the in-progress value per gesture (read at
  // window 'mouseup' — a ref, not state, so the commit always sees the true final value regardless
  // of React's render timing); `*Draft` state is only for keeping the slider visually responsive
  // while the store itself isn't being written to. See TransformOverlay.jsx for the same pattern
  // applied to transform drags.
  const volumeDraftRef = useRef(null);
  const [volumeDraft, setVolumeDraft] = useState(null);
  const volumeDraggingRef = useRef(false);
  const colorGradeDraftRef = useRef({});
  const [colorGradeDraft, setColorGradeDraft] = useState({});
  const colorGradeDraggingRef = useRef({});
  // 08.2.1 §4: SAME generic keyed-drag pattern as colorGradeDraft* above, reused for the
  // multi-target ("Mixed") gesture sliders below (`allTargets.length > 1`) — declared here
  // unconditionally (Rules of Hooks) even though only one of the 2 branches ever reads them.
  const multiDraftRef = useRef({});
  const [multiDraft, setMultiDraft] = useState({});
  const multiDraggingRef = useRef({});
  // 08.3.1 §1: SAME generic keyed-drag pattern, reused for the 6 Transform Inspector fields
  // (x/y/scaleX/scaleY/rotation/opacity) — one shared draft slot per key covers BOTH label-scrub
  // drag AND in-progress typed text (the two never happen at once for the same field), keyed the
  // same way colorGradeDraft*/multiDraft* already are above.
  const transformDraftRef = useRef({});
  const [transformDraft, setTransformDraft] = useState({});
  const transformDraggingRef = useRef({});
  // Scale link toggle: UI-local session preference (08.3.1 §1 — "authoring preference... không
  // suy ngược chỉ vì X=Y"), not persisted transform metadata. Defaults on — the canvas resize
  // handle (TransformOverlay.jsx) already always moves scaleX/scaleY together, so this matches the
  // behavior a freshly-selected clip already has.
  const [scaleLinked, setScaleLinked] = useState(true);
  // Auto-key toggle (08-G G4): UI-local session preference, same class as scaleLinked above — not
  // persisted, resets to OFF (today's existing "animated field is disabled outright" behavior) on
  // every fresh mount/reselect. When ON, editing a property that already has keyframes routes the
  // edit into the keyframe layer (commitTransformChanges below) instead of being disabled.
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(false);
  // 08-UI §6.3 Priority 0 bước 3: tab top-level theo loại việc (chỉ hiện khi clip có cả 2 nhóm —
  // xem điều kiện render tab bar phía dưới; clip không có audio thì không có tab, luôn hiện "Video").
  const [activeTab, setActiveTab] = useState('video');
  const [videoTab, setVideoTab] = useState('basic');
  useEffect(() => { setActiveTab(target?.track.type === 'audio' ? 'audio' : 'video'); setVideoTab('basic'); }, [target?.clip.id]);

  if (allTargets.length === 0) {
    return (
      <div className="w-full h-full overflow-y-auto shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 text-xs text-[var(--n600,#4b5563)]">
        Chọn 1 clip để chỉnh hiệu ứng
      </div>
    );
  }

  // 08.2.1 §4 ("Mixed" state): multi-target editing only covers the fields already routed through
  // the generic path-addressed SetProperty/SetProperties (volume, fades, colorGrade params on a
  // clip that already HAS the effect) — batched into exactly 1 undo entry across N different
  // clips/tracks (SetProperties.js is fully generic by path, verified against real code). Effect-
  // PRESENCE toggles (chromaKey/blendMode/normalize/lut/curves — AddEffect/RemoveEffect splice an
  // array, not set a path) stay single-target-only for this pass; disabled with a note when
  // multi-selected (see mother tracker's §12 cut line for why).
  if (allTargets.length > 1) {
    const fieldBasePath = (t) => {
      const trackIndex = projectState.tracks.findIndex((tt) => tt.id === t.track.id);
      const clipIndex = t.track.clips.findIndex((c) => c.id === t.clip.id);
      return ['tracks', trackIndex, 'clips', clipIndex];
    };
    const relativePathForKey = (t, key) => {
      if (key === 'volume') return ['volume'];
      if (key in TRANSFORM_DEFAULTS) return ['transform', key];
      const param = key.slice(3); // 'cg.<param>'
      const idx = (t.clip.effects || []).findIndex((e) => e.type === 'colorGrade');
      return ['effects', idx, 'params', param];
    };
    // rawValueForKey: the ACTUAL stored value (genuinely `undefined` for a clip that never had this
    // field set) — MUST be what's passed as a commit's `from`, never a display-fallback default.
    // SetProperty/SetProperties' validate() strict-equality-checks `from` against the real current
    // state; defaulting it here would falsely claim the state already equals the default and throw
    // "expected ... got undefined" the first time (same rule EffectsPanel's single-target
    // `setClipField`/`commitColorGradeParam` already document further down this file). Transform is
    // the one exception (safe to default) — same reasoning as single-target's own `transformBase`
    // comment further down: `clip.transform` is always fully populated at clip-creation time.
    const rawValueForKey = (t, key) => {
      if (key === 'volume') return t.clip.volume;
      if (key in TRANSFORM_DEFAULTS) return t.clip.transform?.[key] ?? TRANSFORM_DEFAULTS[key];
      const param = key.slice(3);
      const eff = (t.clip.effects || []).find((e) => e.type === 'colorGrade');
      return eff?.params?.[param];
    };
    // displayValueForKey: WITH the fallback default — only for rendering (slider value=, Mixed
    // comparison), never for a commit's `from`.
    const displayValueForKey = (t, key) => {
      if (key === 'volume') return t.clip.volume ?? 1;
      if (key in TRANSFORM_DEFAULTS) return rawValueForKey(t, key);
      const param = key.slice(3);
      return rawValueForKey(t, key) ?? DEFAULT_COLOR_GRADE[param];
    };
    const readMixed = (getter) => {
      const values = allTargets.map(getter);
      return { value: values[0], mixed: !values.every((v) => v === values[0]) };
    };
    const commitBatch = (changes) => {
      const real = changes.filter((c) => !Object.is(c.from, c.to));
      if (real.length === 0) return;
      try {
        if (real.length === 1) execute('SetProperty', real[0]);
        else execute('SetProperties', { changes: real });
      } catch (err) {
        console.warn('EffectsPanel: dropped multi-select commit, state changed mid-gesture:', err.message);
      }
    };
    // 08-UI §6.3 Priority 0 bước 3: multi-select Transform field thật (trước đó chỉ có text mô tả
    // "kéo trên canvas để di chuyển"). Mỗi field SET tuyệt đối cho toàn bộ selection — đúng pattern
    // sẵn có của volume/colorGrade phía trên (cùng giá trị cho mọi clip), không phải delta/tỉ lệ
    // riêng từng clip — giữ đơn giản, nhất quán, đúng nghĩa "sửa 1 field áp dụng cho tất cả". Scale
    // link (checkbox `scaleLinked` dùng chung với single-target) fan-out scaleX/scaleY cùng lúc.
    const multiScaleKeysFor = (key) => (scaleLinked && (key === 'scaleX' || key === 'scaleY') ? ['scaleX', 'scaleY'] : [key]);
    const commitFieldValue = (key, value) => {
      const keys = multiScaleKeysFor(key);
      commitBatch(allTargets.flatMap((t) => keys.map((k) => ({ path: [...fieldBasePath(t), ...relativePathForKey(t, k)], from: rawValueForKey(t, k), to: value }))));
    };
    const startFieldDrag = (key) => {
      multiDraggingRef.current[key] = true;
      const onWindowUp = () => {
        window.removeEventListener('mouseup', onWindowUp);
        window.removeEventListener('blur', onWindowUp);
        delete multiDraggingRef.current[key];
        clearLivePreviewPatch();
        const finalValue = multiDraftRef.current[key];
        delete multiDraftRef.current[key];
        setMultiDraft((d) => { const next = { ...d }; delete next[key]; return next; });
        if (finalValue === undefined) return;
        commitFieldValue(key, finalValue);
      };
      // 08-L L4 (specs/ai-creative-operations-platform/08-v2/08-l-4-selection-focus-and-gesture-
      // grammar.md §5): window-blur mid-drag must still commit (a native range input's value is
      // always valid, unlike a position/trim drag's transient overlay — no separate cancel path
      // needed here) instead of leaving `multiDraggingRef` stuck `true` forever.
      window.addEventListener('mouseup', onWindowUp);
      window.addEventListener('blur', onWindowUp);
    };
    const dragField = (key, value) => {
      if (!multiDraggingRef.current[key]) { commitFieldValue(key, value); return; }
      multiDraftRef.current[key] = value;
      setMultiDraft((d) => ({ ...d, [key]: value }));
      const keys = multiScaleKeysFor(key);
      setLivePreviewPatch(allTargets.flatMap((t) => keys.map((k) => ({ clipId: t.clip.id, path: relativePathForKey(t, k), value }))));
    };
    const commitPlainField = (relPath, valueGetter, newValue) => {
      commitBatch(allTargets.map((t) => ({ path: [...fieldBasePath(t), ...relPath], from: valueGetter(t), to: newValue })));
    };

    const anyLocked = allTargets.some((t) => t.track.locked);
    const anyHidden = allTargets.some((t) => t.track.visible === false);
    const supportsAudioAll = allTargets.every((t) => t.track.type === 'video' || t.track.type === 'audio');
    const supportsVideoFadeAll = allTargets.every((t) => t.track.type === 'video');
    const allHaveColorGrade = allTargets.every((t) => (t.clip.effects || []).some((e) => e.type === 'colorGrade' && e.enabled));
    const disabled = anyLocked;

    const volume = readMixed((t) => t.clip.volume ?? 1);
    const audioFadeIn = readMixed((t) => t.clip.audioFadeInMs ?? 0);
    const audioFadeOut = readMixed((t) => t.clip.audioFadeOutMs ?? 0);
    const videoFadeIn = readMixed((t) => t.clip.videoFadeInMs ?? 0);
    const videoFadeOut = readMixed((t) => t.clip.videoFadeOutMs ?? 0);

    // isMultiTransformFieldDisabled: khoá field nếu BẤT KỲ clip nào trong selection có property đó
    // đang animated — không cố xử lý nửa vời case "vừa animated vừa static" trong 1 field (đúng
    // quyết định phạm vi đã chốt trong plan), nhất quán với resetAllTransformMulti bỏ qua animated
    // key phía trên.
    const isMultiTransformFieldDisabled = (key) => disabled || allTargets.some((t) => isPropertyAnimated(t.clip, key));
    const multiTransform = {
      x: readMixed((t) => rawValueForKey(t, 'x')),
      y: readMixed((t) => rawValueForKey(t, 'y')),
      scaleX: readMixed((t) => rawValueForKey(t, 'scaleX')),
      scaleY: readMixed((t) => rawValueForKey(t, 'scaleY')),
      rotation: readMixed((t) => rawValueForKey(t, 'rotation')),
      opacity: readMixed((t) => rawValueForKey(t, 'opacity')),
    };
    // renderMultiTransformField: number input commit-on-blur/Enter — CÙNG pattern single-target's
    // renderTransformNumberField dùng (KHÔNG phải startFieldDrag/dragField ở trên, pattern đó dành
    // cho range slider liên tục; dùng nhầm cho number input sẽ commit 1 command MỖI ký tự gõ ngay
    // khi mouseup xảy ra giữa chừng — bug thật suýt mắc phải lúc viết, sửa trước khi merge).
    const renderMultiTransformField = (key, label, meta) => {
      const fieldDisabled = isMultiTransformFieldDisabled(key);
      const mixedInfo = multiTransform[key];
      const displayValue = multiDraft[key] !== undefined ? multiDraft[key] : Number(mixedInfo.value.toFixed(meta.precision));
      const commitTyped = () => {
        const raw = multiDraft[key];
        setMultiDraft((d) => { const next = { ...d }; delete next[key]; return next; });
        if (raw === undefined || raw === '') return;
        const parsed = parseFloat(raw);
        if (!Number.isFinite(parsed)) return;
        const rounded = Number(parsed.toFixed(meta.precision));
        commitFieldValue(key, key === 'scaleX' || key === 'scaleY' ? clampScale(rounded) : rounded);
      };
      return (
        <div key={key}>
          <label htmlFor={`multi-transform-${key}`} className="flex justify-between text-[var(--n600,#4b5563)]">
            <span>{label}{mixedInfo.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</span>
          </label>
          <input
            id={`multi-transform-${key}`} type="number" step={meta.step} disabled={fieldDisabled}
            value={displayValue}
            onChange={(e) => setMultiDraft((d) => ({ ...d, [key]: e.target.value }))}
            onBlur={commitTyped}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            aria-label={`${label} (nhiều clip)`}
            className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
          />
        </div>
      );
    };

    // 08.3.1 §3 acceptance / 08.3.2 §4 (multi-select reset, atomic, impact count). 08-UI Priority 0
    // bước 3: per-field typing giờ CÓ hỗ trợ multi-select (renderMultiTransformField ở trên) — canvas
    // drag trên MultiSelectBounds (Player.jsx) vẫn là đường riêng cho di chuyển trực tiếp trên
    // preview, 2 đường không xung đột (cùng ghi qua transform.x/y). Animated keys vẫn bị bỏ qua khi
    // reset (Batch 10's own "phần chưa-animated" cut — an animated-aware reset menu is a later pass).
    const resetAllTransformMulti = () => {
      const changes = [];
      for (const t of allTargets) {
        const base = { ...TRANSFORM_DEFAULTS, ...(t.clip.transform || {}) };
        for (const key of Object.keys(TRANSFORM_DEFAULTS)) {
          if (isPropertyAnimated(t.clip, key)) continue;
          changes.push({ path: [...fieldBasePath(t), 'transform', key], from: base[key], to: TRANSFORM_DEFAULTS[key] });
        }
      }
      commitBatch(changes);
    };

    return (
      <div className="w-full h-full overflow-y-auto shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 space-y-4 text-xs overflow-y-auto">
        <div className="text-[var(--n600,#4b5563)]">{allTargets.length} clip đã chọn</div>
        <div className="border-t border-[var(--card-border,#e5e7eb)] pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[var(--n600,#4b5563)]">Transform</span>
            <button type="button" onClick={resetAllTransformMulti} disabled={disabled} className="text-[var(--n600,#4b5563)] underline disabled:opacity-40">
              Về mặc định ({allTargets.length} clip)
            </button>
          </div>
          <p className="text-[var(--n600,#4b5563)]">Kéo trên canvas để di chuyển cùng lúc, hoặc sửa field bên dưới — áp dụng CÙNG giá trị cho mọi clip đã chọn.</p>
          <div className="grid grid-cols-2 gap-2">
            {renderMultiTransformField('x', 'Position X', POSITION_META)}
            {renderMultiTransformField('y', 'Position Y', POSITION_META)}
          </div>
          <div className="flex items-center justify-between text-[var(--n600,#4b5563)]">
            <span>Scale</span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={scaleLinked} onChange={(e) => setScaleLinked(e.target.checked)} />
              Liên kết X/Y
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {renderMultiTransformField('scaleX', 'Scale X', SCALE_META)}
            {renderMultiTransformField('scaleY', 'Scale Y', SCALE_META)}
          </div>
          {renderMultiTransformField('rotation', 'Rotation (°)', ROTATION_META)}
          {renderMultiTransformField('opacity', 'Opacity', { step: 0.01, precision: 2 })}
        </div>
        {anyLocked && (
          <WarningBanner>Có clip trên track đang khoá — mở khoá track để chỉnh.</WarningBanner>
        )}
        {anyHidden && (
          <div className="text-[var(--n600,#4b5563)] bg-[var(--n100,#f3f4f6)] rounded-lg px-2 py-1">
            Có clip trên track đang ẩn.
          </div>
        )}
        <div className="text-[var(--n600,#4b5563)]">
          Bật/tắt hiệu ứng (chroma key, blend mode, chuẩn hoá âm lượng, LUT, curves) cho nhiều clip cùng lúc chưa hỗ trợ — chọn 1 clip để chỉnh.
        </div>

        {supportsAudioAll && (
          <div className="border-t border-[var(--card-border,#e5e7eb)] pt-3 space-y-2">
            <div>
              <label htmlFor="multi-volume" className="flex justify-between text-[var(--n600,#4b5563)]">
                <span>Âm lượng (Preview và Export){volume.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</span>
                <span>{Math.round((multiDraft.volume ?? volume.value) * 100)}%</span>
              </label>
              <input
                id="multi-volume" type="range" min={0} max={10} step={0.05} disabled={disabled}
                value={multiDraft.volume ?? volume.value}
                onMouseDown={() => startFieldDrag('volume')}
                onChange={(e) => dragField('volume', parseFloat(e.target.value))}
                aria-label="Âm lượng (nhiều clip)"
                className="w-full focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 disabled:opacity-40"
              />
            </div>

            <span className="text-[var(--n600,#4b5563)]">Fade âm thanh (Preview và Export)</span>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="multi-audio-fade-in" className="block text-[var(--n600,#4b5563)]">Fade in (giây){audioFadeIn.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</label>
                <input
                  id="multi-audio-fade-in" type="number" min={0} step={0.1} disabled={disabled}
                  value={(audioFadeIn.mixed ? 0 : audioFadeIn.value) / 1000}
                  onChange={(e) => commitPlainField(['audioFadeInMs'], (t) => t.clip.audioFadeInMs, Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="multi-audio-fade-out" className="block text-[var(--n600,#4b5563)]">Fade out (giây){audioFadeOut.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</label>
                <input
                  id="multi-audio-fade-out" type="number" min={0} step={0.1} disabled={disabled}
                  value={(audioFadeOut.mixed ? 0 : audioFadeOut.value) / 1000}
                  onChange={(e) => commitPlainField(['audioFadeOutMs'], (t) => t.clip.audioFadeOutMs, Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40"
                />
              </div>
            </div>
          </div>
        )}

        {supportsVideoFadeAll && (
          <div className="border-t border-[var(--card-border,#e5e7eb)] pt-3 space-y-2">
            <span className="text-[var(--n600,#4b5563)]">Fade hình (đen)</span>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="multi-video-fade-in" className="block text-[var(--n600,#4b5563)]">Fade in (giây){videoFadeIn.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</label>
                <input
                  id="multi-video-fade-in" type="number" min={0} step={0.1} disabled={disabled}
                  value={(videoFadeIn.mixed ? 0 : videoFadeIn.value) / 1000}
                  onChange={(e) => commitPlainField(['videoFadeInMs'], (t) => t.clip.videoFadeInMs, Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="multi-video-fade-out" className="block text-[var(--n600,#4b5563)]">Fade out (giây){videoFadeOut.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</label>
                <input
                  id="multi-video-fade-out" type="number" min={0} step={0.1} disabled={disabled}
                  value={(videoFadeOut.mixed ? 0 : videoFadeOut.value) / 1000}
                  onChange={(e) => commitPlainField(['videoFadeOutMs'], (t) => t.clip.videoFadeOutMs, Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40"
                />
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[var(--card-border,#e5e7eb)] pt-3 space-y-2">
          <span className="text-[var(--n600,#4b5563)]">Color grading</span>
          {!allHaveColorGrade ? (
            <p className="text-[var(--n600,#4b5563)]">Chỉ chỉnh được khi mọi clip đã chọn đều có color grading — thêm ở từng clip trước (chọn 1 clip).</p>
          ) : (
            [
              { key: 'cg.brightness', label: 'Brightness', min: -1, max: 1, step: 0.05 },
              { key: 'cg.contrast', label: 'Contrast', min: 0, max: 3, step: 0.05 },
              { key: 'cg.saturation', label: 'Saturation', min: 0, max: 3, step: 0.05 },
              { key: 'cg.gamma', label: 'Gamma (chỉ Export)', min: 0.1, max: 3, step: 0.05 },
              { key: 'cg.hue', label: 'Hue', min: -180, max: 180, step: 5 },
            ].map(({ key, label, min, max, step }) => {
              const mixedInfo = readMixed((t) => displayValueForKey(t, key));
              return (
                <div key={key}>
                  <label htmlFor={`multi-${key}`} className="flex justify-between text-[var(--n600,#4b5563)]">
                    <span>{label}{mixedInfo.mixed && <span className="text-[var(--status-run,#f59e0b)]"> (nhiều giá trị)</span>}</span>
                    <span>{multiDraft[key] ?? mixedInfo.value}</span>
                  </label>
                  <input
                    id={`multi-${key}`} type="range" min={min} max={max} step={step} disabled={disabled}
                    value={multiDraft[key] ?? mixedInfo.value}
                    onMouseDown={() => startFieldDrag(key)}
                    onChange={(e) => dragField(key, parseFloat(e.target.value))}
                    aria-label={`${label} (nhiều clip)`}
                    className="w-full focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 disabled:opacity-40"
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  const { track, clip } = target;
  const visibleTab = track.type === 'audio' && activeTab === 'video' ? 'audio' : activeTab;
  const sourceSize = clip.shape || (clip.text && !clip.assetId) ? vectorSize(clip) : assets.find(asset => asset.id === clip.assetId);
  // 08.2.1 §2/§5: selectable/inspectable either way — locked disables every control below (via the
  // <fieldset disabled> wrapper in the JSX, not a per-input prop) with a visible reason; hidden is
  // purely informational (editing a hidden clip's effects is still meaningful).
  const isLocked = !!track.locked;
  const isHidden = track.visible === false;
  const trackIndex = projectState.tracks.findIndex((t) => t.id === track.id);
  const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
  const effects = clip.effects || [];
  const chromaKeyEffect = effects.find((e) => e.type === 'chromaKey');
  const blendModeEffect = effects.find((e) => e.type === 'blendMode');
  const colorGradeIndex = effects.findIndex((e) => e.type === 'colorGrade');
  const colorGradeEffect = colorGradeIndex === -1 ? null : effects[colorGradeIndex];
  const lutIndex = effects.findIndex((e) => e.type === 'lut');
  const lutEffect = lutIndex === -1 ? null : effects[lutIndex];
  const curvesEffect = effects.find((e) => e.type === 'curves');
  // Phase 15 (§0): only shown for a clip that actually HAS audio to normalize — a video/audio-
  // track clip (dedicated audio track, or a video clip's own embedded audio fallback, exactly
  // backend/video/renderPlanner.js's own buildClipAudioBranch() call sites). Sticker/caption clips
  // have no audio at all — hiding the toggle there avoids a control that would silently do nothing.
  const supportsAudio = track.type === 'video' || track.type === 'audio';
  const normalizeEffect = effects.find((e) => e.type === 'normalize');

  // Revisiting a Phase 4 deferred item (§0: "UI để user tự tạo clip.text/set volume/transform —
  // không có UI nào, chỉ set được qua fixture/console"). `clip.volume`/`audioFadeInMs`/
  // `audioFadeOutMs`/`videoFadeInMs`/`videoFadeOutMs` are TOP-LEVEL clip fields (not inside
  // `clip.effects` like colorGrade/etc. above) — same generic SetProperty, just a shorter path.
  // All 5 are EXPORT-ONLY (backend/video/renderPlanner.js's buildClipAudioBranch/
  // buildClipVideoBranch) — there has never been a live-preview equivalent (no Web Audio gain node,
  // no canvas fade-to-black), same class of gap as chroma-key/LUT/curves above, labeled the same way.
  // `from: clip[key]` — the RAW current value, genuinely `undefined` for a clip that never had
  // this field set (every clip created before this UI existed, and every clip InsertClip/import
  // creates today, which still don't set volume/fade fields at all). SetProperty's own validate()
  // checks this against the ACTUAL value in state with strict equality — defaulting `from` to
  // `defaultValue` here would falsely claim the state is already `1`/`0` when it's really
  // `undefined`, throwing "expected ... to be 1, got undefined" on the very first change. Display-
  // only fallbacks (`clip.volume ?? 1` etc.) stay in the JSX below, never here.
  const setClipField = (key, value) => {
    execute('SetProperty', {
      path: ['tracks', trackIndex, 'clips', clipIndex, key],
      from: clip[key],
      to: value,
    });
  };
  const setMaskField = (key, value) => {
    if (!clip.mask) setClipField('mask', { ...MASK_DEFAULTS, [key]: value });
    else execute('SetProperty', { path: ['tracks', trackIndex, 'clips', clipIndex, 'mask', key], from: clip.mask[key], to: value });
  };
  const setChromaField = (key, value) => {
    const index = effects.indexOf(chromaKeyEffect);
    execute('SetProperty', { path: ['tracks', trackIndex, 'clips', clipIndex, 'effects', index, 'params', key], from: chromaKeyEffect.params[key], to: value });
  };
  const setBackgroundField = (key, value) => {
    if (!clip.background) setClipField('background', { mode: 'none', color: '#000000', [key]: value });
    else execute('SetProperty', { path: ['tracks', trackIndex, 'clips', clipIndex, 'background', key], from: clip.background[key], to: value });
  };

  // commitCropField — 08-G G3 crop/mask (2026-09-04). `clip.crop` (shared/video-transform.js's
  // normalizedCropFor()/CROP_DEFAULTS) is a {x,y,width,height} object (0-1 fractions of the SOURCE
  // frame), edited here as 4 independent % fields — same "plain <input onChange>, commit every
  // keystroke" style the Fade in/out fields right below already use for this exact clip type
  // (video-only Disclosure), not a drag-gesture/draft-ref pattern. Clamps defensively so a typed
  // value can never violate invariants.js's assertValidCrop (width/height > 0, x+width<=1,
  // y+height<=1) — clamping the EDITED axis against the OTHER axis's current (unchanged) value,
  // never the reverse, so editing x/y never surprises the user by silently shrinking width/height
  // or vice versa.
  //
  // Writes to the LEAF path (`crop.<key>`, a plain number) once `clip.crop` already exists —
  // matching `transform.x`'s own precedent (SetProperty's validate() compares `from` via
  // `Object.is`, which is reference-equality for objects but value-equality for primitives; a
  // whole-object write on every keystroke would need the exact live object reference every time,
  // which is fragile — the codebase's only other object-shaped field, `effects[i].params`, is
  // likewise always edited leaf-by-leaf, never replaced wholesale). The FIRST edit on a clip that
  // has no `crop` yet is the one exception: there is no leaf to address, so it writes the whole
  // object once with `from: clip.crop` (`undefined`) — `Object.is(undefined, undefined)` is true
  // regardless of object identity, the same safe case `clip.volume`'s own "genuinely undefined on a
  // fresh clip" precedent (setClipField's header comment above) already relies on.
  const commitCropField = (key, rawPercent) => {
    const percent = Number.isFinite(rawPercent) ? rawPercent : 0;
    const raw = Math.min(100, Math.max(0, percent)) / 100;
    const current = clip.crop || CROP_DEFAULTS;
    let value = raw;
    if (key === 'x') value = Math.min(value, 1 - current.width);
    if (key === 'y') value = Math.min(value, 1 - current.height);
    if (key === 'width') value = Math.max(0.01, Math.min(value, 1 - current.x));
    if (key === 'height') value = Math.max(0.01, Math.min(value, 1 - current.y));
    if (clip.crop) {
      execute('SetProperty', {
        path: ['tracks', trackIndex, 'clips', clipIndex, 'crop', key],
        from: current[key], to: value,
      });
    } else {
      setClipField('crop', { ...CROP_DEFAULTS, [key]: value });
    }
  };

  // 08.3.1 §1 (Inspector transform fields) / 08.3.2 §4 (reset). `transformBase` — WITH defaults,
  // matching TransformOverlay.jsx's own `base` convention (that file's the only other transform
  // author; `clip.transform` is always fully populated at clip-creation time in every code path,
  // unlike volume/fade above which really can be `undefined` on old clips — so defaulting `from`
  // here is safe, not the NaN-risk setClipField's own comment warns about). `transformEffective` —
  // keyframe-interpolated at the playhead (evaluateClipTransform, same function Player.jsx/
  // TransformOverlay.jsx read for rendering) — what the fields DISPLAY. Editing a keyframed
  // property is disabled UNLESS auto-key is on AND the playhead sits inside this clip (08-G G4) —
  // see commitTransformChanges below for what "editing" then actually writes.
  const transformBase = { ...TRANSFORM_DEFAULTS, ...(clip.transform || {}) };
  const transformEffective = evaluateClipTransform(clip, playheadMs - clip.timelineInMs);
  const clipRelativeMs = playheadMs - clip.timelineInMs;
  const playheadInClip = clipRelativeMs >= 0 && clipRelativeMs <= (clip.timelineOutMs - clip.timelineInMs);
  const isTransformFieldDisabled = (key) => isLocked || (isPropertyAnimated(clip, key) && !(autoKeyEnabled && playheadInClip));

  // scaleChangesFor: when scaleLinked and `key` is scaleX/scaleY, also derives the OTHER axis so
  // the ratio between them is preserved (never re-derived from a snapshot — `transformBase` is
  // stable for the lifetime of a single gesture since nothing commits until release).
  const scaleChangesFor = (key, value) => {
    if (!scaleLinked || (key !== 'scaleX' && key !== 'scaleY')) return [{ key, to: value }];
    const otherKey = key === 'scaleX' ? 'scaleY' : 'scaleX';
    const ratio = transformBase[otherKey] / (transformBase[key] || 1);
    return [{ key, to: value }, { key: otherKey, to: clampScale(value * ratio) }];
  };
  // commitOneKeyframeOp: the actual "auto-key" write for ONE property — editing exactly AT an
  // existing keyframe's clip-relative time updates that keyframe's value in place
  // (SetKeyframeValue); any other time inserts a brand new keyframe there (AddKeyframe), which is
  // the literal auto-key moment (a plain edit silently starts animating a previously-static
  // property). `easing: 'linear'` matches the diamond-marker's own AddKeyframe default
  // (Timeline.jsx's handleAddKeyframeAtPlayhead) — no easing picker exists yet (G5).
  const commitOneKeyframeOp = (op) => {
    if (op.type === 'update') {
      execute('SetKeyframeValue', { trackId: track.id, clipId: clip.id, keyframeId: op.keyframeId, from: op.from, to: op.to });
    } else {
      execute('AddKeyframe', {
        trackId: track.id, clipId: clip.id,
        keyframe: { id: crypto.randomUUID(), propertyPath: `transform.${op.key}`, timeMs: clipRelativeMs, value: op.to, easing: 'linear' },
      });
    }
  };
  const commitTransformChanges = (rawChanges) => {
    const changes = rawChanges
      .map((c) => ({ key: c.key, from: transformBase[c.key], to: c.to }))
      .filter((c) => !Object.is(c.from, c.to));
    if (changes.length === 0) return;

    // Route each changed key independently: a property with zero keyframes always goes to the
    // static field (byte-identical to pre-auto-key behavior). One with keyframes goes to the
    // keyframe layer ONLY when auto-key is on and the playhead is actually inside this clip —
    // isTransformFieldDisabled already gates the UI the same way, this just mirrors that decision
    // for the commit itself.
    const staticChanges = [];
    const keyframeOps = [];
    for (const c of changes) {
      if (autoKeyEnabled && playheadInClip && isPropertyAnimated(clip, c.key)) {
        const existing = keyframesForProperty(clip, `transform.${c.key}`).find((kf) => Math.abs(kf.timeMs - clipRelativeMs) < 1e-6);
        if (existing) keyframeOps.push({ type: 'update', keyframeId: existing.id, from: existing.value, to: c.to });
        else keyframeOps.push({ type: 'insert', key: c.key, to: c.to });
      } else {
        staticChanges.push({ path: ['tracks', trackIndex, 'clips', clipIndex, 'transform', c.key], from: c.from, to: c.to });
      }
    }

    try {
      if (keyframeOps.length === 0) {
        // Every changed key is static — original pre-auto-key path, 1 command for the gesture.
        if (staticChanges.length === 1) execute('SetProperty', staticChanges[0]);
        else execute('SetProperties', { changes: staticChanges });
      } else if (staticChanges.length === 0 && keyframeOps.length === 1) {
        // The overwhelmingly common auto-key case (a single field edited) — still 1 command.
        commitOneKeyframeOp(keyframeOps[0]);
      } else {
        // Mixed static+keyframe, or >1 keyframe op, in the SAME gesture — only reachable via
        // scaleLinked dragging one axis while scaleX/scaleY have DIFFERENT keyframe states, an
        // edge case today's data model rarely produces (every clip's keyframes start out all-8-
        // together from "add keyframe at playhead"; only MoveKeyframe's per-marker drag, this same
        // 08-G G4 pass, can make them diverge). No existing command batches heterogeneous op types
        // atomically, so this falls back to N sequential commands (N undo steps) rather than
        // blocking the edit — same graceful-degradation choice handleAddKeyframeAtPlayhead already
        // makes (its own bulk add is N separate AddKeyframe commands, not 1 atomic batch, for the
        // identical reason).
        for (const sc of staticChanges) execute('SetProperty', sc);
        for (const op of keyframeOps) commitOneKeyframeOp(op);
      }
    } catch (err) {
      console.warn('EffectsPanel: dropped transform commit, state changed mid-gesture:', err.message);
    }
  };
  const commitTransformField = (key, value) => {
    const clamped = key === 'scaleX' || key === 'scaleY' ? clampScale(value) : value;
    commitTransformChanges(scaleChangesFor(key, clamped));
  };
  const resetTransformField = (key) => commitTransformField(key, TRANSFORM_DEFAULTS[key]);
  const resetAllTransform = () => {
    const changes = Object.keys(TRANSFORM_DEFAULTS)
      .filter((key) => !isPropertyAnimated(clip, key))
      .map((key) => ({ key, to: TRANSFORM_DEFAULTS[key] }));
    commitTransformChanges(changes);
  };

  // handleTransformScrubStart(key, meta): drag directly on a field's LABEL to fine-tune it —
  // there's no native slider driving this (unlike colorGradeDrag/dragVolume below, which read a
  // real <input type=range>'s onChange), so this tracks the pointer delta itself. Same commit
  // contract as every other gesture in this file: live-preview only per tick, exactly one command
  // on release.
  const handleTransformScrubStart = (key, meta) => (e) => {
    if (isTransformFieldDisabled(key)) return;
    e.preventDefault();
    const startClientX = e.clientX;
    const startValue = transformBase[key];
    transformDraggingRef.current[key] = true;
    const onMove = (ev) => {
      const raw = startValue + (ev.clientX - startClientX) * meta.scrubSensitivity;
      const rounded = Number((Math.round(raw / meta.step) * meta.step).toFixed(meta.precision));
      const clamped = key === 'scaleX' || key === 'scaleY' ? clampScale(rounded) : rounded;
      transformDraftRef.current[key] = clamped;
      setTransformDraft((d) => ({ ...d, [key]: clamped }));
      const patch = scaleChangesFor(key, clamped);
      setLivePreviewPatch(patch.map((c) => ({ path: ['transform', c.key], value: c.to, clipId: clip.id })));
    };
    function removeScrubListeners() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onCancel);
    }
    const onUp = () => {
      removeScrubListeners();
      delete transformDraggingRef.current[key];
      clearLivePreviewPatch();
      const finalValue = transformDraftRef.current[key];
      delete transformDraftRef.current[key];
      setTransformDraft((d) => { const next = { ...d }; delete next[key]; return next; });
      if (finalValue === undefined || finalValue === startValue) return;
      commitTransformField(key, finalValue);
    };
    // 08-L L4 (specs/ai-creative-operations-platform/08-v2/08-l-4-selection-focus-and-gesture-
    // grammar.md §4-§5): Escape-cancel + window-blur recovery, same gap/fix as
    // Timeline.jsx's handleTrimStart and TransformOverlay.jsx's move/resize — drops the gesture
    // with NO commit, distinct from onUp() which always commits the value reached.
    const onCancel = () => {
      removeScrubListeners();
      delete transformDraggingRef.current[key];
      clearLivePreviewPatch();
      delete transformDraftRef.current[key];
      setTransformDraft((d) => { const next = { ...d }; delete next[key]; return next; });
    };
    const onKeyDown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      onCancel();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onCancel);
  };
  // handleTransformTextCommit: blur/Enter path for typed edits — invalid/empty text silently
  // reverts to the real stored value (never commits NaN, ref 25-28's own requirement) since
  // clearing the draft below just falls back to displaying `transformEffective`/`transformBase`.
  const handleTransformTextCommit = (key, meta) => () => {
    const raw = transformDraft[key];
    setTransformDraft((d) => { const next = { ...d }; delete next[key]; return next; });
    if (raw === undefined || raw === '') return;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const rounded = Number(parsed.toFixed(meta.precision));
    commitTransformField(key, key === 'scaleX' || key === 'scaleY' ? clampScale(rounded) : rounded);
  };
  const handleTransformFieldKeyDown = (key, meta) => (e) => {
    if (e.key === 'Enter') { e.currentTarget.blur(); return; }
    if (e.key === 'Escape') {
      setTransformDraft((d) => { const next = { ...d }; delete next[key]; return next; });
      e.currentTarget.blur();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = stepFor(meta.nudgeSteps, e);
    const draftNum = transformDraft[key] !== undefined ? parseFloat(transformDraft[key]) : NaN;
    const current = Number.isFinite(draftNum) ? draftNum : transformEffective[key];
    commitTransformField(key, e.key === 'ArrowUp' ? current + step : current - step);
  };
  const startOpacityDrag = () => {
    transformDraggingRef.current.opacity = true;
    const onWindowUp = () => {
      window.removeEventListener('mouseup', onWindowUp);
      window.removeEventListener('blur', onWindowUp);
      delete transformDraggingRef.current.opacity;
      clearLivePreviewPatch();
      const finalValue = transformDraftRef.current.opacity;
      delete transformDraftRef.current.opacity;
      setTransformDraft((d) => { const next = { ...d }; delete next.opacity; return next; });
      if (finalValue === undefined) return;
      commitTransformField('opacity', finalValue);
    };
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('blur', onWindowUp); // 08-L L4 §5, same reasoning as startFieldDrag() above
  };
  const dragOpacity = (value) => {
    if (!transformDraggingRef.current.opacity) { commitTransformField('opacity', value); return; }
    transformDraftRef.current.opacity = value;
    setTransformDraft((d) => ({ ...d, opacity: value }));
    setLivePreviewPatch([{ path: ['transform', 'opacity'], value, clipId: clip.id }]);
  };

  // startVolumeDrag/dragVolume: onMouseDown captures the pre-gesture value AND flips
  // `volumeDraggingRef` so dragVolume() below knows a pointer gesture is active; every onChange
  // tick during that gesture only updates the live-preview patch + draft display, never the
  // store; a window-level 'mouseup' (not onMouseUp on the input — a release outside the slider
  // must still commit) fires exactly one SetProperty for the whole gesture. A range input's
  // onChange ALSO fires for keyboard arrow-key nudges, which never dispatch mousedown/mouseup at
  // all — `dragVolume` falls back to committing immediately (old, pre-08.1 per-change behavior)
  // whenever no gesture is active, which is both correct (each keypress is already one discrete,
  // reasonably-sized step, not a flood of sub-pixel ticks to batch) and required for keyboard
  // parity (§6: "keyboard có đường tương đương").
  const startVolumeDrag = () => {
    volumeDraggingRef.current = true;
    const from = clip.volume ?? 1;
    const onWindowUp = () => {
      window.removeEventListener('mouseup', onWindowUp);
      window.removeEventListener('blur', onWindowUp);
      volumeDraggingRef.current = false;
      clearLivePreviewPatch();
      const finalValue = volumeDraftRef.current;
      volumeDraftRef.current = null;
      setVolumeDraft(null);
      if (finalValue === null || finalValue === from) return;
      execute('SetProperty', { path: ['tracks', trackIndex, 'clips', clipIndex, 'volume'], from, to: finalValue });
    };
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('blur', onWindowUp); // 08-L L4 §5, same reasoning as startFieldDrag() above
  };
  const dragVolume = (value) => {
    if (!volumeDraggingRef.current) { setClipField('volume', value); return; }
    volumeDraftRef.current = value;
    setVolumeDraft(value);
    setLivePreviewPatch([{ clipId: clip.id, path: ['volume'], value }]);
  };

  const toggleNormalize = () => {
    if (normalizeEffect) {
      execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: normalizeEffect });
    } else {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'normalize', enabled: true, order: 0, params: {} },
      });
    }
  };

  const toggleChromaKey = () => {
    if (chromaKeyEffect) {
      execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: chromaKeyEffect });
    } else {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'chromaKey', enabled: true, order: 0, params: CHROMA_KEY_PARAMS },
      });
    }
  };

  const handleBlendModeChange = (e) => {
    const mode = e.target.value;
    if (blendModeEffect) execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: blendModeEffect });
    if (mode !== 'normal') {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'blendMode', enabled: true, order: 0, params: { mode } },
      });
    }
  };

  // commitColorGradeParam: the actual "AddEffect once, SetProperty after" write, shared by the
  // drag-end handler below and the keyboard-nudge fallback (dragColorGrade's own comment explains
  // why a keyboard change can't wait for a mouseup that will never come).
  const commitColorGradeParam = (key, from, hadEffect, value) => {
    if (value === undefined || value === from) return;
    if (hadEffect) {
      execute('SetProperty', {
        path: ['tracks', trackIndex, 'clips', clipIndex, 'effects', colorGradeIndex, 'params', key],
        from, to: value,
      });
    } else {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'colorGrade', enabled: true, order: 0, params: { ...DEFAULT_COLOR_GRADE, [key]: value } },
      });
    }
  };
  // startColorGradeDrag/dragColorGrade: same gesture-commit pattern as volume above, per `key`
  // (5 independent sliders, `colorGradeDraggingRef` keyed the same way). 1st drag ever on a clip
  // with no colorGrade effect yet still commits a single AddEffect seeded with
  // DEFAULT_COLOR_GRADE + this field (same "AddEffect once, SetProperty after" split
  // AddEffect.js's own header comment calls out) — live-preview is skipped for that one gesture
  // only (no `effects[]` entry to patch a path into yet), every subsequent drag on the same clip
  // previews live and commits one SetProperty. Keyboard arrow-key nudges fire onChange WITHOUT
  // ever dispatching mousedown/mouseup — dragColorGrade falls back to committing immediately (old,
  // pre-08.1 per-change behavior) whenever no gesture is active for that key, required for
  // keyboard parity (§6: "keyboard có đường tương đương").
  const startColorGradeDrag = (key) => {
    colorGradeDraggingRef.current[key] = true;
    const origin = { from: cg[key], hadEffect: !!colorGradeEffect };
    const onWindowUp = () => {
      window.removeEventListener('mouseup', onWindowUp);
      window.removeEventListener('blur', onWindowUp);
      delete colorGradeDraggingRef.current[key];
      clearLivePreviewPatch();
      const finalValue = colorGradeDraftRef.current[key];
      delete colorGradeDraftRef.current[key];
      setColorGradeDraft((d) => { const next = { ...d }; delete next[key]; return next; });
      commitColorGradeParam(key, origin.from, origin.hadEffect, finalValue);
    };
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('blur', onWindowUp); // 08-L L4 §5, same reasoning as startFieldDrag() above
  };
  const dragColorGrade = (key, value) => {
    if (!colorGradeDraggingRef.current[key]) { commitColorGradeParam(key, cg[key], !!colorGradeEffect, value); return; }
    colorGradeDraftRef.current[key] = value;
    setColorGradeDraft((d) => ({ ...d, [key]: value }));
    if (colorGradeEffect) setLivePreviewPatch([{ clipId: clip.id, path: ['effects', colorGradeIndex, 'params', key], value }]);
  };
  const resetColorGrade = () => {
    if (colorGradeEffect) execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: colorGradeEffect });
  };

  const commitLutPath = () => {
    const path = lutPathDraft.trim();
    if (path === (lutEffect?.params.path || '')) return; // no real change — avoid a no-op command
    if (!path) {
      if (lutEffect) execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: lutEffect });
      return;
    }
    if (lutEffect) {
      execute('SetProperty', {
        path: ['tracks', trackIndex, 'clips', clipIndex, 'effects', lutIndex, 'params', 'path'],
        from: lutEffect.params.path, to: path,
      });
    } else {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'lut', enabled: true, order: 0, params: { path } },
      });
    }
  };

  const handleCurvesChange = (e) => {
    const preset = e.target.value;
    if (curvesEffect) execute('RemoveEffect', { trackId: track.id, clipId: clip.id, effect: curvesEffect });
    if (preset) {
      execute('AddEffect', {
        trackId: track.id, clipId: clip.id,
        effect: { id: crypto.randomUUID(), type: 'curves', enabled: true, order: 0, params: { preset } },
      });
    }
  };

  const cg = colorGradeEffect?.params || DEFAULT_COLOR_GRADE;

  // renderTransformNumberField: the one JSX shape shared by Position X/Y, Scale X/Y and Rotation —
  // label doubles as a label-scrub drag handle (handleTransformScrubStart), the number input
  // itself handles typed edits + Up/Down keyboard nudge, the "↺" resets just that one field.
  // Disabled (both) whenever the property has keyframes — see transformBase's own comment above
  // for why editing/reset would otherwise silently do nothing at this playhead.
  const renderTransformNumberField = (key, label, meta) => {
    const disabledField = isTransformFieldDisabled(key);
    const displayValue = transformDraft[key] !== undefined ? transformDraft[key] : Number(transformEffective[key].toFixed(meta.precision));
    return (
      <div key={key} className="group">
        <div className="flex items-center justify-between text-[var(--n600,#4b5563)]">
          <label
            htmlFor={`transform-${key}`}
            onMouseDown={handleTransformScrubStart(key, meta)}
            title={
              !isPropertyAnimated(clip, key) ? 'Kéo ngang để chỉnh nhanh'
                : disabledField ? (playheadInClip ? 'Đang có keyframe — bật Auto-key để chỉnh tại playhead' : 'Đang có keyframe — đưa playhead vào trong clip để Auto-key chỉnh được')
                : 'Auto-key: kéo sẽ ghi đè keyframe tại playhead (hoặc thêm keyframe mới nếu playhead chưa ở đúng 1 keyframe)'
            }
            className={disabledField ? 'cursor-not-allowed' : 'cursor-ew-resize select-none'}
          >
            {label}
          </label>
          {/* 08-UI §6.3 Priority 0 bước 3: reset chỉ hiện rõ khi hover/focus row (opacity-0 mặc định)
              — trừ khi disabled, giữ ẩn hẳn để không gây nhầm có thể bấm. */}
          <button
            type="button" onClick={() => resetTransformField(key)} disabled={disabledField}
            title={`Về mặc định (${TRANSFORM_DEFAULTS[key]})`}
            className={`text-[var(--n600,#4b5563)] ${disabledField ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          >
            ↺
          </button>
        </div>
        <input
          id={`transform-${key}`} type="number" step={meta.step} disabled={disabledField}
          value={displayValue}
          onChange={(e) => setTransformDraft((d) => ({ ...d, [key]: e.target.value }))}
          onBlur={handleTransformTextCommit(key, meta)}
          onKeyDown={handleTransformFieldKeyDown(key, meta)}
          aria-label={label}
          className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
        />
      </div>
    );
  };

  return (
    <div className={`w-full ${embedded ? '' : 'h-full'} shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 space-y-4 text-xs overflow-y-auto`}>
      {isLocked && (
        <WarningBanner>Clip nằm trên track đang khoá — mở khoá track để chỉnh.</WarningBanner>
      )}
      {isHidden && (
        <div className="text-[var(--n600,#4b5563)] bg-[var(--n100,#f3f4f6)] rounded-lg px-2 py-1">
          Track của clip này đang ẩn.
        </div>
      )}
      {/* 08-UI §6.3 Priority 0 bước 3: tab top-level — chỉ hiện tab bar khi clip THẬT SỰ có cả 2
          nhóm nội dung (video effects luôn có; audio chỉ khi supportsAudio) — không tạo tab rỗng. */}
      {!transformOnly && (
        <div className="flex border-t border-[var(--card-border,#e5e7eb)] -mx-3 px-3">
          {(track.type === 'audio' ? [{ id: 'audio', label: 'Audio' }, { id: 'speed', label: 'Speed' }] : [{ id: 'video', label: track.type === 'video' ? 'Video' : 'Image' }, ...(supportsAudio ? [{ id: 'audio', label: 'Audio' }, { id: 'speed', label: 'Speed' }] : []), { id: 'adjust', label: 'Adjust' }]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)} aria-pressed={visibleTab === t.id}
              className={`h-8 px-3 border-b-2 -mb-px transition-colors ${visibleTab === t.id ? 'border-[var(--accent,#7C5CFA)] text-[var(--accent,#7C5CFA)] font-medium' : 'border-transparent text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!transformOnly && visibleTab === 'video' && <div className="flex gap-1 rounded-lg bg-[var(--n100)] p-1" role="group" aria-label="Thuộc tính hình ảnh">
        {[['basic', 'Basic'], ['remove', 'Remove BG'], ['mask', 'Mask']].map(([id, label]) => <button key={id} type="button" aria-pressed={videoTab === id} onClick={() => setVideoTab(id)}
          className={`flex-1 h-7 rounded-md ${videoTab === id ? 'bg-[var(--card)] text-[var(--text)] shadow-sm' : 'text-[var(--n600)]'}`}>{label}</button>)}
      </div>}
      <fieldset disabled={isLocked} className="contents">
      {track.type !== 'audio' && (transformOnly || (visibleTab === 'video' && videoTab === 'basic')) && <div className="group border-b border-[var(--card-border,#e5e7eb)] pb-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[var(--n600,#4b5563)]">Transform</span>
          <button
            type="button" onClick={resetAllTransform}
            className="text-[var(--n600,#4b5563)] underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Về mặc định
          </button>
        </div>
        {/* 08-G G4 auto-key: ALWAYS visible (not hover-only like "Về mặc định" above) — this is a
            standing mode, not a one-off action, and the whole point is the user can tell at a
            glance whether editing an animated field right now will keyframe it or stay disabled. */}
        <label
          className="flex items-center gap-1.5 text-[var(--n600,#4b5563)]"
          title={playheadInClip ? 'Bật: chỉnh 1 property đã có keyframe sẽ ghi/thêm keyframe tại playhead thay vì bị khoá' : 'Playhead đang ở ngoài clip này — Auto-key chỉ có tác dụng khi playhead nằm trong clip'}
        >
          <input type="checkbox" checked={autoKeyEnabled} onChange={(e) => setAutoKeyEnabled(e.target.checked)} />
          Auto-key{!playheadInClip && autoKeyEnabled ? ' (playhead ngoài clip)' : ''}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {renderTransformNumberField('x', 'Position X', POSITION_META)}
          {renderTransformNumberField('y', 'Position Y', POSITION_META)}
        </div>
        <div className="flex items-center justify-between text-[var(--n600,#4b5563)]">
          <span>Scale</span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={scaleLinked} onChange={(e) => setScaleLinked(e.target.checked)} />
            Liên kết X/Y
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {renderTransformNumberField('scaleX', 'Scale X', SCALE_META)}
          {renderTransformNumberField('scaleY', 'Scale Y', SCALE_META)}
        </div>
        {renderTransformNumberField('rotation', 'Rotation (°)', ROTATION_META)}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Căn asset theo canvas">
          {[['x', -1, 'Căn trái'], ['x', 0, 'Căn giữa ngang'], ['x', 1, 'Căn phải'], ['y', -1, 'Căn trên'], ['y', 0, 'Căn giữa dọc'], ['y', 1, 'Căn dưới']].map(([axis, direction, label]) => <button
            key={label} type="button" aria-label={label} title={label} disabled={isTransformFieldDisabled(axis)}
            className="h-7 rounded border border-[var(--card-border)] px-2 text-[var(--n600)] hover:bg-[var(--n100)] disabled:opacity-40"
            onClick={() => {
              const placement = computeCanvasPlacement(transformEffective, projectState.resolution, sourceSize, normalizedCropFor(clip));
              const c = Math.abs(Math.cos(placement.rotationRadians)), s = Math.abs(Math.sin(placement.rotationRadians));
              const extent = axis === 'x' ? placement.destWidth * c + placement.destHeight * s : placement.destHeight * c + placement.destWidth * s;
              const canvasExtent = axis === 'x' ? projectState.resolution.width : projectState.resolution.height;
              commitTransformField(axis, Math.round(direction * (canvasExtent - extent) / 2));
            }}>{label.replace('Căn ', '')}</button>)}
        </div>
        <div>
          <label htmlFor="transform-opacity" className="flex justify-between text-[var(--n600,#4b5563)]">
            <span>Opacity</span><span>{Math.round((transformDraft.opacity ?? transformEffective.opacity) * 100)}%</span>
          </label>
          <input
            id="transform-opacity" type="range" min={0} max={1} step={NUDGE_STEPS.opacity.base} disabled={isTransformFieldDisabled('opacity')}
            value={transformDraft.opacity ?? transformEffective.opacity}
            onMouseDown={startOpacityDrag}
            onChange={(e) => dragOpacity(parseFloat(e.target.value))}
            aria-label="Opacity"
            className="w-full focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 disabled:opacity-40"
          />
        </div>
      </div>}
      {!transformOnly && visibleTab === 'speed' && <ClipSpeedPanel clip={clip} track={track} />}

      {!transformOnly && ['video', 'adjust'].includes(visibleTab) && (
        <>
          <div hidden={visibleTab !== 'video' || videoTab !== 'remove'}>
          <Disclosure title="Chroma key" defaultOpen>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!chromaKeyEffect} onChange={toggleChromaKey} />
              Chroma key — Preview và Export
            </label>
            {chromaKeyEffect && <div className="space-y-2">
              <PropertyField label="Màu cần xoá" type="color" value={chromaKeyEffect.params.color.replace('0x', '#')} onCommit={value => setChromaField('color', value.replace('#', '0x'))} />
              {typeof window.EyeDropper === 'function' && <button type="button" className="h-8 px-3 rounded-lg border border-[var(--card-border)]" onClick={async () => {
                try { const color = await new window.EyeDropper().open(); setChromaField('color', color.sRGBHex.replace('#', '0x')); } catch (error) { if (error.name !== 'AbortError') console.warn('Không thể lấy màu:', error.message); }
              }}>Lấy màu trên màn hình</button>}
              <PropertyField label="Cường độ chroma" value={chromaKeyEffect.params.similarity} min={0.001} max={1} step={0.01} onCommit={value => setChromaField('similarity', value)} />
              <PropertyField label="Shadow chroma" value={chromaKeyEffect.params.shadow ?? 0} min={0} max={1} step={0.01} onCommit={value => setChromaField('shadow', value)} />
              <PropertyField label="Feather chroma" value={chromaKeyEffect.params.blend} min={0} max={1} step={0.01} onCommit={value => setChromaField('blend', value)} />
              <PropertyField label="Clean up edge" value={chromaKeyEffect.params.cleanup ?? 0} min={0} max={1} step={0.01} onCommit={value => setChromaField('cleanup', value)} />
            </div>}
          </Disclosure>

          </div>
          <div hidden={visibleTab !== 'video' || videoTab !== 'basic'}>
          <Disclosure title="Blend mode" defaultOpen>

            <label className="block mb-1 text-[var(--n600,#4b5563)]">
              {track.type === 'sticker'
                ? 'Blend mode (Preview và Export)'
                : 'Blend mode (Export: cần track khác bên dưới)'}
            </label>
            <select
              title="Blend mode clip đã chọn"
              value={blendModeEffect?.params.mode || 'normal'}
              onChange={handleBlendModeChange}
              className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-1"
            >
              {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Disclosure>
          <Disclosure title="Canvas" defaultOpen={false}>
            <PropertyField label="Nền canvas" value={clip.background?.mode || 'none'} options={[
              { value: 'none', label: 'Không' }, { value: 'color', label: 'Màu' }, { value: 'blur', label: 'Làm mờ video nền' },
            ]} onCommit={value => setBackgroundField('mode', value)} />
            {clip.background?.mode === 'color' && <PropertyField label="Màu canvas" type="color" value={clip.background.color} onCommit={value => setBackgroundField('color', value)} />}
          </Disclosure>

          {['video', 'image', 'sticker'].includes(track.type) && (
            <Disclosure title="Fade hình (đen)" defaultOpen>
              <span className="text-[var(--n600,#4b5563)]">Preview và Export</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="video-fade-in" className="block text-[var(--n600,#4b5563)]">Fade in (giây)</label>
                  <input
                    id="video-fade-in"
                    type="number"
                    min={0}
                    step={0.1}
                    value={(clip.videoFadeInMs ?? 0) / 1000}
                    onChange={(e) => setClipField('videoFadeInMs', Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                    className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="video-fade-out" className="block text-[var(--n600,#4b5563)]">Fade out (giây)</label>
                  <input
                    id="video-fade-out"
                    type="number"
                    min={0}
                    step={0.1}
                    value={(clip.videoFadeOutMs ?? 0) / 1000}
                    onChange={(e) => setClipField('videoFadeOutMs', Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                    className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
                  />
                </div>
              </div>
            </Disclosure>
          )}

          </div>
          <div hidden={visibleTab !== 'video' || videoTab !== 'mask'}>
          {['video', 'image', 'sticker'].includes(track.type) && (
            <Disclosure title="Crop / Mask" defaultOpen>
              <div className="space-y-2 pb-3 border-b border-[var(--card-border)]">
                <PropertyField label="Bật mask" type="checkbox" value={!!clip.mask && clip.mask.enabled !== false} onCommit={value => setMaskField('enabled', value)} />
                {clip.mask?.enabled !== false && clip.mask && <>
                  <PropertyField label="Dạng mask" value={clip.mask.type} options={['circle', 'rectangle', 'split', 'mirror', 'diamond', 'heart', 'star', 'text', 'brush', 'draw']} onCommit={value => setMaskField('type', value)} />
                  {['text', 'brush', 'draw'].includes(clip.mask.type) && <MaskDrawing key={`${clip.id}:${clip.mask.type}`} mask={clip.mask} onChange={setMaskField} disabled={isLocked} />}
                  {[['x', 'Mask X', 0, 1], ['y', 'Mask Y', 0, 1], ['width', 'Rộng mask', 0.01, 2], ['height', 'Cao mask', 0.01, 2], ['rotation', 'Xoay mask', -360, 360], ['feather', 'Feather mask', 0, 1]].map(([key, label, min, max]) =>
                    <PropertyField key={key} label={label} value={clip.mask[key] ?? MASK_DEFAULTS[key]} min={min} max={max} step={key === 'rotation' ? 1 : 0.01} onCommit={value => setMaskField(key, value)} />)}
                  <PropertyField label="Đảo mask" type="checkbox" value={clip.mask.invert} onCommit={value => setMaskField('invert', value)} />
                </>}
              </div>
              <span className="text-[var(--n600,#4b5563)]">Cắt vùng hiển thị của clip (theo % khung hình gốc)</span>
              {clip.crop && (
                <div className="flex justify-end -mt-1">
                  <button type="button" onClick={() => setClipField('crop', undefined)} className="text-[var(--n600,#4b5563)] underline">Reset</button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'x', label: 'X (%)' },
                  { key: 'y', label: 'Y (%)' },
                  { key: 'width', label: 'Rộng (%)' },
                  { key: 'height', label: 'Cao (%)' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label htmlFor={`crop-${key}`} className="block text-[var(--n600,#4b5563)]">{label}</label>
                    <input
                      id={`crop-${key}`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round((clip.crop || CROP_DEFAULTS)[key] * 100)}
                      onChange={(e) => commitCropField(key, parseFloat(e.target.value))}
                      className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
                    />
                  </div>
                ))}
              </div>
            </Disclosure>
          )}

          </div>
          <div hidden={visibleTab !== 'adjust'}>
          <Disclosure title="Color grading" defaultOpen>
            {colorGradeEffect && (
              <div className="flex justify-end -mt-1">
                <button type="button" onClick={resetColorGrade} className="text-[var(--n600,#4b5563)] underline">Reset</button>
              </div>
            )}
            {[
              { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05 },
              { key: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05 },
              { key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.05 },
              { key: 'gamma', label: 'Gamma (chỉ Export)', min: 0.1, max: 3, step: 0.05 },
              { key: 'hue', label: 'Hue', min: -180, max: 180, step: 5 },
            ].map(({ key, label, min, max, step }) => (
              <div key={key}>
                <label htmlFor={`cg-${key}`} className="flex justify-between text-[var(--n600,#4b5563)]">
                  <span>{label}</span><span>{colorGradeDraft[key] ?? cg[key]}</span>
                </label>
                <input
                  id={`cg-${key}`}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={colorGradeDraft[key] ?? cg[key]}
                  onMouseDown={() => startColorGradeDrag(key)}
                  onChange={(e) => dragColorGrade(key, parseFloat(e.target.value))}
                  aria-label={label}
                  className="w-full focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
                />
              </div>
            ))}
          </Disclosure>

          <Disclosure title="LUT" defaultOpen={false}>
            <label htmlFor="lut-path" className="block mb-1 text-[var(--n600,#4b5563)]">LUT .cube (chỉ áp dụng khi Export)</label>
            <input
              id="lut-path"
              type="text"
              value={lutPathDraft}
              onChange={(e) => setLutPathDraft(e.target.value)}
              onBlur={commitLutPath}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder="Đường dẫn tuyệt đối tới .cube"
              className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
            />
          </Disclosure>

          <Disclosure title="Curves" defaultOpen={false}>
            <label htmlFor="curves-preset" className="block mb-1 text-[var(--n600,#4b5563)]">Curves preset (chỉ áp dụng khi Export)</label>
            <select
              id="curves-preset"
              value={curvesEffect?.params.preset || ''}
              onChange={handleCurvesChange}
              className="w-full h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-1"
            >
              <option value="">(không)</option>
              {CURVES_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Disclosure>
          </div>
        </>
      )}

      {!transformOnly && supportsAudio && visibleTab === 'audio' && (
        <>
          <PropertyField label="Âm lượng (dB)" value={Math.round(20 * Math.log10(Math.max(0.001, clip.volume ?? 1)) * 10) / 10} min={-60} max={20} step={0.1}
            onCommit={value => setClipField('volume', value <= -60 ? 0 : 10 ** (value / 20))} />
          <PropertyField label="Fill channel" value={clip.audioChannel || 'none'} options={[
            { value: 'none', label: 'Stereo gốc' }, { value: 'left', label: 'Kênh trái → hai bên' },
            { value: 'right', label: 'Kênh phải → hai bên' }, { value: 'mono', label: 'Trộn mono' },
          ]} onCommit={value => setClipField('audioChannel', value)} />
          <PropertyField label="Giữ cao độ khi đổi tốc độ" type="checkbox" value={clip.preservePitch !== false} onCommit={value => setClipField('preservePitch', value)} />
          <Disclosure title="Chuẩn hoá âm lượng" defaultOpen={false}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!normalizeEffect} onChange={toggleNormalize} />
              Chuẩn hoá âm lượng (chỉ áp dụng khi Export)
            </label>
          </Disclosure>

          <Disclosure title="Âm lượng & Fade" defaultOpen>
            <div>
              <label htmlFor="clip-volume" className="flex justify-between text-[var(--n600,#4b5563)]">
                <span>Âm lượng (Preview và Export)</span><span>{Math.round((volumeDraft ?? clip.volume ?? 1) * 100)}%</span>
              </label>
              <input
                id="clip-volume"
                type="range"
                min={0}
                max={10}
                step={0.05}
                value={volumeDraft ?? clip.volume ?? 1}
                onMouseDown={startVolumeDrag}
                onChange={(e) => dragVolume(parseFloat(e.target.value))}
                aria-label="Âm lượng clip"
                className="w-full focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              />
            </div>
            <span className="text-[var(--n600,#4b5563)]">Fade âm thanh (Preview và Export)</span>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="audio-fade-in" className="block text-[var(--n600,#4b5563)]">Fade in (giây)</label>
                <input
                  id="audio-fade-in"
                  type="number"
                  min={0}
                  step={0.1}
                  value={(clip.audioFadeInMs ?? 0) / 1000}
                  onChange={(e) => setClipField('audioFadeInMs', Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="audio-fade-out" className="block text-[var(--n600,#4b5563)]">Fade out (giây)</label>
                <input
                  id="audio-fade-out"
                  type="number"
                  min={0}
                  step={0.1}
                  value={(clip.audioFadeOutMs ?? 0) / 1000}
                  onChange={(e) => setClipField('audioFadeOutMs', Math.max(0, parseFloat(e.target.value) || 0) * 1000)}
                  className="w-full h-8 text-right rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2"
                />
              </div>
            </div>
          </Disclosure>
        </>
      )}
      </fieldset>
    </div>
  );
}
