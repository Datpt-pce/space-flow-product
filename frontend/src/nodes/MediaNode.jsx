import { useState } from 'react';
import { Handle, Position, NodeToolbar, useViewport } from '@xyflow/react';
import { Play, Trash2, Copy, Settings2, Image, Video, Music, File, GripHorizontal } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';
import { previewUrl } from '../lib/api.js';
import { resolveDropPaths } from '../lib/dropResolve.js';

const MIN_W = 120, MAX_W = 480, MIN_H = 100, MAX_H = 480;

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
  if (type === 'image') return <Image size={size} className="text-[var(--n400,#9ca3af)]" />;
  if (type === 'video') return <Video size={size} className="text-[var(--n400,#9ca3af)]" />;
  if (type === 'audio') return <Music size={size} className="text-[var(--n400,#9ca3af)]" />;
  return <File size={size} className="text-[var(--n400,#9ca3af)]" />;
}

export default function MediaNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const filePath = config.file_path || '';

  const [aspectRatio, setAspectRatio] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

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
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const addNodeToCanvas = useStore(s => s.addNodeToCanvas);
  const nodeManifests = useStore(s => s.nodeManifests);

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

  // Thả file khác từ Windows Explorer đè lên node đã có sẵn → thay file_path bằng
  // path thật, không upload (xem frontend/src/lib/dropResolve.js).
  // Thả nhiều file cùng lúc → giữ nguyên node này, gộp tất cả vào 1 node List mới.
  const handleFileDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.types.includes('space-flow-file')) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const paths = await resolveDropPaths(e);
    if (!paths || !paths.length) return;

    if (paths.length === 1) {
      updateNodeConfig(id, 'file_path', paths[0]);
      updateNodeConfig(id, 'file_type', getMediaType(paths[0]));
      return;
    }

    const listManifest = nodeManifests['list'];
    if (!listManifest) return;
    const selfPos = nodes.find(n => n.id === id)?.position || { x: 0, y: 0 };
    // 'file' (fallback của getMediaType cho đuôi lạ) không nằm trong option file_type
    // của node List (image/video/audio/any) → quy về 'any', khớp getFileType() ở FlowCanvas.jsx
    const types = paths.map(p => { const t = getMediaType(p); return t === 'file' ? 'any' : t; });
    const file_type = types.every(t => t === types[0]) ? types[0] : 'any';
    addNodeToCanvas(listManifest, { x: selfPos.x + 40, y: selfPos.y + 40 }, { files: paths, file_type });
  };

  return (
    <div className="relative flex flex-col" style={{ width: NODE_W, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
            onClick={() => runWorkflow(id)}
          >
            <Play size={12} className="text-[var(--sub,#374151)]" />
          </button>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isDragOver
            ? 'ring-2 ring-blue-400 shadow-lg'
            : selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: NODE_W }}
        onDragOver={e => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleFileDrop}
      >
        {/* Preview area */}
        <div
          className="w-full rounded-2xl bg-[var(--n100,#f3f4f6)] overflow-hidden flex items-center justify-center relative group flex-1 min-h-0"
          style={{ flexBasis: PREVIEW_MIN_H }}
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
              className="nodrag absolute top-1.5 right-1.5 p-1 rounded-md bg-[var(--card,#fff)]/80 border border-[var(--card-border,#e5e7eb)] cursor-grab opacity-0 group-hover:opacity-100 transition-opacity z-10"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('space-flow-file', filePath);
                e.dataTransfer.effectAllowed = 'copy';
                const ghost = new Image();
                e.dataTransfer.setDragImage(ghost, 0, 0);
              }}
              title="Kéo để thêm vào List"
            >
              <GripHorizontal size={10} className="text-[var(--n500,#6b7280)]" />
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
          style={portStyle('file', 0, 1, 'right')}
        >
          {portGlyph('file')}
        </Handle>
      </div>
    </div>
  );
}
