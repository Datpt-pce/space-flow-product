import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import {
  Play, Settings2, Trash2, Copy, ChevronDown,
  LayoutList, LayoutGrid, Image, Video, Music, File,
  FolderOpen, Download,
} from 'lucide-react';
import { useStore } from '../store.js';
import { openFolder, downloadZip, resolveDrop, previewUrl } from '../lib/api.js';
import { ResizeControls, portPct } from './resizable.jsx';

const PORT_COLOR_ARRAY = '#14b8a6';
const DEFAULT_W = 240;
const MIN_W = 200, MAX_W = 560, MIN_H = 120, MAX_H = 640;

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

function fileIcon(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','avif'].includes(ext)) return Image;
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return Video;
  if (['mp3','wav','aac','flac','ogg'].includes(ext)) return Music;
  return File;
}

function displayName(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  return name.replace(/^\d{13}-/, '');
}

function isImage(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ['jpg','jpeg','png','gif','webp','avif'].includes(ext);
}

function isVideo(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ['mp4','mov','avi','mkv','webm'].includes(ext);
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
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of (adj[id] || [])) queue.push(next);
  }
  return visited.size;
}

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
      // Fallback: read source ListNode config directly
      const srcNode = nodes.find(n => n.id === e.source);
      if (srcNode?.type === 'list') {
        const files = srcNode.data?.config?.files || [];
        total += files.length;
      }
    }
  }
  return total;
}

export default function ListNode({ id, data, selected, width }) {
  const { manifest } = data;
  const files = (data.config && data.config.files) || [];
  const [view, setView] = useState('list');
  const [runOpen, setRunOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const nodeOutputs  = useStore(s => s.nodeOutputs);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const openContextMenu = useStore(s => s.openContextMenu);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive = useStore(s => s.nodeActive);

  const status = nodeStatuses[id] || 'idle';
  const reachableCount = countReachable(nodes, edges, id);
  const isActive = nodeActive[id] !== false;
  const incomingCount = getIncomingCount(id, nodes, edges, nodeOutputs);

  const gridCols = 4;
  const gridRows = Math.ceil(files.length / gridCols);
  const contentMinHeight = view === 'grid'
    ? Math.max(100, Math.min(280, gridRows * 52 + 48))
    : Math.max(120, Math.min(220, files.length * 28 + 52));
  const nodeW = width || DEFAULT_W;

  const handleDelete = () => {
    deleteNode(id);
  };

  const handleOpenFolder = () => {
    if (files.length > 0) openFolder(files[0]).then(r => { if (r?.error) alert(r.error); }).catch(() => {});
  };

  const handleDownloadAll = () => {
    if (files.length > 0) downloadZip(files).catch(() => {});
  };

  const isRunning = status === 'running';

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
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Duplicate node" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          {files.length > 0 && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Mở thư mục chứa" onClick={handleOpenFolder}>
                <FolderOpen size={12} />
              </button>
              <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Tải toàn bộ (zip)" onClick={handleDownloadAll}>
                <Download size={12} />
              </button>
            </>
          )}
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

        {/* Content area — nhận drop từ MediaNode */}
        <div
          className={`relative w-full rounded-2xl overflow-hidden flex flex-col transition-colors flex-1 min-h-0 ${isDragOver ? 'bg-teal-50' : 'bg-gray-50'}`}
          style={{ minHeight: contentMinHeight }}
          onDragOver={e => {
            const ok = e.dataTransfer.types.includes('space-flow-file') ||
                       e.dataTransfer.types.includes('Files');
            if (!ok) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={async e => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);

            // Internal drag từ MediaNode
            const filePath = e.dataTransfer.getData('space-flow-file');
            if (filePath) {
              updateNodeConfig(id, 'files', [...files, filePath]);
              return;
            }

            // OS file drop từ Windows Explorer — resolve path thật, không upload
            if (e.dataTransfer.files.length > 0) {
              const osFiles = Array.from(e.dataTransfer.files);
              try {
                const { paths } = await resolveDrop(osFiles.map(f => f.name));
                if (paths && paths.length) updateNodeConfig(id, 'files', [...files, ...paths]);
              } catch {}
            }
          }}
        >
          {/* View toggle + status row */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <span className="text-[10px] text-gray-400">
              {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
            </span>
            <div className="flex items-center gap-0.5 bg-white rounded-lg border border-gray-200 p-0.5 nodrag">
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
          </div>

          {/* Drag-over overlay */}
          {isDragOver && (
            <div className="absolute inset-0 rounded-t-2xl z-10 flex items-center justify-center pointer-events-none">
              <span className="text-[11px] font-medium text-teal-600 bg-teal-50 px-3 py-1 rounded-full border border-teal-300">
                Thả vào đây
              </span>
            </div>
          )}

          {/* Processing overlay */}
          {isRunning && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[11px] text-amber-500 font-medium">Processing...</span>
            </div>
          )}

          {/* File list / grid */}
          {!isRunning && files.length === 0 && (
            <div className="flex-1 flex items-center justify-center px-4">
              <span className="text-[11px] text-gray-300 text-center leading-relaxed">
                Drop files or connect nodes
              </span>
            </div>
          )}

          {!isRunning && files.length > 0 && view === 'list' && (
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {files.map((f, i) => {
                const Icon = fileIcon(f);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white transition-colors group cursor-default"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextMenu({ type: 'item', targetId: id, itemIndex: i, x: e.clientX, y: e.clientY }); }}
                  >
                    <Icon size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="text-[11px] text-gray-600 truncate">{displayName(f)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {!isRunning && files.length > 0 && view === 'grid' && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, 48px)' }}>
                {files.map((f, i) => {
                  return (
                    <div
                      key={i}
                      className="rounded-md overflow-hidden bg-gray-200 relative group cursor-default"
                      style={{ width: 48, height: 48 }}
                      title={displayName(f)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openContextMenu({ type: 'item', targetId: id, itemIndex: i, x: e.clientX, y: e.clientY }); }}
                    >
                      {isImage(f) ? (
                        <img
                          src={previewUrl(f)}
                          alt={displayName(f)}
                          className="w-full h-full object-cover"
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : isVideo(f) ? (
                        <video
                          src={previewUrl(f)}
                          preload="metadata"
                          muted
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {(() => { const Icon = fileIcon(f); return <Icon size={14} className="text-gray-400" />; })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {incomingCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-teal-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1">
            {incomingCount}
          </div>
        )}

        {/* Input handle — left edge */}
        <Handle
          type="target"
          id="items"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Items"
          style={{
            background: PORT_COLOR_ARRAY,
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

        {/* Output handle — right edge */}
        <Handle
          type="source"
          id="files"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Files"
          style={{
            background: PORT_COLOR_ARRAY,
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
