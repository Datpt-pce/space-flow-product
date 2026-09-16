import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown, GripVertical, Plus, X, AlertTriangle, Folder } from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';
import { countListItemsByKind } from '../lib/listItems.js';

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const DEFAULT_CONTENT_H = 300;
const DEFAULT_W = 280;
const MIN_W = 240, MAX_W = 560, MIN_H = 200, MAX_H = 640;

// Chỉ nhận nội dung text/table — node List có thể vừa chứa file vừa chứa text/table cùng lúc, nên
// gate theo cổng (sourceHandle) đang nối, không theo type id của node nguồn (khác hẳn hồi còn
// node List Content riêng, lúc đó type id là đủ vì List Content không bao giờ có file).
function isValidSourceEdge(src, edge) {
  if (!src) return false;
  if (src.data?.manifest?.id === 'text') return true;
  if (src.data?.manifest?.id === 'list') return edge.sourceHandle !== 'files';
  return false;
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
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const next of (adj[nodeId] || [])) queue.push(next);
  }
  return visited.size;
}


export default function BatchCreateFolderNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const [runOpen, setRunOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodeOutputs      = useStore(s => s.nodeOutputs);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive       = useStore(s => s.nodeActive);
  const pickFolder       = useStore(s => s.pickFolder);

  const status    = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive  = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);
  const outNames  = nodeOutputs[id]?.names;
  const outCount  = Array.isArray(outNames) ? outNames.length : 0;

  const handleDelete = () => { deleteNode(id); };
  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);
  const handleBrowseBasePath = async () => {
    const path = await pickFolder();
    if (path) set('base_path', path);
  };

  // Parse items_text thành mảng dòng
  const rawText = cfg('items_text', '');
  const lines = rawText ? rawText.split('\n') : [''];

  // Kiểm tra edge nào đang kết nối vào port items_in đủ điều kiện (theo sourceHandle, không phải
  // chỉ theo type id — xem isValidSourceEdge).
  const inputEdges = edges.filter(e => e.target === id && e.targetHandle === 'items_in');
  const edgeSourcePairs = inputEdges.map(e => ({ e, src: nodes.find(n => n.id === e.source) }));
  const hasValidInput   = edgeSourcePairs.some(({ e, src }) => isValidSourceEdge(src, e));
  const hasInvalidInput = edgeSourcePairs.some(({ e, src }) => src && !isValidSourceEdge(src, e));

  // Chỉ đếm items từ edge hợp lệ (Text, cổng Text/Rows của List)
  const validInCount = (() => {
    let total = 0;
    for (const { e, src } of edgeSourcePairs) {
      if (!isValidSourceEdge(src, e)) continue;
      const val = nodeOutputs[e.source]?.[e.sourceHandle];
      if (val !== undefined) {
        total += Array.isArray(val) ? val.length : 1;
      } else {
        const srcCfg = src.data?.config || {};
        if (src.data?.manifest?.id === 'list') {
          total += countListItemsByKind(srcCfg, e.sourceHandle);
        } else if (src.data?.manifest?.id === 'text') {
          if ((srcCfg.content || '').trim()) total += 1;
        }
      }
    }
    return total;
  })();

  // Thao tác dòng
  const updateLine = (idx, val) => {
    const next = [...lines]; next[idx] = val;
    set('items_text', next.join('\n'));
  };
  const deleteLine = (idx) => {
    const next = lines.filter((_, i) => i !== idx);
    set('items_text', next.length ? next.join('\n') : '');
  };
  const addLine = () => {
    set('items_text', rawText ? rawText + '\n' : '');
  };

  // Drag-and-drop handlers
  const onRowDragStart = (e, idx) => { e.stopPropagation(); setDragIdx(idx); };
  const onRowDragOver  = (e, idx) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); };
  const onRowDrop      = (e, idx) => {
    e.stopPropagation();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...lines];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    set('items_text', next.join('\n'));
    setDragIdx(null); setDragOverIdx(null);
  };
  const onRowDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Bottom} align="start" offset={8}>
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
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{reachable} nodes</span>
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

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

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
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        <div className="relative w-full rounded-2xl bg-[var(--n50,#f9fafb)] px-3 pt-3 pb-2 overflow-y-auto flex-1 min-h-0" style={{ flexBasis: DEFAULT_CONTENT_H }}>

          {/* SubID draggable list */}
          <div className="mb-2">
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1 flex items-center gap-1">
              SubID List
              {hasValidInput && <span className="text-teal-500 ml-1">+ {validInCount} từ port</span>}
              {hasInvalidInput && (
                <AlertTriangle size={9} className="text-amber-400 ml-1" title="Chỉ nhận từ node Text hoặc cổng Text/Rows của node List" />
              )}
            </div>

            {hasValidInput ? (
              <div className="w-full h-[88px] px-2 py-1.5 rounded-lg border border-teal-200 bg-teal-50 flex items-center justify-center">
                <span className="text-[10px] text-teal-600">Dữ liệu từ port ({validInCount} items)</span>
              </div>
            ) : (
              <>
                <div className="nodrag nopan w-full max-h-[130px] overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)]">
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={e => onRowDragStart(e, i)}
                      onDragOver={e => onRowDragOver(e, i)}
                      onDrop={e => onRowDrop(e, i)}
                      onDragEnd={onRowDragEnd}
                      className={`flex items-center gap-1 px-1 py-0.5 border-b border-[var(--card-border,#f3f4f6)] last:border-b-0 transition-colors ${
                        dragOverIdx === i && dragIdx !== i ? 'bg-teal-50 border-t-2 border-t-teal-400' : ''
                      } ${dragIdx === i ? 'opacity-40' : ''}`}
                    >
                      <GripVertical
                        size={10}
                        className="text-[var(--n300,#d1d5db)] cursor-grab flex-shrink-0 nodrag"
                        onMouseDown={e => e.stopPropagation()}
                      />
                      <input
                        type="text"
                        className="nodrag flex-1 min-w-0 bg-transparent text-[10px] text-[var(--sub,#374151)] focus:outline-none placeholder-[var(--n300,#d1d5db)] py-0.5"
                        placeholder={i === 0 ? 'SubID hoặc SubID\tVariant1' : ''}
                        value={line}
                        onChange={e => updateLine(i, e.target.value)}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = [...lines];
                            next.splice(i + 1, 0, '');
                            set('items_text', next.join('\n'));
                          }
                          if (e.key === 'Backspace' && line === '' && lines.length > 1) {
                            e.preventDefault();
                            deleteLine(i);
                          }
                        }}
                      />
                      {lines.length > 1 && (
                        <button
                          className="nodrag flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors"
                          onClick={() => deleteLine(i)}
                          onMouseDown={e => e.stopPropagation()}
                        >
                          <X size={9} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  className="nodrag mt-1 flex items-center gap-0.5 text-[9px] text-[var(--n400,#9ca3af)] hover:text-teal-500 transition-colors"
                  onClick={addLine}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <Plus size={9} /> Thêm dòng
                </button>
              </>
            )}
          </div>

          <div className="border-t border-[var(--card-border,#f3f4f6)] mb-2" />

          {/* Create folders toggle + base_path */}
          <div className="flex items-center gap-2 mb-1.5 nodrag">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="nodrag w-3.5 h-3.5 rounded accent-teal-500"
                checked={!!cfg('create_folders', false)}
                onChange={e => set('create_folders', e.target.checked)}
              />
              <span className="text-[10px] text-[var(--sub,#4b5563)] font-medium">Tạo thư mục</span>
            </label>
          </div>

          <div className={`transition-opacity ${cfg('create_folders', false) ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex items-center gap-1 mb-1.5">
              <input
                type="text"
                className="nodrag flex-1 min-w-0 h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-teal-400"
                placeholder="D:/Projects"
                value={cfg('base_path', '')}
                onChange={e => set('base_path', e.target.value)}
              />
              <button
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:border-teal-400 hover:text-teal-500 transition-colors nodrag"
                title="Chọn thư mục"
                onClick={handleBrowseBasePath}
              >
                <Folder size={11} />
              </button>
            </div>
            <input
              type="text"
              className="nodrag w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-teal-400"
              placeholder="Template: FL|SRC|RD/#1,#2,#3"
              value={cfg('template', '')}
              onChange={e => set('template', e.target.value)}
            />
          </div>

          {/* Status overlays */}
          {status === 'running' && (
            <div className="absolute inset-0 rounded-t-2xl flex items-center justify-center bg-[var(--card,#fff)]/80 z-20">
              <span className="text-[11px] text-amber-500 font-medium animate-pulse">Đang xử lý...</span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute top-2 inset-x-0 flex justify-center z-20">
              <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span>
            </div>
          )}
          {status === 'done' && outCount > 0 && (
            <div className="absolute top-2 inset-x-0 flex justify-center z-20">
              <span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                ✓ {outCount} tên
              </span>
            </div>
          )}
        </div>

        {validInCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-teal-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1">
            {validInCount}
          </div>
        )}

        {/* Input port: items_in */}
        <Handle
          type="target"
          id="items_in"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Items"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>

        {/* Output port: names */}
        <Handle
          type="source"
          id="names"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Names"
          style={portStyle('array', 0, 1, 'right')}
        >
          {portGlyph('array')}
        </Handle>
      </div>
    </div>
  );
}
