import { useState } from 'react';
import { getBezierPath, EdgeLabelRenderer } from '@xyflow/react';
import { X } from 'lucide-react';
import { useStore } from '../store.js';
import { PORT_TOKEN, resolvePortType, isPortTypeCompatible } from '../nodes/portStyle.jsx';

const WARNING_COLOR = '#f59e0b';

export default function CustomEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  selected,
}) {
  const [hovered, setHovered] = useState(false);
  const deleteEdge = useStore(s => s.deleteEdge);
  const nodes = useStore(s => s.nodes);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const sourceNode = nodes.find(n => n.id === source);
  const targetNode = nodes.find(n => n.id === target);
  const sourceType = resolvePortType(sourceNode, sourceHandleId, 'output');
  const targetType = resolvePortType(targetNode, targetHandleId, 'input');
  const mismatched = !isPortTypeCompatible(sourceType, targetType);

  const color = mismatched ? WARNING_COLOR : (PORT_TOKEN[sourceType] || PORT_TOKEN.any);
  const active = hovered || selected;

  return (
    <>
      <path
        d={edgePath}
        stroke={color}
        strokeWidth={active ? 1.5 : 1}
        strokeDasharray={mismatched ? '4 3' : undefined}
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
                background: 'var(--card, white)',
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
