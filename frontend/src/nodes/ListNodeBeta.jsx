import { useState, useEffect, useRef, Fragment } from 'react';
import { Handle, Position, NodeToolbar, useUpdateNodeInternals } from '@xyflow/react';
import {
  Play, Settings2, Trash2, Copy, ChevronDown, Plus, Check, X, Maximize2,
  LayoutList, LayoutGrid, GripVertical, Pencil, ExternalLink, FolderOpen, Download, Image as ImageIcon, Table2,
} from 'lucide-react';
import { useStore } from '../store.js';
import { openFolder, downloadZip, previewUrl } from '../lib/api.js';
import { fileIcon, displayName, isImage, isVideo } from '../lib/fileDisplay.js';
import { useFileDropTarget } from '../lib/useFileDropTarget.js';
import { useHoverGrace } from './useHoverGrace.js';
import { getNodeIcon } from '../lib/nodeIcons.jsx';
import { ResizeControls, portPct } from './resizable.jsx';
import { portGlyph, portStyle, PORT_GLYPH_OVERRIDES } from './portStyle.jsx';
import { getOrderedListItems, countListItemsByKind } from '../lib/listItems.js';
import { parsePaste } from '../lib/parsePaste.js';

// Glyph type theo NỘI DUNG thực tế của port (khác port.type khai trong node.json — cả 3 output
// của List đều khai "array" để tương thích wiring chung, nhưng cần phân biệt trực quan theo loại
// item đang chứa — xem docs/product/design-system.md + portStyle.jsx). Nguồn chuẩn duy nhất ở
// PORT_GLYPH_OVERRIDES.list (portStyle.jsx) — không định nghĩa lại ở đây.
const PORT_GLYPH_TYPE = PORT_GLYPH_OVERRIDES.list;

const DEFAULT_W = 240;
const MIN_W = 200, MAX_W = 560, MIN_H = 120, MAX_H = 640;

const STATUS_COLORS = {
  running: '#f59e0b',
  done: '#22c55e',
  error: '#ef4444',
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
      if (srcNode?.type === 'list') total += countListItemsByKind(srcNode.data?.config, e.sourceHandle);
    }
  }
  return total;
}

