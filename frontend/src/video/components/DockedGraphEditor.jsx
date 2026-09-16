import { useState } from 'react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';
import { TRANSFORM_KEYS, isPropertyAnimated } from '@shared/video-keyframes';
import GraphEditorPanel from './GraphEditorPanel.jsx';

export default function DockedGraphEditor() {
  const doc = useVideoStore(s => s.projectState);
  const primaryId = useVideoStore(s => s.primaryId);
  const [error, setError] = useState(null);
  const found = findClipLocation(doc, primaryId);
  if (!found || !TRANSFORM_KEYS.some(key => isPropertyAnimated(found.clip, key))) {
    return <p className="p-3 text-xs text-[var(--n600)]">Chọn clip có keyframe chuyển động để chỉnh đường cong. Phím K thêm keyframe tại vị trí phát.</p>;
  }
  return <>
    {error && <p role="alert" className="p-3 text-xs text-[var(--status-error)]">{error}</p>}
    {found.track.locked && <p className="px-3 text-xs">Track đang khóa.</p>}
    <GraphEditorPanel key={found.clip.id} clip={found.clip} docked
      onClose={() => useVideoStore.getState().setGraphInspectorActive(false)}
      onDock={() => useVideoStore.getState().setGraphDocked(false)}
      onCommitTangents={(keyframeId, changes) => {
        try {
          if (found.track.locked) throw new Error('Mở khóa track trước khi chỉnh keyframe.');
          useVideoStore.getState().execute('SetKeyframeFields', { trackId: found.track.id, clipId: found.clip.id, keyframeId, changes });
          setError(null);
        } catch (err) { setError(err.message); }
      }} />
  </>;
}
