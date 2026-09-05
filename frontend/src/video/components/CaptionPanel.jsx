// Video Editor Phase 13 (specs/space-flow-master-plan/04-video-editor.md §5): sidebar for editing
// the SELECTED caption cue's text — mirrors EffectsPanel.jsx's shape (target lookup, early return,
// commit-on-blur draft state) but for a `type: 'caption'` track's clip instead of a video clip's
// effects. VideoWorkspace.jsx renders this INSTEAD OF EffectsPanel when the selection is a caption
// cue (a caption cue has no `.effects` to speak of — different content, same sidebar slot).
//
// Deliberately minimal, same "giữ đơn giản" precedent Phase 4's own `clip.text` used (no font
// size/color picker, no position picker — burns with renderPlanner.js's own bottom-center default,
// see its Phase 13 entry): the only thing worth a UI here is the TEXT itself. Creating/deleting
// cues, and importing/exporting the whole track as .srt/.vtt, live in Timeline.jsx instead (track-
// level actions, not a single-cue editing concern).

import { useEffect, useState } from 'react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';

export default function CaptionPanel() {
  const projectState = useVideoStore((s) => s.projectState);
  const selectedIds = useVideoStore((s) => s.selectedIds);
  const execute = useVideoStore((s) => s.execute);

  // 08.2.1 §4: batch-editing caption TEXT across multiple cues isn't a meaningful feature (unlike
  // EffectsPanel's numeric fields) — multi-select here just falls back to the same "select 1" empty
  // state rather than a dedicated Mixed UI. VideoWorkspace.jsx already only mounts this panel when
  // every selected item is a caption cue.
  const target = selectedIds.length === 1 && projectState ? findClipLocation(projectState, selectedIds[0]) : null;

  // Hooks must run unconditionally (React's Rules of Hooks) — same early-return-must-come-AFTER-
  // hooks bug class EffectsPanel.jsx's own header comment already documents catching once.
  const [draft, setDraft] = useState(target?.clip.text?.content || '');
  useEffect(() => { setDraft(target?.clip.text?.content || ''); }, [target?.clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) {
    return (
      <div className="w-full h-full overflow-y-auto shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 text-xs text-[var(--n600,#4b5563)]">
        Chọn 1 cue phụ đề để chỉnh nội dung
      </div>
    );
  }

  const { track, clip } = target;
  const isLocked = !!track.locked;
  const isHidden = track.visible === false;
  const trackIndex = projectState.tracks.findIndex((t) => t.id === track.id);
  const clipIndex = track.clips.findIndex((c) => c.id === clip.id);

  const commitDraft = () => {
    const content = draft;
    if (content === (clip.text?.content || '')) return; // no real change — avoid a no-op command
    execute('SetProperty', {
      path: ['tracks', trackIndex, 'clips', clipIndex, 'text', 'content'],
      from: clip.text?.content || '',
      to: content,
    });
  };

  return (
    <div className="w-full h-full overflow-y-auto shrink-0 border-l border-[var(--card-border,#e5e7eb)] p-3 space-y-2 text-xs">
      {isLocked && (
        <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          Cue nằm trên track đang khoá — mở khoá track để chỉnh.
        </div>
      )}
      {isHidden && (
        <div className="text-[var(--n600,#4b5563)] bg-[var(--n100,#f3f4f6)] rounded-lg px-2 py-1">
          Track của cue này đang ẩn.
        </div>
      )}
      <div className="text-[var(--n600,#4b5563)]">
        {Math.round(clip.timelineInMs)}ms → {Math.round(clip.timelineOutMs)}ms
      </div>
      <label htmlFor="caption-content" className="block text-[var(--n600,#4b5563)]">Nội dung phụ đề</label>
      <textarea
        id="caption-content"
        value={draft}
        disabled={isLocked}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        rows={4}
        placeholder="Nhập nội dung phụ đề…"
        className="w-full rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 py-1 resize-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 disabled:opacity-40"
      />
    </div>
  );
}
