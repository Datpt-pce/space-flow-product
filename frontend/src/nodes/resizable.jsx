import { NodeResizer } from '@xyflow/react';

// Resize handles ở 4 cạnh + 4 góc — chỉ hiện khi node được chọn
export function ResizeControls({ selected, minW, minH, maxW, maxH }) {
  return (
    <NodeResizer
      isVisible={selected}
      minWidth={minW}
      minHeight={minH}
      maxWidth={maxW}
      maxHeight={maxH}
      lineStyle={{ borderColor: 'rgba(59,130,246,0.5)', borderWidth: 1, borderStyle: 'dashed' }}
      handleStyle={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: '#ffffff',
        border: '1.5px solid #3b82f6',
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
      }}
    />
  );
}

// Vị trí port theo % chiều cao vùng content — tự phân bố đều khi node được resize
export function portPct(index, total) {
  return `${((index + 1) / (total + 1)) * 100}%`;
}
