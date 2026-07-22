import { useState, useRef, useCallback } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import {
  Play, Settings2, Trash2, Copy, ChevronDown,
  AlignLeft, Table2, Layers, X, LayoutList, LayoutGrid,
  Image, Video, Music, File, FolderOpen, Download,
} from 'lucide-react';
import { useStore } from '../store.js';
import { openFolder, downloadZip, resolveDrop, previewUrl } from '../lib/api.js';
import { ResizeControls, portPct } from './resizable.jsx';

const PORT_COLOR = '#14b8a6';
const TABLE_COL_MAX = 5;
const STATUS_COLORS = { running: '#f59e0b', done: '#22c55e', error: '#ef4444' };
const DEFAULT_W = 272;
const MIN_W = 220, MAX_W = 560, MIN_H = 120, MAX_H = 640;

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

function fileIcon(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','avif'].includes(ext)) return Image;
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return Video;
  if (['mp3','wav','aac','flac','ogg'].includes(ext)) return Music;
  return File;
}

function displayName(filePath) {
  return filePath.replace(/\\/g, '/').split('/').pop().replace(/^\d{13}-/, '');
}

function isImage(filePath) {
  return ['jpg','jpeg','png','gif','webp','avif'].includes(filePath.split('.').pop().toLowerCase());
}

function isVideo(filePath) {
  return ['mp4','mov','avi','mkv','webm'].includes(filePath.split('.').pop().toLowerCase());
}

// Phát hiện mode từ output type của source port
function detectModeFromSourceType(outType) {
  if (outType === 'text') return 'text';
  if (outType === 'array') return 'files';
  return null;
}

