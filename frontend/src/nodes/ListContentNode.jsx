import { useState, useRef, useCallback } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Settings2, Trash2, Copy, ChevronDown, AlignLeft, Table2, X, GripVertical, Plus } from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls, portPct } from './resizable.jsx';

const PORT_COLOR = '#14b8a6';
const TABLE_COL_MAX = 5;
const DEFAULT_W = 272;
const MIN_W = 220, MAX_W = 560, MIN_H = 120, MAX_H = 640;

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

function parsePaste(text) {
  const lines = text.trimEnd().split('\n').map(l => l.trimEnd());
  const nonEmpty = lines.filter(l => l.length > 0);
  const hasTabs = nonEmpty.some(l => l.includes('\t'));

  if (hasTabs) {
    const allRows = nonEmpty.map(l => l.split('\t'));
    const [headerRow, ...dataRows] = allRows;
    return { mode: 'table', headers: headerRow, rows: dataRows };
  }

  return { mode: 'text', items: nonEmpty };
}

function countReachable(nodes, edges, startId) {
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of (adj[cur] || [])) queue.push(next);
  }
  return visited.size;
}

export default function ListContentNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const mode    = config.mode    || 'text';
  const items   = config.items   || [];
  const headers = config.headers || [];
  const rows    = config.rows    || [];

  const [runOpen,     setRunOpen]     = useState(false);
  const [isFocused,   setIsFocused]   = useState(false);
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const pasteZoneRef = useRef(null);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const nodeOutputs      = useStore(s => s.nodeOutputs);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive       = useStore(s => s.nodeActive);

  const status    = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive  = nodeActive[id] !== false;
  const reachableCount = countReachable(nodes, edges, id);

  // Items from connected input nodes (Text or other nodes)
  const inputEdges = edges.filter(e => e.target === id && e.targetHandle === 'items');
  const connectedItems = inputEdges.flatMap(e => {
    const src = nodes.find(n => n.id === e.source);
    if (!src) return [];
    const outputVal = nodeOutputs[e.source]?.[e.sourceHandle];
    if (outputVal !== undefined) {
      if (Array.isArray(outputVal)) return outputVal.map(v => String(v));
      if (typeof outputVal === 'string' && outputVal.trim())
        return outputVal.split('\n').map(l => l.trim()).filter(Boolean);
      return [];
    }
    // Fall back to config for Text node (before running)
    if (src.data?.manifest?.id === 'text') {
      const content = src.data?.config?.content || '';
      return content.trim() ? content.split('\n').map(l => l.trim()).filter(Boolean) : [];
    }
    return [];
  });

  const totalCount = mode === 'text' ? items.length + connectedItems.length : rows.length;
  const isEmpty    = totalCount === 0;

  const contentMinHeight = mode === 'table'
    ? Math.max(120, Math.min(260, rows.length * 24 + 56))
    : Math.max(120, Math.min(260, totalCount * 24 + 80));
  const nodeW = width || DEFAULT_W;

  const handleDelete = () => {
    deleteNode(id);
  };

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;

    const parsed = parsePaste(text);
    if (parsed.mode === 'table') {
      updateNodeConfig(id, 'mode',    'table');
      updateNodeConfig(id, 'headers', parsed.headers);
      updateNodeConfig(id, 'rows',    parsed.rows);
      updateNodeConfig(id, 'items',   []);
    } else {
      updateNodeConfig(id, 'mode',    'text');
      updateNodeConfig(id, 'items',   [...items, ...parsed.items]);
      updateNodeConfig(id, 'headers', []);
      updateNodeConfig(id, 'rows',    []);
    }
  }, [id, items, updateNodeConfig]);

  const handleClear = () => {
    updateNodeConfig(id, 'mode',    'text');
    updateNodeConfig(id, 'items',   []);
    updateNodeConfig(id, 'headers', []);
    updateNodeConfig(id, 'rows',    []);
  };

  // Item editing handlers
  const addItem = () => updateNodeConfig(id, 'items', [...items, '']);
  const updateItem = (idx, val) => {
    const next = [...items]; next[idx] = val;
    updateNodeConfig(id, 'items', next);
  };
  const deleteItem = (idx) => updateNodeConfig(id, 'items', items.filter((_, i) => i !== idx));

  // Drag-and-drop handlers
  const onRowDragStart = (e, idx) => { e.stopPropagation(); setDragIdx(idx); };
  const onRowDragOver  = (e, idx) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); };
  const onRowDrop      = (e, idx) => {
    e.stopPropagation();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    updateNodeConfig(id, 'items', next);
    setDragIdx(null); setDragOverIdx(null);
  };
  const onRowDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  return (
    <div className="flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
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
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Configure" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Duplicate" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate" style={{ maxWidth: '100%' }}>
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-blue-500 shadow-lg'
              : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && !isRunning && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        {/* Paste zone — focusable div nhận Ctrl+V */}
        <div
          ref={pasteZoneRef}
          tabIndex={0}
          className={`relative w-full rounded-2xl overflow-hidden flex flex-col outline-none transition-colors flex-1 min-h-0 ${
            isFocused ? 'bg-blue-50' : 'bg-gray-50'
          }`}
          style={{ minHeight: contentMinHeight }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
        >
          {/* Header: count + add button + mode toggle + clear */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">
                {totalCount > 0 ? `${totalCount} ${mode === 'table' ? 'hàng' : 'mục'}` : ''}
              </span>
              {mode === 'text' && (
                <button
                  className="nodrag p-0.5 rounded hover:bg-teal-50 text-gray-400 hover:text-teal-500 transition-colors"
                  onClick={addItem}
                  onMouseDown={e => e.stopPropagation()}
                  title="Thêm item"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 nodrag">
              <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
                <button
                  className={`p-1 rounded-md transition-colors ${mode === 'text' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                  onClick={() => updateNodeConfig(id, 'mode', 'text')}
                  title="Text mode"
                >
                  <AlignLeft size={11} />
                </button>
                <button
                  className={`p-1 rounded-md transition-colors ${mode === 'table' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                  onClick={() => updateNodeConfig(id, 'mode', 'table')}
                  title="Table mode"
                >
                  <Table2 size={11} />
                </button>
              </div>
              {items.length > 0 && (
                <button
                  className="p-1 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors"
                  onClick={handleClear}
                  title="Xóa tất cả"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Running state */}
          {isRunning && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[11px] text-amber-500 font-medium">Processing...</span>
            </div>
          )}

          {/* Text mode */}
          {!isRunning && mode === 'text' && (
            <div className="flex-1 overflow-y-auto nodrag nopan pb-1">
              {isEmpty ? (
                <div
                  className="flex flex-col items-center justify-center h-full px-4 gap-1 cursor-pointer"
                  onClick={() => pasteZoneRef.current?.focus()}
                >
                  {isFocused ? (
                    <span className="text-[11px] text-blue-400 font-medium animate-pulse">Nhấn Ctrl+V để paste</span>
                  ) : (
                    <>
                      <span className="text-[11px] text-gray-300 text-center">Nhấn + hoặc Ctrl+V</span>
                      <span className="text-[10px] text-gray-300 text-center">Nhận diện bảng tự động</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="px-2 space-y-0.5">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={e => onRowDragStart(e, i)}
                      onDragOver={e => onRowDragOver(e, i)}
                      onDrop={e => onRowDrop(e, i)}
                      onDragEnd={onRowDragEnd}
                      className={`flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white border-b border-gray-100 last:border-b-0 transition-colors ${
                        dragOverIdx === i && dragIdx !== i ? 'border-t-2 border-t-teal-400 bg-teal-50' : ''
                      } ${dragIdx === i ? 'opacity-40' : ''}`}
                    >
                      <span className="text-[9px] text-gray-300 w-4 text-right flex-shrink-0 select-none">{i + 1}</span>
                      <GripVertical
                        size={10}
                        className="text-gray-300 cursor-grab flex-shrink-0 nodrag"
                        onMouseDown={e => e.stopPropagation()}
                      />
                      <input
                        type="text"
                        className="nodrag flex-1 min-w-0 bg-transparent text-[11px] text-gray-700 focus:outline-none placeholder-gray-300 py-0.5"
                        value={item}
                        onChange={e => updateItem(i, e.target.value)}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = [...items];
                            next.splice(i + 1, 0, '');
                            updateNodeConfig(id, 'items', next);
                          }
                          if (e.key === 'Backspace' && item === '' && items.length > 1) {
                            e.preventDefault();
                            deleteItem(i);
                          }
                        }}
                      />
                      <button
                        className="nodrag flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                        onClick={() => deleteItem(i)}
                        onMouseDown={e => e.stopPropagation()}
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}

                  {/* Items from connected nodes (read-only) */}
                  {connectedItems.length > 0 && (
                    <>
                      {items.length > 0 && <div className="border-t border-teal-100 my-1" />}
                      {connectedItems.map((item, i) => (
                        <div key={`c-${i}`} className="flex items-center gap-2 px-2 py-0.5 rounded">
                          <span className="text-[9px] text-teal-300 w-4 text-right flex-shrink-0 select-none">{items.length + i + 1}</span>
                          <span className="text-[11px] text-teal-600 break-all leading-relaxed">{item}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Table mode - empty */}
          {!isRunning && mode === 'table' && rows.length === 0 && (
            <div
              className="flex-1 flex flex-col items-center justify-center px-4 gap-1 cursor-pointer"
              onClick={() => pasteZoneRef.current?.focus()}
            >
              {isFocused ? (
                <span className="text-[11px] text-blue-400 font-medium animate-pulse">Nhấn Ctrl+V để paste</span>
              ) : (
                <>
                  <span className="text-[11px] text-gray-300 text-center">Click vào đây rồi Ctrl+V</span>
                  <span className="text-[10px] text-gray-300 text-center">Nhận diện bảng tự động</span>
                </>
              )}
            </div>
          )}

          {/* Table mode - with data */}
          {!isRunning && mode === 'table' && rows.length > 0 && (
            <div className="flex-1 overflow-auto px-2 pb-2">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr>
                    {headers.slice(0, TABLE_COL_MAX).map((h, i) => (
                      <th
                        key={i}
                        className="text-left px-2 py-1 bg-white text-gray-500 font-semibold border-b border-gray-200 truncate"
                        style={{ maxWidth: 72 }}
                      >
                        {h || `Col${i + 1}`}
                      </th>
                    ))}
                    {headers.length > TABLE_COL_MAX && (
                      <th className="px-2 py-1 bg-white text-gray-300 font-normal text-center">
                        +{headers.length - TABLE_COL_MAX}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-gray-100 hover:bg-white transition-colors">
                      {row.slice(0, TABLE_COL_MAX).map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-gray-600 truncate" style={{ maxWidth: 72 }}>
                          {cell}
                        </td>
                      ))}
                      {row.length > TABLE_COL_MAX && (
                        <td className="px-2 py-1 text-gray-300 text-center">…</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Focused hint khi có nội dung */}
          {isFocused && !isEmpty && (
            <div className="absolute bottom-1.5 right-2 text-[9px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded-full pointer-events-none">
              Ctrl+V thêm
            </div>
          )}
        </div>

        {/* Input handle */}
        <Handle
          type="target"
          id="items"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Items"
          style={{
            background: PORT_COLOR,
            top: portPct(0, 1),
            left: -7,
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            transform: 'translateY(-50%)',
          }}
        />

        {/* Output handle */}
        <Handle
          type="source"
          id="rows"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Rows"
          style={{
            background: PORT_COLOR,
            top: portPct(0, 1),
            right: -7,
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            transform: 'translateY(-50%)',
          }}
        />
      </div>
    </div>
  );
}
