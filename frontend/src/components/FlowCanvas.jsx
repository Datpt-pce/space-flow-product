import { useCallback, useEffect, useMemo } from 'react';
import { ReactFlow, Background, addEdge, useReactFlow, useViewport } from '@xyflow/react';
import CustomEdge from './CustomEdge.jsx';
import '@xyflow/react/dist/style.css';
import { useStore } from '../store.js';
import { buildNodeTypes } from '../lib/nodeRegistry.jsx';
import { resolveDrop } from '../lib/api.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'any';
}

function ZoomControl() {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const pct = Math.round(zoom * 100);
  return (
    <div
      className="absolute flex items-center gap-1 bg-white border border-gray-200 rounded-xl shadow-sm px-1.5 py-1"
      style={{ bottom: 16, right: 16, zIndex: 10 }}
    >
      <button
        className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-sm font-medium transition-colors"
        onClick={() => zoomOut({ duration: 150 })}
        title="Zoom out"
      >−</button>
      <button
        className="min-w-[44px] px-1 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[11px] text-gray-600 font-medium transition-colors tabular-nums"
        onClick={() => zoomTo(1, { duration: 200 })}
        title="Reset to 100%"
      >{pct}%</button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-sm font-medium transition-colors"
        onClick={() => zoomIn({ duration: 150 })}
        title="Zoom in"
      >+</button>
    </div>
  );
}

export default function FlowCanvas() {
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const nodeManifests = useStore(s => s.nodeManifests);
  const interactionMode = useStore(s => s.interactionMode);
  const canvasSettings = useStore(s => s.canvasSettings);
  const setNodes = useStore(s => s.setNodes);
  const setEdges = useStore(s => s.setEdges);
  const storeAddEdge = useStore(s => s.addEdge);
  const addNodeToCanvas = useStore(s => s.addNodeToCanvas);
  const selectNode = useStore(s => s.selectNode);
  const closePalette = useStore(s => s.closePalette);
  const openPalette = useStore(s => s.openPalette);
  const copySelected = useStore(s => s.copySelected);
  const pasteClipboard = useStore(s => s.pasteClipboard);
  const deleteSelected = useStore(s => s.deleteSelected);
  const selectAll = useStore(s => s.selectAll);
  const cutSelected = useStore(s => s.cutSelected);
  const openContextMenu = useStore(s => s.openContextMenu);
  const closeContextMenu = useStore(s => s.closeContextMenu);
  const cleanupOrphanedFiles = useStore(s => s.cleanupOrphanedFiles);

  // Dọn file orphan khi app khởi động (xóa file từ session cũ không còn node nào dùng)
  useEffect(() => { cleanupOrphanedFiles(); }, []);

  const nodeTypes = useMemo(() => buildNodeTypes(Object.values(nodeManifests)), [nodeManifests]);
  const edgeTypes = useMemo(() => ({ custom: CustomEdge }), []);

  const onConnect = useCallback(
    (params) => storeAddEdge(addEdge(params, edges).slice(-1)[0]),
    [edges, storeAddEdge]
  );

  // Right-click on empty canvas opens palette; on nodes handled by onNodeContextMenu
  const onContextMenu = useCallback((e) => {
    if (e.target.closest('.react-flow__node')) return;
    e.preventDefault();
    closeContextMenu();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    openPalette(pos);
  }, [screenToFlowPosition, openPalette, closeContextMenu]);

  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault();
    openContextMenu({ type: 'node', targetId: node.id, x: e.clientX, y: e.clientY });
  }, [openContextMenu]);

  // Tab toggle palette; Ctrl+C copy; Ctrl+V paste; Ctrl+X cut; Ctrl+A select all; Delete/Backspace delete
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;

      if (e.key === 'Tab' && !isTyping) {
        e.preventDefault();
        const centerPos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        openPalette(centerPos);
        return;
      }

      if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !isTyping) {
        if (e.key === 'c') { e.preventDefault(); copySelected(); }
        else if (e.key === 'v') { e.preventDefault(); pasteClipboard(); }
        else if (e.key === 'x') { e.preventDefault(); cutSelected(); }
        else if (e.key === 'a') { e.preventDefault(); selectAll(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenToFlowPosition, openPalette, copySelected, pasteClipboard, deleteSelected, selectAll, cutSelected]);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();

    // Bỏ qua khi là drag-drop nội bộ MediaNode → ListNode
    if (e.dataTransfer.types.includes('space-flow-file')) return;

    // File drop from outside the browser window — resolve real path (no upload), create media nodes
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const dropPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const mediaManifest = nodeManifests['media'];
      if (!mediaManifest) return;

      const { paths } = await resolveDrop(files.map(f => f.name));
      if (!paths || !paths.length) {
        console.warn('[FlowCanvas] Không xác định được đường dẫn gốc của file vừa thả (cần cửa sổ Explorer đang mở và chọn đúng file). Hãy dùng nút Browse hoặc dán đường dẫn thủ công.');
        return;
      }

      const OFFSET = 20;
      paths.forEach((filePath, i) => {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop();
        addNodeToCanvas(
          mediaManifest,
          { x: dropPos.x + i * OFFSET, y: dropPos.y + i * OFFSET },
          { file_path: filePath, file_type: getFileType(fileName) }
        );
      });
      return;
    }

    // Node drag from palette
    const nodeId = e.dataTransfer.getData('application/space-flow-node');
    const manifest = nodeManifests[nodeId];
    if (!manifest) return;

    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNodeToCanvas(manifest, { x: pos.x - 110, y: pos.y - 60 });
  }, [nodeManifests, addNodeToCanvas, screenToFlowPosition]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const isPanMode = interactionMode === 'pan';
  const isSelectMode = interactionMode === 'select';

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={setNodes}
        onEdgesChange={setEdges}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onPaneClick={() => { selectNode(null); closePalette(); closeContextMenu(); }}
        onContextMenu={onContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        style={{ background: '#f5f5f5' }}
        defaultEdgeOptions={{ type: 'custom' }}
        deleteKeyCode={null}
        multiSelectionKeyCode="Control"
        nodesFocusable={false}
        panOnDrag={isPanMode || (!isSelectMode)}
        selectionOnDrag={isSelectMode}
        panOnScroll={false}
        zoomOnScroll={true}
        minZoom={0.05}
        maxZoom={2.0}
        snapToGrid={canvasSettings.snapToGrid}
        snapGrid={[canvasSettings.snapGrid, canvasSettings.snapGrid]}
      >
        {canvasSettings.backgroundVariant !== 'none' && (
          <Background color="#d1d5db" gap={24} size={1.5} variant={canvasSettings.backgroundVariant} />
        )}
      </ReactFlow>
      <ZoomControl />
    </div>
  );
}
