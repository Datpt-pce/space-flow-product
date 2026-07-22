import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Settings2, Trash2, Copy, ChevronDown } from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls, portPct } from './resizable.jsx';

const DEFAULT_W = 220;
const MIN_W = 180, MAX_W = 560, MIN_H = 100, MAX_H = 600;

function getIncomingCount(nodeId, nodes, edges, nodeOutputs) {
  const inEdges = edges.filter(e => e.target === nodeId);
  let total = 0;
  for (const e of inEdges) {
    const outputs = nodeOutputs[e.source];
    if (outputs && outputs[e.sourceHandle] !== undefined) {
      const val = outputs[e.sourceHandle];
      if (Array.isArray(val)) total += val.length;
      else if (val !== null && val !== undefined) total += 1;
    } else {
      const srcNode = nodes.find(n => n.id === e.source);
      if (srcNode?.type === 'list') {
        total += (srcNode.data?.config?.files || []).length;
      }
    }
  }
  return total;
}

const PORT_COLORS = {
  image:   '#a855f7',
  text:    '#3b82f6',
  number:  '#f97316',
  json:    '#22c55e',
  file:    '#94a3b8',
  array:   '#14b8a6',
  boolean: '#ef4444',
  trigger: '#6366f1',
};

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

function countReachable(nodes, edges, startId) {
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of (adj[id] || [])) queue.push(next);
  }
  return visited.size;
}

export default function BaseNode({ id, data, selected, width }) {
  const { manifest } = data;
  const [runOpen, setRunOpen] = useState(false);

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const nodeOutputs  = useStore(s => s.nodeOutputs);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const nodeActive = useStore(s => s.nodeActive);

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const incomingCount = getIncomingCount(id, nodes, edges, nodeOutputs);
  const inputs = manifest.inputs || [];
  const outputs = manifest.outputs || [];
  const reachableCount = countReachable(nodes, edges, id);
  const isActive = nodeActive[id] !== false;

  // Minimum content area height: tall enough to space out ports; grows via flex when resized
  const portRows = Math.max(inputs.length, outputs.length, 1);
  const defaultContentHeight = Math.max(80, portRows * 32 + 32);

  // Delete node from canvas
  const handleDelete = () => {
    deleteNode(id);
  };

  return (
    <div className="flex flex-col" style={{ width: width || DEFAULT_W, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      {/* Floating toolbar — shown when node is selected */}
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          {/* Run with dropdown */}
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
              onClick={() => setRunOpen(o => !o)}
            >
              <Play size={12} className="text-gray-700" />
              <ChevronDown size={9} className="text-gray-400" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-[9999] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(id); setRunOpen(false); }}
                >
                  <span className="text-[11px] font-medium text-gray-800">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{reachableCount} nodes</span>
                </button>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(null); setRunOpen(false); }}
                >
                  <span className="text-[11px] text-gray-600">All workflow</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-gray-200" />

          <button
            className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500"
            title="Configure node"
            onClick={() => selectNode(id)}
          >
            <Settings2 size={12} />
          </button>
          <button
            className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500"
            title="Duplicate node"
            onClick={() => duplicateNode(id)}
          >
            <Copy size={12} />
          </button>
          <button
            className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500"
            title="Delete"
            onClick={handleDelete}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      {/* Node label — above the card */}
      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate" style={{ maxWidth: '100%' }}>
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      {/* Main card */}
      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-blue-500 shadow-lg'
              : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: width || DEFAULT_W }}
      >
        {/* Status dot — top right corner */}
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{
              background: STATUS_COLORS[status],
              boxShadow: `0 0 6px ${STATUS_COLORS[status]}80`,
            }}
          />
        )}

        {/* Content / placeholder area */}
        <div
          className="w-full rounded-2xl bg-gray-50 flex flex-col items-center justify-center gap-1 overflow-hidden flex-1 min-h-0"
          style={{ minHeight: defaultContentHeight }}
        >
          {isRunning && (
            <span className="text-[11px] text-amber-500 font-medium">Processing...</span>
          )}
          {status === 'done' && (
            <span className="text-[11px] text-green-600 font-medium">Done</span>
          )}
          {status === 'error' && (
            <span className="text-[11px] text-red-500 font-medium">Error</span>
          )}
          {status === 'idle' && (
            <span className="text-[11px] text-gray-300 text-center px-6 leading-relaxed">
              {manifest.description}
            </span>
          )}
        </div>

        {incomingCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-teal-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1">
            {incomingCount}
          </div>
        )}

        {/* Input port handles — left edge */}
        {inputs.map((port, i) => (
          <Handle
            key={port.id}
            type="target"
            id={port.id}
            position={Position.Left}
            className="port-handle port-handle--input"
            data-label={port.label}
            style={{
              background: PORT_COLORS[port.type] || '#94a3b8',
              top: portPct(i, inputs.length),
              left: -7,
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              transform: 'translateY(-50%)',
            }}
          />
        ))}

        {/* Output port handles — right edge */}
        {outputs.map((port, i) => (
          <Handle
            key={port.id}
            type="source"
            id={port.id}
            position={Position.Right}
            className="port-handle port-handle--output"
            data-label={port.label}
            style={{
              background: PORT_COLORS[port.type] || '#94a3b8',
              top: portPct(i, outputs.length),
              right: -7,
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              transform: 'translateY(-50%)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
