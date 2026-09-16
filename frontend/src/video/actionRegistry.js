// 08-L L3 (specs/ai-creative-operations-platform/08-v2/08-l-3-canonical-action-registry.md):
// canonical action registry — ONE place describing every discrete editor action's id, region,
// selection cardinality, transaction type and CURRENT entry points (toolbar/shortcut/context-menu/
// drag-gesture), mirroring exactly what the real components do today (audited in 08-l-3's §1, file:
// line evidence there). This is deliberately a MIRROR, not yet the execution source: Timeline.jsx/
// MediaBin.jsx/TransportBar.jsx still own their own onClick/handleKeyDown wiring — wiring them to
// read FROM this registry is L5's job (needs L4's selection/focus grammar locked first, see 08-l-3
// §3 "Cố ý CHƯA làm"). `entryPoints: false` here reflects a REAL missing entry point (a gap 08-l-3
// found), not a mistake in this file — do not "fix" an action's entryPoints without also actually
// adding that entry point in the real component and updating both together.
//
// `enabledWhen`/`disabledReason` take a `ctx` shaped like:
//   { primarySelectedClip: { clip, track } | null, selectedIds: string[], canUndo, canRedo,
//     hasProjectState: boolean, hasPrevKeyframe: boolean, hasNextKeyframe: boolean }
// — the same facts Timeline.jsx's own toolbar disabled-checks already read today (see 08-l-3 §1.1
// evidence column for where each one currently lives). hasPrevKeyframe/hasNextKeyframe added by
// 08-G G4 (prevKeyframeMarker/nextKeyframeMarker in Timeline.jsx).

import { MOD_LABEL } from './shortcuts.js';