// Thanh icon quick-add khi hover port output — danh sách node tương thích lọc theo đúng port
// type thật (không hardcode tên node cụ thể nào, tự động theo mọi node.json hiện có/tương lai
// có input khớp `portType`). Trừ chính 'list' (thêm 1 node List khác vào List không có ý nghĩa).
function getQuickAddTargets(nodeManifests, portType) {
  return Object.values(nodeManifests)
    .filter(m => m.id !== 'list' && (m.inputs || []).some(p => p.type === portType))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function ListNodeBeta({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const items = getOrderedListItems(config);
  const itemMode = config.itemMode === 'replace' ? 'replace' : 'append';

  const [view, setView] = useState('list');
  const [runOpen, setRunOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [addingText, setAddingText] = useState(false);
  const [newText, setNewText] = useState('');
  const [newTextBig, setNewTextBig] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [editText, setEditText] = useState('');
  const [editCells, setEditCells] = useState([]);
  const [draggedToken, setDraggedToken] = useState(null);
  const [dragOverToken, setDragOverToken] = useState(null);
  const editInputRef = useRef(null);
  const [isHovered, hoverHandlers] = useHoverGrace();
  // 1 grace-hover cố định mỗi output port khả dĩ (files/text/rows) — số lượng hook cố định,
  // an toàn rules-of-hooks dù port nào đang thực sự hiển thị.
  const [filesPortHovered, filesPortHoverHandlers] = useHoverGrace();
  const [textPortHovered, textPortHoverHandlers] = useHoverGrace();
  const [rowsPortHovered, rowsPortHoverHandlers] = useHoverGrace();
  const updateNodeInternals = useUpdateNodeInternals();

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const nodeManifests = useStore(s => s.nodeManifests);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const openContextMenu = useStore(s => s.openContextMenu);
  const nodeActive = useStore(s => s.nodeActive);
  const pickFile = useStore(s => s.pickFile);
  const addTextItemToNode = useStore(s => s.addTextItemToNode);
  const addFileItemsToNode = useStore(s => s.addFileItemsToNode);
  const editTextItemInNode = useStore(s => s.editTextItemInNode);
  const addTableRowsToNode = useStore(s => s.addTableRowsToNode);
  const editTableCellInNode = useStore(s => s.editTableCellInNode);
  const reorderNodeItems = useStore(s => s.reorderNodeItems);
  const removeListItemBeta = useStore(s => s.removeListItemBeta);
  const setItemMode = useStore(s => s.setItemMode);
  const addNodeToCanvasConnected = useStore(s => s.addNodeToCanvasConnected);
  const listEditRequest = useStore(s => s.listEditRequest);
  const clearListEditRequest = useStore(s => s.clearListEditRequest);
  const openPreview = useStore(s => s.openPreview);

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const reachableCount = countReachable(nodes, edges, id);
  const isActive = nodeActive[id] !== false;
  const incomingCount = getIncomingCount(id, nodes, edges, nodeOutputs);
  const fileCount = items.filter(it => it.kind === 'file').length;
  const nodeW = width || DEFAULT_W;

  // Mutual exclusion: 1 node List chỉ chứa file (ảnh/video) HOẶC nội dung phi-file (text/bảng),
  // không trộn lẫn — item text/row coi là cùng nhóm "phi-file" vì cả 2 đều là dữ liệu văn bản.
  const hasFileItems = fileCount > 0;
  const hasNonFileItems = items.some(it => it.kind === 'text' || it.kind === 'row');
  const canAddFiles = !hasNonFileItems;
  const canAddNonFile = !hasFileItems;

  // Toolbar + resize-handles: hover HOẶC selected — đồng bộ với BaseNodeBeta.jsx (trước đó
  // ListNodeBeta chỉ hiện khi selected, lệch với node dùng chung; xem instruction.md mục "chưa
  // làm — cố tình hoãn"). Thanh quick-add ở mỗi output port dùng grace-hover riêng vì nó nổi hẳn
  // ra ngoài rìa card, không phải phần chrome trên đỉnh node.
  const chromeVisible = selected || isHovered;
  const self = nodes.find(n => n.id === id);
  const quickAddTargets = getQuickAddTargets(nodeManifests, 'array');

  // Output port động theo loại nội dung — 1 port chỉ ẩn khi vừa không còn item loại đó VỪA không
  // có dây nối vào nó, để không bao giờ đứt dây đang nối khi xoá hết item của loại đó.
  const edgeOnHandle = (handleId) => edges.some(e => e.source === id && e.sourceHandle === handleId);
  const outputPorts = [
    { id: 'files', label: 'Files', show: fileCount > 0 || edgeOnHandle('files'), hovered: filesPortHovered, hoverHandlers: filesPortHoverHandlers },
    { id: 'text', label: 'Text', show: items.some(it => it.kind === 'text') || edgeOnHandle('text'), hovered: textPortHovered, hoverHandlers: textPortHoverHandlers },
    { id: 'rows', label: 'Rows', show: items.some(it => it.kind === 'row') || edgeOnHandle('rows'), hovered: rowsPortHovered, hoverHandlers: rowsPortHoverHandlers },
  ].filter(p => p.show);
  const outputPortIds = outputPorts.map(p => p.id).join(',');

  // React Flow cache vị trí handle riêng — không tự phát hiện handle mới/mất khi component chỉ
  // re-render với số lượng <Handle> khác (vd. thêm item text đầu tiên khiến port Text mới xuất
  // hiện). Không gọi updateNodeInternals ở đây thì kéo dây vào/từ port vừa xuất hiện sẽ không ăn
  // (bug thật đã gặp) — xem comment tương tự ở BaseNodeBeta.jsx.
  useEffect(() => { updateNodeInternals(id); }, [outputPortIds, updateNodeInternals, id]);

  const gridCols = 3;
  const gridRows = Math.ceil(items.length / gridCols);
  const contentMinHeight = view === 'grid'
    ? Math.max(100, Math.min(280, gridRows * 56 + 48))
    : Math.max(120, Math.min(260, items.length * 28 + 52));

  // ContextMenu (overlay tách biệt) yêu cầu mở edit cho đúng row — tự clear sau khi xử lý.
  useEffect(() => {
    if (listEditRequest?.nodeId === id) {
      const item = items.find(it => it.token === listEditRequest.token);
      if (item?.kind === 'text') { setEditingToken(item.token); setEditText(item.text); }
      if (item?.kind === 'row') { setEditingToken(item.token); setEditCells([...item.cells]); }
      clearListEditRequest();
    }
  }, [listEditRequest, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editingToken) editInputRef.current?.focus(); }, [editingToken]);

  const { isDragOver, dropHandlers } = useFileDropTarget({
    onFilesAdded: (paths) => { if (canAddFiles) addFileItemsToNode(id, paths); },
  });

  const handleDelete = () => deleteNode(id);
  const handleOpenFolder = () => {
    const first = items.find(it => it.kind === 'file');
    if (first) openFolder(first.path).then(r => { if (r?.error) alert(r.error); }).catch(() => {});
  };
  const handleDownloadAll = () => {
    const paths = items.filter(it => it.kind === 'file').map(it => it.path);
    if (paths.length) downloadZip(paths).catch(() => {});
  };

  const confirmAddText = () => {
    if (newText.trim() && canAddNonFile) addTextItemToNode(id, newText.trim());
    setNewText(''); setAddingText(false); setNewTextBig(false);
  };
  const confirmEdit = () => {
    if (editingToken && editText.trim()) editTextItemInNode(id, editingToken.slice(5), editText.trim());
    setEditingToken(null); setEditText('');
  };
  const confirmRowEdit = () => {
    if (editingToken) {
      const rowId = editingToken.slice(4);
      editCells.forEach((val, i) => editTableCellInNode(id, rowId, i, val));
    }
    setEditingToken(null); setEditCells([]);
  };

  const handlePaste = (e) => {
    if (addingText || editingToken) return; // đang sửa field khác, để hành vi paste mặc định của input đó
    if (!canAddNonFile) return; // đã có file item — không cho thêm text/bảng
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault();
    const parsed = parsePaste(text);
    if (parsed.mode === 'table') {
      if (parsed.rows.length) addTableRowsToNode(id, parsed.headers, parsed.rows);
    } else {
      parsed.items.forEach(t => addTextItemToNode(id, t));
    }
  };

  const handleAddMedia = async () => {
    if (!canAddFiles) return;
    const path = await pickFile('media');
    if (path) addFileItemsToNode(id, [path]);
  };

  const handleQuickAdd = (targetManifest, sourceHandle) => {
    const pos = self ? { x: self.position.x + nodeW + 120, y: self.position.y } : { x: 0, y: 0 };
    addNodeToCanvasConnected(id, sourceHandle, 'array', targetManifest, pos);
  };

  const handleItemContextMenu = (e, item) => {
    e.preventDefault(); e.stopPropagation();
    openContextMenu({
      type: 'item', targetId: id, x: e.clientX, y: e.clientY,
      itemKind: item.kind, itemToken: item.token,
      itemIndex: item.kind === 'file' ? item.index : undefined,
    });
  };

  // stopPropagation trên dragover/drop: bắt buộc để dropHandlers của useFileDropTarget (bắt file
  // thả từ OS lên card) không chạy tiếp sau khi event bubble lên card cha — nếu không, 1 lần thả
  // item để sắp xếp cũng bị hiểu nhầm thành 1 lần thả file, gây tranh chấp state. Việc chặn
  // React-Flow tự kéo node khi grab đúng 1 row nằm ở class "nodrag" đặt trực tiếp trên row/card
  // (event.target.closest check của react-flow, không liên quan gì stopPropagation ở đây).
  const handleRowDragStart = (e, token) => { e.stopPropagation(); setDraggedToken(token); };
  const handleRowDragOver = (e, token) => { e.preventDefault(); e.stopPropagation(); setDragOverToken(token); };
  const handleRowDrop = (e, token) => {
    e.preventDefault(); e.stopPropagation();
    if (!draggedToken || draggedToken === token) { setDraggedToken(null); setDragOverToken(null); return; }
    const tokens = items.map(it => it.token);
    const from = tokens.indexOf(draggedToken);
    const to = tokens.indexOf(token);
    if (from === -1 || to === -1) return;
    tokens.splice(from, 1);
    tokens.splice(to, 0, draggedToken);
    reorderNodeItems(id, tokens);
    setDraggedToken(null); setDragOverToken(null);
  };
  const handleRowDragEnd = () => { setDraggedToken(null); setDragOverToken(null); };

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }} {...hoverHandlers}>
      <ResizeControls selected={chromeVisible} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={chromeVisible} position={Position.Top} align="start" offset={8}>
        <div
          className="flex items-center gap-0.5 rounded-2xl shadow-lg px-1.5 py-1.5"
          style={{ background: 'var(--card, #fff)', border: '1px solid var(--card-border, #e5e7eb)' }}
          {...hoverHandlers}
        >
          <div className="relative">
            <button className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-black/5 transition-colors" onClick={() => setRunOpen(o => !o)}>
              <Play size={12} style={{ color: 'var(--text, #374151)' }} />
              <ChevronDown size={9} style={{ color: 'var(--n400, #9ca3af)' }} />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 rounded-xl shadow-xl py-1 z-[9999] min-w-[180px]" style={{ background: 'var(--card,#fff)', border: '1px solid var(--card-border,#e5e7eb)' }}>
                <button className="w-full px-3 py-2 text-left hover:bg-black/5 flex items-center gap-2" onClick={() => { runWorkflow(id); setRunOpen(false); }}>
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text,#1f2937)' }}>✓ Run from here</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--n400,#9ca3af)' }}>~{reachableCount} nodes</span>
                </button>
                <button className="w-full px-3 py-2 text-left hover:bg-black/5 flex items-center gap-2" onClick={() => { runWorkflow(null); setRunOpen(false); }}>
                  <span className="text-[11px]" style={{ color: 'var(--sub,#4b5563)' }}>All workflow</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--n400,#9ca3af)' }}>~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4" style={{ background: 'var(--card-border,#e5e7eb)' }} />
          <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Duplicate node" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          {fileCount > 0 && (
            <>
              <div className="w-px h-4" style={{ background: 'var(--card-border,#e5e7eb)' }} />
              <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Mở thư mục chứa" onClick={handleOpenFolder}>
                <FolderOpen size={12} />
              </button>
              <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Tải toàn bộ (zip)" onClick={handleDownloadAll}>
                <Download size={12} />
              </button>
            </>
          )}
          <div className="w-px h-4" style={{ background: 'var(--card-border,#e5e7eb)' }} />
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] font-medium select-none truncate" style={{ color: 'var(--n400,#9ca3af)' }}>
        {manifest.name} <span style={{ color: 'var(--n300,#d1d5db)' }}>#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className="relative rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0"
        style={{
          width: nodeW,
          background: 'var(--card, #fff)',
          boxShadow: isRunning ? '0 0 0 2px #f59e0b, var(--shadow-md)' : selected ? '0 0 0 2px var(--accent,#7C5CFA), var(--shadow-md)' : 'var(--shadow-sm)',
          border: isRunning || selected ? 'none' : '1px solid var(--card-border, #e5e7eb)',
        }}
      >
        {STATUS_COLORS[status] && !isRunning && (
          <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10" style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }} />
        )}

        <div
          tabIndex={0}
          className="relative w-full rounded-2xl overflow-hidden outline-none flex flex-col flex-1 min-h-0 transition-colors"
          style={{ flexBasis: contentMinHeight, background: isDragOver ? 'color-mix(in srgb, var(--pt-array,#14b8a6) 12%, var(--n50,#f9fafb))' : 'var(--n50, #f9fafb)' }}
          onPaste={handlePaste}
          {...dropHandlers}
        >
          {/* nodrag đặt trên TỪNG nút, không đặt trên cả thanh — cùng lý do đã ghi ở STATE 3/5:
              nếu nodrag cả thanh, phần nền trống giữa các nút cũng bị khoá kéo-node theo. */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <span className="text-[10px]" style={{ color: 'var(--n400,#9ca3af)' }}>
              {items.length > 0 ? `${items.length} item${items.length > 1 ? 's' : ''}` : ''}
            </span>
            <div className="flex items-center gap-1">
              {/* "+" thêm item khi list đã có sẵn item (STATE 1 rỗng đã có nút riêng ở giữa card) —
                  ẩn theo đúng rule mutual-exclusion file/phi-file (canAddNonFile/canAddFiles). */}
              {items.length > 0 && !addingText && canAddNonFile && (
                <button className="nodrag p-1 rounded-md transition-colors hover:bg-black/5" style={{ color: 'var(--n400,#9ca3af)' }} onClick={() => { setView('list'); setAddingText(true); }} title="Add text">
                  <Plus size={11} />
                </button>
              )}
              {items.length > 0 && canAddFiles && (
                <button className="nodrag p-1 rounded-md transition-colors hover:bg-black/5" style={{ color: 'var(--n400,#9ca3af)' }} onClick={handleAddMedia} title="Add media">
                  <ImageIcon size={11} />
                </button>
              )}
              <div className="nodrag flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--card,#fff)', border: '1px solid var(--card-border,#e5e7eb)' }}>
                <button className="p-1 rounded-md transition-colors" style={view === 'list' ? { background: 'var(--n100,#f3f4f6)', color: 'var(--text,#374151)' } : { color: 'var(--n400,#9ca3af)' }} onClick={() => setView('list')} title="List view">
                  <LayoutList size={11} />
                </button>
                <button className="p-1 rounded-md transition-colors" style={view === 'grid' ? { background: 'var(--n100,#f3f4f6)', color: 'var(--text,#374151)' } : { color: 'var(--n400,#9ca3af)' }} onClick={() => setView('grid')} title="Grid view">
                  <LayoutGrid size={11} />
                </button>
              </div>
            </div>
          </div>

          {isDragOver && (
            <div className="absolute inset-0 rounded-t-2xl z-10 flex items-center justify-center pointer-events-none">
              {canAddFiles ? (
                <span className="text-[11px] font-medium px-3 py-1 rounded-full" style={{ color: 'var(--pt-array,#0d9488)', background: 'color-mix(in srgb, var(--pt-array,#14b8a6) 15%, transparent)', border: '1px solid var(--pt-array,#14b8a6)' }}>
                  Thả vào đây
                </span>
              ) : (
                <span className="text-[11px] font-medium px-3 py-1 rounded-full" style={{ color: '#b91c1c', background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444' }}>
                  Đã có text/bảng — không thể thêm ảnh/video
                </span>
              )}
            </div>
          )}

          {isRunning && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>Processing...</span>
            </div>
          )}

          {/* STATE 1 — empty */}
          {!isRunning && items.length === 0 && !addingText && (
            <div className="flex-1 flex flex-col items-center justify-center gap-1 px-4 text-center">
              <div className="mb-1" style={{ color: 'var(--n300,#d1d5db)' }}>
                <LayoutList size={22} />
              </div>
              <div className="text-[12px] font-semibold" style={{ color: 'var(--text,#374151)' }}>No elements yet</div>
              <div className="text-[10.5px] mb-2" style={{ color: 'var(--n400,#9ca3af)' }}>Add elements to this list</div>
              <div className="flex gap-1.5 nodrag">
                <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold" style={{ border: '1px solid var(--card-border,#e5e7eb)', background: 'var(--card,#fff)', color: 'var(--text,#374151)' }} onClick={() => { setView('list'); setAddingText(true); }}>
                  <Plus size={11} /> Add text
                </button>
                <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-semibold" style={{ border: '1px solid var(--card-border,#e5e7eb)', background: 'var(--card,#fff)', color: 'var(--text,#374151)' }} onClick={handleAddMedia}>
                  <ImageIcon size={11} /> Add media
                </button>
              </div>
            </div>
          )}

          {/* STATE 3/5 — item rows (list view, text/mixed/ảnh). `draggable` chỉ đặt trên icon
              GripVertical (tay cầm), KHÔNG đặt trên cả row — verify bằng Playwright thực tế: hễ
              row có draggable=true, browser luôn ưu tiên native drag cho MỌI điểm bấm trong row
              (kể cả background/text, không riêng gì icon), khiến React Flow không bao giờ có cơ
              hội tự kéo-di-chuyển node dù đã bỏ nodrag khỏi container — đúng bug user báo "có item
              là cứng đơ". Grip = kéo sắp xếp; phần còn lại của row (text/background) nhường lại
              cho việc kéo node. Row vẫn giữ onDragOver/onDrop để làm điểm THẢ (drop target) khi
              kéo từ 1 row khác tới. */}
          {!isRunning && view === 'list' && (items.length > 0 || addingText) && (
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {items.map(item => (
                <div
                  key={item.token}
                  onDragOver={(e) => handleRowDragOver(e, item.token)}
                  onDrop={(e) => handleRowDrop(e, item.token)}
                  onContextMenu={(e) => handleItemContextMenu(e, item)}
                  className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors group cursor-default"
                  style={{
                    background: dragOverToken === item.token ? 'color-mix(in srgb, var(--pt-array,#14b8a6) 10%, transparent)' : undefined,
                  }}
                  onMouseEnter={(e) => { if (dragOverToken !== item.token) e.currentTarget.style.background = 'var(--card, #fff)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = dragOverToken === item.token ? 'color-mix(in srgb, var(--pt-array,#14b8a6) 10%, transparent)' : 'transparent'; }}
                >
                  {editingToken === item.token && item.kind === 'row' ? (
                    <div className="flex-1 flex items-center gap-1 flex-wrap">
                      {editCells.map((cell, i) => (
                        <input
                          key={i}
                          ref={i === 0 ? editInputRef : undefined}
                          className="nodrag min-w-0 flex-1 text-[11px] bg-transparent outline-none border-b"
                          style={{ color: 'var(--text,#374151)', borderColor: 'var(--accent,#7C5CFA)' }}
                          value={cell}
                          placeholder={config.headers?.[i] || `Col${i + 1}`}
                          onChange={e => setEditCells(cs => cs.map((c, ci) => (ci === i ? e.target.value : c)))}
                          onKeyDown={e => { if (e.key === 'Enter') confirmRowEdit(); if (e.key === 'Escape') setEditingToken(null); }}
                          onBlur={e => { if (!e.currentTarget.parentElement.contains(e.relatedTarget)) confirmRowEdit(); }}
                        />
                      ))}
                    </div>
                  ) : editingToken === item.token ? (
                    <input
                      ref={editInputRef}
                      className="nodrag flex-1 text-[11px] bg-transparent outline-none border-b"
                      style={{ color: 'var(--text,#374151)', borderColor: 'var(--accent,#7C5CFA)' }}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingToken(null); }}
                      onBlur={confirmEdit}
                    />
                  ) : (
                    <>
                      {/* draggable đặt trên <span> bọc ngoài, KHÔNG đặt trực tiếp trên <svg> của
                          GripVertical — verify bằng Playwright: Chromium không coi 1 SVG gắn
                          draggable="true" là nguồn kéo HTML5 hợp lệ (draggable là thuộc tính HTML,
                          SVG không kế thừa hành vi này), dragstart không bao giờ bắn ra dù có set. */}
                      <span
                        draggable={editingToken !== item.token}
                        onDragStart={(e) => handleRowDragStart(e, item.token)}
                        onDragEnd={handleRowDragEnd}
                        className="nodrag flex-shrink-0 cursor-grab flex"
                      >
                        <GripVertical size={11} style={{ color: 'var(--n300,#d1d5db)' }} />
                      </span>
                      {item.kind === 'file' && (() => { const Icon = fileIcon(item.path); return <Icon size={12} className="flex-shrink-0" style={{ color: 'var(--n400,#9ca3af)' }} />; })()}
                      {item.kind === 'row' && <Table2 size={12} className="flex-shrink-0" style={{ color: 'var(--n400,#9ca3af)' }} />}
                      <span className="text-[11px] truncate flex-1" style={{ color: 'var(--sub,#4b5563)' }}>
                        {item.kind === 'file' ? displayName(item.path) : item.kind === 'row' ? item.cells.join(' | ') : item.text}
                      </span>
                      <span className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        {item.kind === 'text' && (
                          <button className="p-0.5 rounded" style={{ color: 'var(--n400,#9ca3af)' }} title="Edit" onClick={() => { setEditingToken(item.token); setEditText(item.text); }}>
                            <Pencil size={10} />
                          </button>
                        )}
                        {item.kind === 'row' && (
                          <button className="p-0.5 rounded" style={{ color: 'var(--n400,#9ca3af)' }} title="Edit" onClick={() => { setEditingToken(item.token); setEditCells([...item.cells]); }}>
                            <Pencil size={10} />
                          </button>
                        )}
                        {item.kind === 'file' && (
                          <button
                            className="p-0.5 rounded" style={{ color: 'var(--n400,#9ca3af)' }} title="Xem trước"
                            onClick={() => openPreview({ url: previewUrl(item.path), type: isImage(item.path) ? 'image' : isVideo(item.path) ? 'video' : 'other', name: displayName(item.path) })}
                          >
                            <ExternalLink size={10} />
                          </button>
                        )}
                        <button className="p-0.5 rounded hover:text-red-500" style={{ color: 'var(--n400,#9ca3af)' }} title="Xoá" onClick={() => removeListItemBeta(id, item.token)}>
                          <X size={10} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ))}

              {addingText && (
                <div className="nodrag rounded-xl p-2 mt-1" style={{ background: 'var(--n0,var(--card,#fff))', border: '1.5px solid var(--accent,#7C5CFA)' }}>
                  <textarea
                    autoFocus
                    className="w-full bg-transparent outline-none resize-none"
                    style={{ color: 'var(--text,#374151)', fontSize: newTextBig ? 13 : 11.5, minHeight: 44 }}
                    placeholder="Nhập text item..."
                    value={newText}
                    onChange={e => setNewText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAddText(); } if (e.key === 'Escape') { setAddingText(false); setNewText(''); } }}
                  />
                  <div className="flex items-center justify-between mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--card-border,#e5e7eb)' }}>
                    <div className="flex gap-0.5">
                      <button className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold hover:bg-black/5" style={{ color: 'var(--n500,#6b7280)' }} title="Font size" onClick={() => setNewTextBig(b => !b)}>Aa</button>
                      <button className="w-5 h-5 rounded flex items-center justify-center hover:bg-black/5" style={{ color: 'var(--n500,#6b7280)' }} title="Expand"><Maximize2 size={10} /></button>
                    </div>
                    <div className="flex gap-1">
                      <button className="w-5 h-5 rounded flex items-center justify-center hover:bg-black/5" style={{ color: 'var(--n500,#6b7280)' }} title="Cancel" onClick={() => { setAddingText(false); setNewText(''); }}><X size={11} /></button>
                      <button className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--n900,#111827)', color: 'var(--n0,#fff)' }} title="Confirm" onClick={confirmAddText}><Check size={11} /></button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STATE 4 — grid view (ảnh/video). Cùng lý do đã ghi ở STATE 3/5 (list view): card KHÔNG
              tự draggable/nodrag nữa — nguồn kéo sắp xếp chuyển vào riêng icon GripVertical góc
              trên-phải (bọc trong <span>, không đặt draggable trực tiếp lên <svg> — xem comment ở
              list view), phần thân card (thumbnail) nhường lại cho việc kéo di chuyển node. */}
          {!isRunning && view === 'grid' && items.length > 0 && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {items.map(item => (
                  <div
                    key={item.token}
                    onDragOver={(e) => handleRowDragOver(e, item.token)}
                    onDrop={(e) => handleRowDrop(e, item.token)}
                    onContextMenu={(e) => handleItemContextMenu(e, item)}
                    className="relative rounded-lg overflow-hidden group cursor-default"
                    style={{ aspectRatio: '1', background: 'var(--n150,#e5e7eb)' }}
                    title={item.kind === 'file' ? displayName(item.path) : item.kind === 'row' ? item.cells.join(' | ') : item.text}
                  >
                    {item.kind === 'file' && isImage(item.path) ? (
                      <img draggable={false} src={previewUrl(item.path)} alt={displayName(item.path)} className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none'; }} />
                    ) : item.kind === 'file' && isVideo(item.path) ? (
                      <video draggable={false} src={previewUrl(item.path)} preload="metadata" muted className="w-full h-full object-cover" />
                    ) : item.kind === 'file' ? (
                      <div className="w-full h-full flex items-center justify-center">{(() => { const Icon = fileIcon(item.path); return <Icon size={14} style={{ color: 'var(--n400,#9ca3af)' }} />; })()}</div>
                    ) : item.kind === 'row' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 p-1">
                        <Table2 size={12} style={{ color: 'var(--n400,#9ca3af)' }} />
                        <div className="text-[8px] text-center leading-tight" style={{ color: 'var(--n500,#6b7280)' }}>{item.cells.join(' | ').slice(0, 24)}</div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-1 text-[8px] text-center leading-tight" style={{ color: 'var(--n500,#6b7280)' }}>{item.text.slice(0, 24)}</div>
                    )}
                    <span
                      draggable
                      onDragStart={(e) => handleRowDragStart(e, item.token)}
                      onDragEnd={handleRowDragEnd}
                      className="nodrag hidden group-hover:flex absolute top-1 right-1 items-center justify-center rounded px-0.5 cursor-grab"
                      style={{ background: 'color-mix(in srgb, var(--card,#fff) 80%, transparent)' }}
                    >
                      <GripVertical size={9} style={{ color: 'var(--n500,#6b7280)' }} />
                    </span>
                  </div>
                ))}
                {canAddFiles && (
                  <button
                    className="flex items-center justify-center rounded-lg nodrag"
                    style={{ aspectRatio: '1', border: '1.5px dashed var(--n200,#e5e7eb)', color: 'var(--n400,#9ca3af)' }}
                    onClick={handleAddMedia}
                    title="Add media"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {!isRunning && items.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--card-border,#e5e7eb)' }}>
            <div className="relative">
              <button
                className="nodrag flex items-center gap-1 text-[10.5px] rounded-full px-2.5 py-1"
                style={{ color: 'var(--sub,#4b5563)', border: '1px solid var(--card-border,#e5e7eb)', background: 'var(--card,#fff)' }}
                onClick={() => setKeepOpen(o => !o)}
              >
                Keep Items <ChevronDown size={9} />
              </button>
              {keepOpen && (
                <div className="nodrag absolute left-0 bottom-full mb-1.5 rounded-xl shadow-xl py-1 z-[9999] min-w-[110px]" style={{ background: 'var(--card,#fff)', border: '1px solid var(--card-border,#e5e7eb)' }}>
                  {['append', 'replace'].map(m => (
                    <button
                      key={m}
                      className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-black/5"
                      style={{ color: itemMode === m ? 'var(--accent,#7C5CFA)' : 'var(--text,#374151)', fontWeight: itemMode === m ? 600 : 400 }}
                      onClick={() => { setItemMode(id, m); setKeepOpen(false); }}
                    >
                      {m === 'append' ? 'Keep' : 'Replace'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: 'var(--pt-array,#14b8a6)' }}>
              <Check size={11} />{items.length}
            </span>
          </div>
        )}

        {incomingCount > 0 && (
          <div className="absolute bottom-2 right-2 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1" style={{ background: 'var(--pt-array,#14b8a6)' }}>
            {incomingCount}
          </div>
        )}

        <Handle
          type="target" id="items" position={Position.Left} className="port-handle port-handle--input" data-label="Items"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>

        {/* Output port động theo loại nội dung (Files/Text/Rows) — 1 port chỉ ẩn khi vừa không
            còn item loại đó VỪA không có dây nối vào nó (outputPorts đã lọc theo rule này ở trên),
            để không bao giờ đứt dây đang nối khi xoá hết item của loại đó. Glyph/màu theo
            PORT_GLYPH_TYPE (không phải port.type khai trong node.json — cả 3 đều "array" để tương
            thích wiring, glyph chỉ để phân biệt trực quan nội dung thật). Mỗi port có rail
            quick-add riêng (thêm 1 node tương thích input type "array" + tự nối edge luôn, không
            cần user tự kéo dây — addNodeToCanvasConnected), grace-hover riêng vì rail nổi hẳn ra
            ngoài card, không thuộc phần chrome trên đỉnh node như toolbar. */}
        {outputPorts.map((port, i) => (
          <Fragment key={port.id}>
            <Handle
              type="source" id={port.id} position={Position.Right} className="port-handle port-handle--output" data-label={port.label}
              style={portStyle(PORT_GLYPH_TYPE[port.id], i, outputPorts.length, 'right')}
              {...port.hoverHandlers}
            >
              {portGlyph(PORT_GLYPH_TYPE[port.id])}
            </Handle>
            {port.hovered && quickAddTargets.length > 0 && (
              <div
                className="absolute flex items-center gap-1 rounded-full px-1.5 py-1 nodrag z-[9999]"
                style={{
                  top: portPct(i, outputPorts.length), right: -46, transform: 'translate(100%, -50%)',
                  background: 'var(--card,#fff)', border: '1px solid var(--card-border,#e5e7eb)', boxShadow: 'var(--shadow-md)',
                  maxWidth: 168, overflowX: 'auto',
                }}
                {...port.hoverHandlers}
              >
                {quickAddTargets.map(m => {
                  const QIcon = getNodeIcon(m.icon);
                  return (
                    <button
                      key={m.id}
                      className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
                      style={{ color: 'var(--sub,#6b7280)' }}
                      title={`Add ${m.name}`}
                      onClick={() => handleQuickAdd(m, port.id)}
                    >
                      <QIcon size={12} />
                    </button>
                  );
                })}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
