// 08-L L6 (specs/ai-creative-operations-platform/08-v2/08-l-editor-experience-and-interaction-
// system.md, work package L6): a discoverable surface for the editor's real keyboard shortcuts —
// before this, the ONLY way to learn a shortcut was hovering a toolbar button's tooltip one at a
// time (Timeline.jsx's iconBtn labels), and several real shortcuts have NO toolbar button at all
// (Escape, frame-step, canvas nudge, Media Bin select-all) so were undiscoverable by any means.
// Pure read-only display over `actionRegistry.js` (ACTIONS) — filters to entries that actually HAVE
// a keyboard shortcut today (`entryPoints.shortcut`), grouped by region; a missing shortcut for an
// action (e.g. mediaBin.deleteSelectedAssets, which only has a toolbar button + context menu today)
// simply doesn't appear here rather than showing a misleading "none" row.
//
// Same modal shell convention as CreateTimelinesDialog.jsx (fixed overlay, click-outside-to-close,
// rounded card, header + X). Escape-to-close is handled by the CALLER (Timeline.jsx's own global
// keydown handler checks `showShortcutHelp` before its usual Escape branch — marquee-cancel/clear-
// selection) rather than a second listener here, since Escape is a window-level shortcut that isn't
// scoped to this dialog and would otherwise fire underneath it too.

import { X } from 'lucide-react';
import { ACTIONS } from '../actionRegistry.js';
import { useDialogFocus } from '../useDialogFocus.js';

const REGION_LABEL = {
  timeline: 'Timeline',
  canvas: 'Canvas / Preview',
  mediaBin: 'Media Bin',
  transport: 'Playback',
};
const REGION_ORDER = ['timeline', 'canvas', 'mediaBin', 'transport'];

export default function ShortcutHelpDialog({ onClose }) {
  const dialogRef = useDialogFocus(onClose);
  const byRegion = REGION_ORDER
    .map((region) => ({ region, actions: ACTIONS.filter((a) => a.region === region && a.entryPoints.shortcut) }))
    .filter((g) => g.actions.length > 0);

  return (
    <div
      data-testid="shortcut-help-dialog"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Phím tắt" className="w-[440px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-sm font-semibold text-[var(--text,#111827)]">Phím tắt</h2>
          <button type="button" onClick={onClose} aria-label="Đóng" title="Đóng" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 text-xs">
          {byRegion.map(({ region, actions }) => (
            <div key={region} className="flex flex-col gap-1.5">
              <h3 className="font-medium text-[var(--n600,#4b5563)]">{REGION_LABEL[region] || region}</h3>
              <dl className="flex flex-col gap-1">
                {actions.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3">
                    <dt className="text-[var(--n600,#4b5563)]">{a.label}</dt>
                    <dd className="shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded border border-[var(--card-border,#e5e7eb)] bg-[var(--n100,#f3f4f6)] text-[var(--text,#111827)]">
                      {a.entryPoints.shortcut}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