export const ACTIONS = [
  {
    id: 'timeline.undo',
    region: 'timeline',
    label: 'Undo',
    selectionCardinality: 'none',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.canUndo,
    disabledReason: (ctx) => (ctx.canUndo ? null : 'Không có gì để undo'),
    entryPoints: { toolbar: true, shortcut: 'Mod+Z', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.redo',
    region: 'timeline',
    label: 'Redo',
    selectionCardinality: 'none',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.canRedo,
    disabledReason: (ctx) => (ctx.canRedo ? null : 'Không có gì để redo'),
    entryPoints: { toolbar: true, shortcut: 'Mod+Shift+Z hoặc Mod+Y', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.splitAtPlayhead',
    region: 'timeline',
    label: 'Split tại playhead',
    selectionCardinality: 'single',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip && !ctx.primarySelectedClip.track.locked,
    disabledReason: (ctx) => {
      if (!ctx.primarySelectedClip) return 'Chưa chọn clip nào ở playhead';
      if (ctx.primarySelectedClip.track.locked) return 'Track đang khoá';
      return null;
    },
    // 08-L L3 gap-patch (same increment as timeline.duplicateClip below): Timeline.jsx's new clip
    // context menu also includes Split (disabled unless the playhead is actually inside the right-
    // clicked clip — same enabledWhen this action already had, just exposed a 2nd way in).
    entryPoints: { toolbar: true, shortcut: 'S', contextMenu: true, dragGesture: null },
  },
  {
    id: 'timeline.deleteSelection',
    region: 'timeline',
    label: 'Xoá clip đã chọn (giữ gap)',
    selectionCardinality: 'multi',
    transactionType: 'command',
    destructive: true,
    enabledWhen: (ctx) => ctx.selectedIds.length > 0,
    disabledReason: (ctx) => (ctx.selectedIds.length > 0 ? null : 'Chưa chọn clip nào'),
    entryPoints: { toolbar: true, shortcut: 'Delete hoặc Backspace', contextMenu: true, dragGesture: null },
  },
  {
    id: 'timeline.rippleDeleteSelection',
    region: 'timeline',
    label: 'Ripple delete (đóng gap)',
    selectionCardinality: 'multi',
    transactionType: 'command',
    destructive: true,
    enabledWhen: (ctx) => ctx.selectedIds.length > 0,
    disabledReason: (ctx) => (ctx.selectedIds.length > 0 ? null : 'Chưa chọn clip nào'),
    entryPoints: { toolbar: true, shortcut: 'Shift+Delete hoặc Shift+Backspace', contextMenu: true, dragGesture: null },
  },
  {
    id: 'timeline.addKeyframeAtPlayhead',
    region: 'timeline',
    label: 'Thêm keyframe tại playhead',
    selectionCardinality: 'single',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip && !ctx.primarySelectedClip.track.locked,
    disabledReason: (ctx) => {
      if (!ctx.primarySelectedClip) return 'Chưa chọn clip nào';
      if (ctx.primarySelectedClip.track.locked) return 'Track đang khoá';
      return null;
    },
    entryPoints: { toolbar: true, shortcut: 'K', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.prevKeyframe',
    region: 'timeline',
    label: 'Keyframe trước',
    selectionCardinality: 'single',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.hasPrevKeyframe,
    disabledReason: (ctx) => (ctx.hasPrevKeyframe ? null : 'Không có keyframe nào trước playhead trên clip này'),
    entryPoints: { toolbar: true, shortcut: 'Alt+←', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.nextKeyframe',
    region: 'timeline',
    label: 'Keyframe sau',
    selectionCardinality: 'single',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.hasNextKeyframe,
    disabledReason: (ctx) => (ctx.hasNextKeyframe ? null : 'Không có keyframe nào sau playhead trên clip này'),
    entryPoints: { toolbar: true, shortcut: 'Alt+→', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.duplicateClip',
    region: 'timeline',
    label: 'Nhân bản clip',
    selectionCardinality: 'single',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip && !ctx.primarySelectedClip.track.locked,
    disabledReason: (ctx) => {
      if (!ctx.primarySelectedClip) return 'Chưa chọn clip nào';
      if (ctx.primarySelectedClip.track.locked) return 'Track đang khoá';
      return null;
    },
    // 08-l-3 §2 finding #2, PATCHED (Timeline.jsx now has a toolbar button + clip context menu
    // item, both calling the same handleDuplicateClip() the Mod+D shortcut always used) — see
    // 08-l-3's own file for the original "Cố ý CHƯA làm" note this closes.
    entryPoints: { toolbar: true, shortcut: 'Mod+D', contextMenu: true, dragGesture: 'Alt+drag' },
  },
  {
    // 08-F F4 (specs/.../08-v2/08-f-timeline-authoring.md): tags 2+ selected clips with a shared
    // `groupId` (SetProperties, no new command type) — a click on any member re-selects the whole
    // group, dragging any member moves the whole group together (relative offsets preserved).
    id: 'timeline.groupSelection',
    region: 'timeline',
    label: 'Nhóm clip đã chọn',
    selectionCardinality: 'multi',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => ctx.selectedIds.length >= 2,
    disabledReason: (ctx) => (ctx.selectedIds.length >= 2 ? null : 'Chọn từ 2 clip trở lên để nhóm'),
    entryPoints: { toolbar: true, shortcut: 'Mod+G', contextMenu: true, dragGesture: null },
  },
  {
    // Dissolves the WHOLE group the current selection touches, not just the selected subset —
    // standard NLE convention. `enabledWhen` approximates via `primarySelectedClip` (the registry
    // is a documentation mirror, not the live execution source — see file header) rather than
    // replicating Timeline.jsx's own full every-selected-clip loop.
    id: 'timeline.ungroupSelection',
    region: 'timeline',
    label: 'Bỏ nhóm',
    selectionCardinality: 'multi',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip?.clip.groupId,
    disabledReason: (ctx) => (ctx.primarySelectedClip?.clip.groupId ? null : 'Lựa chọn không thuộc nhóm nào'),
    entryPoints: { toolbar: true, shortcut: 'Mod+Shift+G', contextMenu: true, dragGesture: null },
  },
  {
    // 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): opens
    // EmbedTimelineDialog.jsx — renders the picked timeline, promotes the output to an asset, then
    // InsertClip's it — a multi-step ASYNC operation (embedOperation in store.js), not a single
    // durable command the way every other entry in this file is.
    id: 'timeline.embedTimeline',
    region: 'timeline',
    label: 'Ghép timeline khác (compound clip)',
    selectionCardinality: 'none',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => ctx.hasProjectState,
    disabledReason: (ctx) => (ctx.hasProjectState ? null : 'Chưa có project nào đang mở'),
    entryPoints: { toolbar: true, shortcut: null, contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.openNestedTimeline',
    region: 'timeline',
    label: 'Mở timeline lồng',
    selectionCardinality: 'single',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip?.clip.compoundRef,
    disabledReason: (ctx) => (ctx.primarySelectedClip?.clip.compoundRef ? null : 'Clip này không phải compound clip'),
    entryPoints: { toolbar: false, shortcut: null, contextMenu: true, dragGesture: null },
  },
  {
    // Scoped to the untouched-embed case only — Timeline.jsx's own canUnpackClip() (speed===1, not
    // trimmed relative to the asset's full duration) gates this, not just compoundRef's presence —
    // see shared/video-commands/UnpackCompoundClip.js's header for why.
    id: 'timeline.unpackCompoundClip',
    region: 'timeline',
    label: 'Bung timeline lồng',
    selectionCardinality: 'single',
    transactionType: 'command',
    destructive: true,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip?.clip.compoundRef,
    disabledReason: (ctx) => (ctx.primarySelectedClip?.clip.compoundRef ? null : 'Clip này không phải compound clip'),
    entryPoints: { toolbar: false, shortcut: null, contextMenu: true, dragGesture: null },
  },
  {
    id: 'transport.togglePlay',
    region: 'transport',
    label: 'Play/Pause',
    selectionCardinality: 'none',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.hasProjectState,
    disabledReason: (ctx) => (ctx.hasProjectState ? null : 'Chưa có project'),
    // 08-l-3 §2 finding #3, PATCHED — Space now bound in Timeline.jsx's handleKeyDown (see 08-l-3's
    // own file for the original "Gap thật" note this closes).
    entryPoints: { toolbar: true, shortcut: 'Space', contextMenu: false, dragGesture: null },
  },
  {
    id: 'mediaBin.deleteSelectedAssets',
    region: 'mediaBin',
    label: 'Xoá asset đã chọn',
    selectionCardinality: 'multi',
    transactionType: 'command',
    destructive: true,
    enabledWhen: (ctx) => ctx.selectedIds.length > 0,
    disabledReason: (ctx) => (ctx.selectedIds.length > 0 ? null : 'Chưa chọn asset nào'),
    entryPoints: { toolbar: true, shortcut: null, contextMenu: true, dragGesture: null },
  },

  // 08-L L6 (specs/ai-creative-operations-platform/08-v2/08-l-editor-experience-and-interaction-
  // system.md, work package L6 "shortcut help"): the 5 entries below extend 08-l-3's original audit
  // (which only covered TOOLBAR-visible actions) to the rest of the REAL, always-discoverable
  // keyboard surface — audited directly from each component's own handler before adding here, same
  // discipline as 08-l-3 §1. Deliberately EXCLUDES two categories that also use keydown listeners but
  // aren't "shortcuts" in the discoverable sense a help dialog should list: (1) ephemeral in-gesture
  // Escape-cancel (Timeline.jsx's trim drag, EffectsPanel.jsx's scrub drag, TransformOverlay.jsx's
  // move/resize — all drop the gesture with no commit, same pattern, only reachable mid-drag, not a
  // standing command) and (2) a focused number input's own ArrowUp/Down nudge
  // (EffectsPanel.jsx's handleTransformFieldKeyDown) — implicit widget behavior, not an app-level
  // command. `region: 'canvas'` is new here (Player.jsx's own scope, distinct from `timeline`).
  {
    id: 'timeline.clearSelectionOrCancel',
    region: 'timeline',
    label: 'Bỏ chọn / huỷ marquee đang kéo',
    selectionCardinality: 'none',
    transactionType: 'session',
    destructive: false,
    enabledWhen: () => true,
    disabledReason: () => null,
    entryPoints: { toolbar: false, shortcut: 'Escape', contextMenu: false, dragGesture: null },
  },
  {
    id: 'timeline.stepPlayheadByFrame',
    region: 'timeline',
    label: 'Tua playhead từng frame',
    selectionCardinality: 'none',
    transactionType: 'session',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.hasProjectState,
    disabledReason: (ctx) => (ctx.hasProjectState ? null : 'Chưa có project'),
    entryPoints: { toolbar: false, shortcut: '← / →', contextMenu: false, dragGesture: null },
  },
  {
    id: 'canvas.nudgeSelectedClipPosition',
    region: 'canvas',
    label: 'Di chuyển clip đã chọn theo pixel (giữ Shift = bước lớn, Alt = bước nhỏ)',
    selectionCardinality: 'single',
    transactionType: 'command',
    destructive: false,
    enabledWhen: (ctx) => !!ctx.primarySelectedClip && !ctx.primarySelectedClip.track.locked,
    disabledReason: (ctx) => {
      if (!ctx.primarySelectedClip) return 'Chưa chọn clip nào';
      if (ctx.primarySelectedClip.track.locked) return 'Track đang khoá';
      return null;
    },
    entryPoints: { toolbar: false, shortcut: '↑ ↓ ← →', contextMenu: false, dragGesture: null },
  },
  {
    id: 'mediaBin.selectAllReady',
    region: 'mediaBin',
    label: 'Chọn tất cả asset sẵn sàng',
    selectionCardinality: 'multi',
    transactionType: 'session',
    destructive: false,
    enabledWhen: () => true,
    disabledReason: () => null,
    entryPoints: { toolbar: false, shortcut: `${MOD_LABEL}+A`, contextMenu: false, dragGesture: null },
  },
  {
    id: 'mediaBin.clearSelection',
    region: 'mediaBin',
    label: 'Bỏ chọn asset',
    selectionCardinality: 'none',
    transactionType: 'session',
    destructive: false,
    enabledWhen: () => true,
    disabledReason: () => null,
    entryPoints: { toolbar: false, shortcut: 'Escape', contextMenu: false, dragGesture: null },
  },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function getAction(id) {
  return BY_ID.get(id);
}

export function actionsForRegion(region) {
  return ACTIONS.filter((a) => a.region === region);
}
