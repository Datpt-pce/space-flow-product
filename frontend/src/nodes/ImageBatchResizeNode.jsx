import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown } from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';
import { countListItemsByKind } from '../lib/listItems.js';

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
        total += countListItemsByKind(srcNode.data?.config, e.sourceHandle);
      }
    }
  }
  return total;
}

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const RATIOS = [
  { key: 'ratio_1_1',  label: '1:1'  },
  { key: 'ratio_9_16', label: '9:16' },
  { key: 'ratio_16_9', label: '16:9' },
  { key: 'ratio_4_5',  label: '4:5'  },
  { key: 'ratio_3_4',  label: '3:4'  },
  { key: 'ratio_4_3',  label: '4:3'  },
  { key: 'ratio_2_3',  label: '2:3'  },
  { key: 'ratio_3_2',  label: '3:2'  },
];

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

const DEFAULT_CONTENT_H = 230;
const DEFAULT_W = 280;
const MIN_W = 240, MAX_W = 560, MIN_H = 160, MAX_H = 600;

export default function ImageBatchResizeNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const [runOpen, setRunOpen] = useState(false);

  const nodeStatuses  = useStore(s => s.nodeStatuses);
  const nodeOutputs   = useStore(s => s.nodeOutputs);
  const nodes         = useStore(s => s.nodes);
  const edges         = useStore(s => s.edges);
  const runWorkflow   = useStore(s => s.runWorkflow);
  const deleteNode    = useStore(s => s.deleteNode);
  const selectNode    = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive    = useStore(s => s.nodeActive);

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const reachableCount = countReachable(nodes, edges, id);
  const isActive = nodeActive[id] !== false;
  const incomingCount = getIncomingCount(id, nodes, edges, nodeOutputs);

  const handleDelete = () => { deleteNode(id); };
  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      {/* Floating toolbar when selected */}
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
              onClick={() => setRunOpen(o => !o)}
            >
              <Play size={12} className="text-[var(--sub,#374151)]" />
              <ChevronDown size={9} className="text-[var(--n400,#9ca3af)]" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-[var(--card,#fff)] rounded-xl shadow-xl border border-[var(--card-border,#e5e7eb)] py-1 z-[9999] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(id); setRunOpen(false); }}
                >
                  <span className="text-[11px] font-medium text-[var(--n800,#1f2937)]">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{reachableCount} nodes</span>
                </button>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(null); setRunOpen(false); }}
                >
                  <span className="text-[11px] text-[var(--sub,#4b5563)]">All workflow</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Open config" onClick={() => selectNode(id)}>
            <Link2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Duplicate" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      {/* Node label above card */}
      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      {/* Main card */}
      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-blue-500 shadow-lg'
              : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {/* Status dot */}
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        {/* Inline settings content area */}
        <div className="relative w-full rounded-2xl bg-[var(--n50,#f9fafb)] px-3 pt-3 pb-2 overflow-y-auto flex-1 min-h-0" style={{ flexBasis: DEFAULT_CONTENT_H }}>

          {/* Format toggle */}
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] text-[var(--n400,#9ca3af)] w-12 flex-shrink-0">Format</span>
            <div className="flex gap-1 nodrag">
              {['png', 'jpg'].map(f => (
                <button
                  key={f}
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
                    cfg('output_format', 'png') === f
                      ? 'bg-violet-600 text-white'
                      : 'bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:border-[var(--n300,#d1d5db)]'
                  }`}
                  onClick={() => set('output_format', f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Manual resize */}
          <div className="mb-2">
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1.5">Manual Resize</div>
            <div className="flex items-center gap-1.5 nodrag">
              <span className="text-[10px] text-[var(--n400,#9ca3af)]">W</span>
              <input
                type="number" min="0"
                value={cfg('manual_width', 0) || ''}
                placeholder="0"
                className="w-16 h-6 px-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[11px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
                onChange={e => set('manual_width', parseInt(e.target.value) || 0)}
              />
              <span className="text-[10px] text-[var(--n300,#d1d5db)]">×</span>
              <span className="text-[10px] text-[var(--n400,#9ca3af)]">H</span>
              <input
                type="number" min="0"
                value={cfg('manual_height', 0) || ''}
                placeholder="0"
                className="w-16 h-6 px-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[11px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
                onChange={e => set('manual_height', parseInt(e.target.value) || 0)}
              />
              <span className="text-[10px] text-[var(--n300,#d1d5db)]">px</span>
            </div>
          </div>

          <div className="border-t border-[var(--card-border,#f3f4f6)] my-2" />

          {/* Smart crop */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide">Smart Crop</div>
              <div className="flex items-center gap-1 nodrag">
                <span className="text-[10px] text-[var(--n400,#9ca3af)]">Base</span>
                <input
                  type="number" min="64"
                  value={cfg('base_px', 1080)}
                  className="w-14 h-5 px-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
                  onChange={e => set('base_px', parseInt(e.target.value) || 1080)}
                />
                <span className="text-[10px] text-[var(--n300,#d1d5db)]">px</span>
              </div>
            </div>
            {/* 4×2 ratio grid */}
            <div className="grid grid-cols-4 gap-1 nodrag">
              {RATIOS.map(({ key, label }) => {
                const active = cfg(key, false);
                return (
                  <button
                    key={key}
                    className={`py-0.5 rounded-md text-[10px] font-medium transition-colors border ${
                      active
                        ? 'bg-violet-100 border-violet-300 text-violet-700'
                        : 'bg-[var(--card,#fff)] border-[var(--card-border,#e5e7eb)] text-[var(--n400,#9ca3af)] hover:border-[var(--n300,#d1d5db)] hover:text-[var(--sub,#4b5563)]'
                    }`}
                    onClick={() => set(key, !active)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status overlays */}
          {status === 'running' && (
            <div className="absolute inset-0 rounded-t-2xl flex items-center justify-center bg-[var(--card,#fff)]/80 z-20">
              <span className="text-[11px] text-amber-500 font-medium animate-pulse">Processing...</span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute top-2 inset-x-0 flex justify-center z-20">
              <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Error</span>
            </div>
          )}
          {status === 'done' && (
            <div className="absolute top-2 inset-x-0 flex justify-center z-20">
              <span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">Done</span>
            </div>
          )}
        </div>

        {incomingCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-teal-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1">
            {incomingCount}
          </div>
        )}

        {/* Input port: files_in (left) */}
        <Handle
          type="target"
          id="files_in"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Images"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>

        {/* Output port: files_out (right) */}
        <Handle
          type="source"
          id="files_out"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Images (resized)"
          style={portStyle('array', 0, 1, 'right')}
        >
          {portGlyph('array')}
        </Handle>
      </div>
    </div>
  );
}
