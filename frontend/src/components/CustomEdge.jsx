import { useState } from 'react';
import { getBezierPath, EdgeLabelRenderer } from '@xyflow/react';
import { X } from 'lucide-react';
import { useStore } from '../store.js';

const PORT_COLORS = {
  text:    '#3b82f6',
  text_in: '#3b82f6',
  image:   '#a855f7',
  file:    '#94a3b8',
  files:   '#14b8a6',
  items:   '#14b8a6',
  array:   '#14b8a6',
  trigger: '#6366f1',
};

function getPortColor(handleId) {
  if (!handleId) return '#9ca3af';
  const key = Object.keys(PORT_COLORS).find(k => handleId.includes(k));
  return key ? PORT_COLORS[key] : '#9ca3af';
}

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  selected,
}) {
  const [hovered, setHovered] = useState(false);
  const deleteEdge = useStore(s => s.deleteEdge);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const color = getPortColor(sourceHandleId);
  const active = hovered || selected;

  return (
    <>
      <path
        d={edgePath}
        stroke={color}
        strokeWidth={active ? 1.5 : 1}
        fill="none"
        strokeOpacity={active ? 0.9 : 0.45}
      />
      {/* invisible wide hit area for hover */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={14}
        fill="none"
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={() => deleteEdge(id)}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'white',
                border: `1.5px solid ${color}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                padding: 0,
              }}
            >
              <X size={9} color={color} strokeWidth={2.5} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
