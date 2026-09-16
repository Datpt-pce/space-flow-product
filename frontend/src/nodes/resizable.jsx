import { NodeResizer, useNodeId } from '@xyflow/react';
import { useStore } from '../store.js';

// Resize handles ở 4 cạnh + 4 góc — chỉ hiện khi node được chọn (LTS) hoặc hover-hoặc-selected
// (Beta, caller tự truyền selected={selected||isHovered} — xem BaseNodeBeta.jsx). `accentColor`/
// `lineColor` mặc định giữ nguyên y hệt literal cũ khi không truyền — chỉ BaseNodeBeta đổi sang
// token accent.
export function ResizeControls({ selected, minW, minH, maxW, maxH, accentColor = '#3b82f6', lineColor = 'rgba(59,130,246,0.5)' }) {
  const id = useNodeId();
  const run = useStore(s => Object.values(s.activeRuns).find(run =>
    run.ownerId === s.currentUser?.id && run.nodeIds.includes(id)));
  const stopRuns = useStore(s => s.stopRuns);
  return (
    <>
    {run && <button aria-label="STOP tác vụ của node" title="Dừng tác vụ đang chứa node này"
      disabled={run.cancelRequested} onClick={() => stopRuns(id)}
      className="nodrag nopan absolute right-0 -bottom-7 z-20 rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60">
      {run.cancelRequested ? 'Đang dừng…' : 'STOP'}
    </button>}
    <NodeResizer
      isVisible={selected}
      minWidth={minW}
      minHeight={minH}
      maxWidth={maxW}
      maxHeight={maxH}
      lineStyle={{ borderColor: lineColor, borderWidth: 1, borderStyle: 'dashed' }}
      handleStyle={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: '#ffffff',
        border: `1.5px solid ${accentColor}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
      }}
    />
    </>
  );
}

// Vị trí port theo % chiều cao vùng content — tự phân bố đều khi node được resize
export function portPct(index, total) {
  return `${((index + 1) / (total + 1)) * 100}%`;
}