export default function ListAllNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config  = data.config || {};
  const files   = config.files   || [];
  const items   = config.items   || [];
  const headers = config.headers || [];
  const rows    = config.rows    || [];

  const [runOpen,    setRunOpen]    = useState(false);
  const [view,       setView]       = useState('list');
  const [isFocused,  setIsFocused]  = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const pasteZoneRef = useRef(null);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodeManifests    = useStore(s => s.nodeManifests);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const openContextMenu  = useStore(s => s.openContextMenu);
  const nodeActive       = useStore(s => s.nodeActive);

  const status         = nodeStatuses[id] || 'idle';
  const isRunning      = status === 'running';
  const isActive       = nodeActive[id] !== false;
  const reachableCount = countReachable(nodes, edges, id);

  // --- Auto-detect mode từ node được kết nối ---
  const incomingEdge = edges.find(e => e.target === id && e.targetHandle === 'items');
  const srcNode      = incomingEdge ? nodes.find(n => n.id === incomingEdge.source) : null;
  const srcManifest  = srcNode ? nodeManifests[srcNode.type] : null;
  const srcOutType   = srcManifest?.outputs?.find(o => o.id === incomingEdge?.sourceHandle)?.type;
  const autoMode     = detectModeFromSourceType(srcOutType);
  const isConnected  = !!incomingEdge;

  // Khi có kết nối: dùng auto-detect; khi không: dùng config do user chọn
  const effectiveMode = autoMode ?? config.mode ?? 'text';
  const isTextMode    = effectiveMode === 'text' || effectiveMode === 'table';

  const isEmpty = effectiveMode === 'files'
    ? files.length === 0
    : effectiveMode === 'table' ? rows.length === 0 : items.length === 0;

  const itemCount = effectiveMode === 'files'
    ? files.length
    : effectiveMode === 'table' ? rows.length : items.length;

  let contentMinHeight;
  if (effectiveMode === 'files') {
    const gridRows = Math.ceil(files.length / 4);
    contentMinHeight = view === 'grid'
      ? Math.max(100, Math.min(280, gridRows * 52 + 48))
      : Math.max(120, Math.min(220, files.length * 28 + 52));
  } else if (effectiveMode === 'table') {
    contentMinHeight = Math.max(120, Math.min(260, rows.length * 24 + 56));
  } else {
    contentMinHeight = Math.max(120, Math.min(240, items.length * 24 + 56));
  }
  const nodeW = width || DEFAULT_W;

  const handleDelete = () => { deleteNode(id); };

  const handlePaste = useCallback((e) => {
    if (effectiveMode === 'files') return;
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
  }, [id, effectiveMode, items, updateNodeConfig]);

  const handleClear = () => {
    if (effectiveMode === 'files') updateNodeConfig(id, 'files', []);
    else if (effectiveMode === 'text') updateNodeConfig(id, 'items', []);
    else { updateNodeConfig(id, 'headers', []); updateNodeConfig(id, 'rows', []); }
  };

  const handleDragOver = (e) => {
    const ok = e.dataTransfer.types.includes('space-flow-file') || e.dataTransfer.types.includes('Files');
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const filePath = e.dataTransfer.getData('space-flow-file');
    if (filePath) {
      updateNodeConfig(id, 'files', [...files, filePath]);
      if (!isConnected) updateNodeConfig(id, 'mode', 'files');
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      const osFiles = Array.from(e.dataTransfer.files);
      try {
        const { paths } = await resolveDrop(osFiles.map(f => f.name));
        if (paths && paths.length) {
          updateNodeConfig(id, 'files', [...files, ...paths]);
          if (!isConnected) updateNodeConfig(id, 'mode', 'files');
        }
      } catch {}
    }
  };

  const MODE_LABEL = { text: 'Text', table: 'Table', files: 'Files' };

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
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          {effectiveMode === 'files' && files.length > 0 && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Mở thư mục" onClick={() => openFolder(files[0]).then(r => { if (r?.error) alert(r.error); }).catch(() => {})}>
                <FolderOpen size={12} />
              </button>
              <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Tải toàn bộ (zip)" onClick={() => downloadZip(files).catch(() => {})}>
                <Download size={12} />
              </button>
            </>
          )}
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate" style={{ maxWidth: '100%' }}>
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected ? 'ring-2 ring-blue-500 shadow-lg'
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

        <div
          ref={pasteZoneRef}
          tabIndex={isTextMode ? 0 : -1}
          className={`relative w-full rounded-2xl overflow-hidden flex flex-col outline-none transition-colors flex-1 min-h-0 ${
            isDragOver ? 'bg-teal-50' : isFocused ? 'bg-blue-50' : 'bg-gray-50'
          }`}
          style={{ minHeight: contentMinHeight }}
          onFocus={() => isTextMode && setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onPointerDown={isTextMode ? e => e.stopPropagation() : undefined}
          onKeyDown={isTextMode ? e => e.stopPropagation() : undefined}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <span className="text-[10px] text-gray-400">
              {itemCount > 0
                ? `${itemCount} ${effectiveMode === 'files' ? 'file' : effectiveMode === 'table' ? 'hàng' : 'mục'}`
                : ''}
            </span>
            <div className="flex items-center gap-1 nodrag">
              {/* Khi có kết nối: hiện badge mode tự động */}
              {isConnected && (
                <span className="text-[9px] text-teal-500 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full select-none">
                  {MODE_LABEL[effectiveMode] ?? effectiveMode} ↙
                </span>
              )}
              {/* Khi không có kết nối: hiện mode toggle */}
              {!isConnected && (
                <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
                  <button
                    className={`p-1 rounded-md transition-colors ${config.mode === 'text' || !config.mode ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                    onClick={() => updateNodeConfig(id, 'mode', 'text')}
                    title="Text"
                  >
                    <AlignLeft size={11} />
                  </button>
                  <button
                    className={`p-1 rounded-md transition-colors ${config.mode === 'table' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                    onClick={() => updateNodeConfig(id, 'mode', 'table')}
                    title="Table"
                  >
                    <Table2 size={11} />
                  </button>
                  <button
                    className={`p-1 rounded-md transition-colors ${config.mode === 'files' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                    onClick={() => updateNodeConfig(id, 'mode', 'files')}
                    title="Files"
                  >
                    <Layers size={11} />
                  </button>
                </div>
              )}
              {/* View toggle list/grid chỉ hiện khi đang ở files mode */}
              {effectiveMode === 'files' && (
                <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
                  <button
                    className={`p-1 rounded-md transition-colors ${view === 'list' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                    onClick={() => setView('list')}
                    title="List view"
                  >
                    <LayoutList size={11} />
                  </button>
                  <button
                    className={`p-1 rounded-md transition-colors ${view === 'grid' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                    onClick={() => setView('grid')}
                    title="Grid view"
                  >
                    <LayoutGrid size={11} />
                  </button>
                </div>
              )}
              {!isEmpty && (
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

          {/* Running */}
          {isRunning && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[11px] text-amber-500 font-medium">Processing...</span>
            </div>
          )}

          {/* Drag-over overlay */}
          {isDragOver && !isRunning && (
            <div className="absolute inset-0 rounded-t-2xl z-10 flex items-center justify-center pointer-events-none">
              <span className="text-[11px] font-medium text-teal-600 bg-teal-50 px-3 py-1 rounded-full border border-teal-300">
                Thả vào đây
              </span>
            </div>
          )}

          {/* Empty — files */}
          {!isRunning && isEmpty && effectiveMode === 'files' && (
            <div className="flex-1 flex items-center justify-center px-4">
              <span className="text-[11px] text-gray-300 text-center leading-relaxed">
                {isConnected ? 'Run để xem kết quả' : 'Drop files or connect nodes'}
              </span>
            </div>
          )}

          {/* Empty — text/table */}
          {!isRunning && isEmpty && isTextMode && (
            <div
              className="flex-1 flex flex-col items-center justify-center px-4 gap-1 cursor-pointer"
              onClick={() => !isConnected && pasteZoneRef.current?.focus()}
            >
              {isConnected ? (
                <span className="text-[11px] text-gray-300 text-center">Run để xem kết quả</span>
              ) : isFocused ? (
                <span className="text-[11px] text-blue-400 font-medium animate-pulse">Nhấn Ctrl+V để paste</span>
              ) : (
                <>
                  <span className="text-[11px] text-gray-300 text-center">Click vào đây rồi Ctrl+V</span>
                  <span className="text-[10px] text-gray-300 text-center">Nhận diện bảng tự động</span>
                </>
              )}
            </div>
          )}

          {/* Files — list view */}
          {!isRunning && !isEmpty && effectiveMode === 'files' && view === 'list' && (
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {files.map((f, i) => {
                const Icon = fileIcon(f);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white transition-colors cursor-default"
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openContextMenu({ type: 'item', targetId: id, itemIndex: i, x: e.clientX, y: e.clientY }); }}
                  >
                    <Icon size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="text-[11px] text-gray-600 truncate">{displayName(f)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Files — grid view */}
          {!isRunning && !isEmpty && effectiveMode === 'files' && view === 'grid' && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, 48px)' }}>
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-md overflow-hidden bg-gray-200 relative cursor-default"
                    style={{ width: 48, height: 48 }}
                    title={displayName(f)}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openContextMenu({ type: 'item', targetId: id, itemIndex: i, x: e.clientX, y: e.clientY }); }}
                  >
                    {isImage(f) ? (
                      <img src={previewUrl(f)} alt={displayName(f)} className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
                    ) : isVideo(f) ? (
                      <video src={previewUrl(f)} preload="metadata" muted className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {(() => { const Icon = fileIcon(f); return <Icon size={14} className="text-gray-400" />; })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Text mode */}
          {!isRunning && !isEmpty && effectiveMode === 'text' && (
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-0.5 rounded-lg hover:bg-white transition-colors">
                  <span className="text-[9px] text-gray-300 font-mono w-4 text-right flex-shrink-0 mt-0.5 select-none">{i + 1}</span>
                  <span className="text-[11px] text-gray-700 leading-relaxed break-all">{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Table mode */}
          {!isRunning && !isEmpty && effectiveMode === 'table' && (
            <div className="flex-1 overflow-auto px-2 pb-2">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr>
                    {headers.slice(0, TABLE_COL_MAX).map((h, i) => (
                      <th key={i} className="text-left px-2 py-1 bg-white text-gray-500 font-semibold border-b border-gray-200 truncate" style={{ maxWidth: 72 }}>
                        {h || `Col${i + 1}`}
                      </th>
                    ))}
                    {headers.length > TABLE_COL_MAX && (
                      <th className="px-2 py-1 bg-white text-gray-300 font-normal text-center">+{headers.length - TABLE_COL_MAX}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-gray-100 hover:bg-white transition-colors">
                      {row.slice(0, TABLE_COL_MAX).map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-gray-600 truncate" style={{ maxWidth: 72 }}>{cell}</td>
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

          {/* Focus hint */}
          {isFocused && !isEmpty && isTextMode && (
            <div className="absolute bottom-1.5 right-2 text-[9px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded-full pointer-events-none">
              Ctrl+V thêm
            </div>
          )}
        </div>

        <Handle
          type="target"
          id="items"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Items"
          style={{
            background: PORT_COLOR,
            top: portPct(0, 1), left: -7,
            width: 14, height: 14,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            transform: 'translateY(-50%)',
          }}
        />

        <Handle
          type="source"
          id="items"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Items"
          style={{
            background: PORT_COLOR,
            top: portPct(0, 1), right: -7,
            width: 14, height: 14,
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
