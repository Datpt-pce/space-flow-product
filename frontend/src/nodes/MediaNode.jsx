import { useState } from 'react';
import { Handle, Position, NodeToolbar, useViewport } from '@xyflow/react';
import { Play, Trash2, Copy, Settings2, Image, Video, Music, File, GripHorizontal } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls, portPct } from './resizable.jsx';
import { previewUrl } from '../lib/api.js';

const MIN_W = 120, MAX_W = 480, MIN_H = 100, MAX_H = 480;

const PORT_COLORS = { file: '#94a3b8' };

function displayName(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  return name.replace(/^\d{13}-/, '');
}

function getMediaType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','avif','bmp','svg'].includes(ext)) return 'image';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext)) return 'audio';
  return 'file';
}

function MediaIcon({ type, size = 20 }) {
  if (type === 'image') return <Image size={size} className="text-gray-400" />;
  if (type === 'video') return <Video size={size} className="text-gray-400" />;
  if (type === 'audio') return <Music size={size} className="text-gray-400" />;
  return <File size={size} className="text-gray-400" />;
}

export default function MediaNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const filePath = config.file_path || '';

  const [aspectRatio, setAspectRatio] = useState(null);

  const { zoom } = useViewport();
  const isCompact = zoom < 0.4;

  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const nodeStatuses = useStore(s => s.nodeStatuses);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const nodeActive = useStore(s => s.nodeActive);
  const openPreview = useStore(s => s.openPreview);

  const status = nodeStatuses[id] || 'idle';
  const isActive = nodeActive[id] !== false;
  const mediaType = filePath ? getMediaType(filePath) : 'file';
  const url = filePath ? previewUrl(filePath) : '';
  const name = filePath ? displayName(filePath) : 'No file';

  const DEFAULT_W = 160;
  const NODE_W = width || DEFAULT_W;
  const PREVIEW_MIN_H = aspectRatio
    ? Math.max(80, Math.min(280, Math.round(NODE_W / aspectRatio)))
    : 140;

  const handleDelete = () => {
    deleteNode(id);
  };

  const handleDoubleClick = () => {
    if (filePath && openPreview) {
      openPreview({ url, type: mediaType, name });
    }
  };

  return (
    <div className="flex flex-col" style={{ width: NODE_W, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
            onClick={() => runWorkflow(id)}
          >
            <Play size={12} className="text-gray-700" />
          </button>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
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
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: NODE_W }}
      >
        {/* Preview area */}
        <div
          className="w-full rounded-2xl bg-gray-100 overflow-hidden flex items-center justify-center relative group flex-1 min-h-0"
          style={{ minHeight: PREVIEW_MIN_H }}
          onDoubleClick={handleDoubleClick}
        >
          {!filePath && (
            <MediaIcon type="file" size={28} />
          )}
          {filePath && mediaType === 'image' && (
            <img
              src={url}
              alt={name}
              className="w-full h-full object-cover"
              draggable={false}
              onLoad={e => {
                const { naturalWidth: w, naturalHeight: h } = e.target;
                if (w && h) setAspectRatio(w / h);
              }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          )}
          {filePath && mediaType === 'video' && (
            <video
              src={url}
              preload="metadata"
              muted
              draggable={false}
              className="w-full h-full object-cover"
              onLoadedMetadata={e => {
                const { videoWidth: w, videoHeight: h } = e.target;
                if (w && h) setAspectRatio(w / h);
              }}
            />
          )}
          {filePath && (mediaType === 'audio' || mediaType === 'file') && (
            <MediaIcon type={mediaType} size={28} />
          )}
          {filePath && (
            <div
              className="nodrag absolute top-1.5 right-1.5 p-1 rounded-md bg-white/80 border border-gray-200 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity z-10"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('space-flow-file', filePath);
                e.dataTransfer.effectAllowed = 'copy';
                const ghost = new Image();
                e.dataTransfer.setDragImage(ghost, 0, 0);
              }}
              title="Kéo để thêm vào List"
            >
              <GripHorizontal size={10} className="text-gray-500" />
            </div>
          )}
        </div>

        {/* Output port */}
        <Handle
          type="source"
          id="file"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="File"
          style={{
            background: PORT_COLORS.file,
            top: portPct(0, 1),
            right: -7,
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
