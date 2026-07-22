import { useEffect, useRef } from 'react';
import { Scissors, Clipboard, Trash2, Copy, Power, FolderOpen, Eye } from 'lucide-react';
import { useStore } from '../store.js';
import { openFolder, previewUrl } from '../lib/api.js';

function displayName(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  return name.replace(/^\d{13}-/, '');
}

function getMediaType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp','avif','bmp','svg'].includes(ext)) return 'image';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  return 'other';
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors rounded-lg ${
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
      onClick={onClick}
    >
      <Icon size={13} className="flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-gray-100 my-1 mx-1" />;
}

export default function ContextMenu() {
  const contextMenu = useStore(s => s.contextMenu);
  const closeContextMenu = useStore(s => s.closeContextMenu);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const nodeActive = useStore(s => s.nodeActive);
  const toggleNodeActive = useStore(s => s.toggleNodeActive);
  const duplicateNode = useStore(s => s.duplicateNode);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const pasteClipboard = useStore(s => s.pasteClipboard);
  const removeItemFromNode = useStore(s => s.removeItemFromNode);
  const copyItemFromNode = useStore(s => s.copyItemFromNode);
  const cutItemFromNode = useStore(s => s.cutItemFromNode);
  const pasteItemToNode = useStore(s => s.pasteItemToNode);
  const itemClipboard = useStore(s => s.itemClipboard);
  const clipboard = useStore(s => s.clipboard);
  const openPreview = useStore(s => s.openPreview);

  const menuRef = useRef(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeContextMenu();
    };
    const handleKey = (e) => { if (e.key === 'Escape') closeContextMenu(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  const { type, targetId, itemIndex, x, y } = contextMenu;

  // Keep menu within viewport
  const menuW = 180;
  const menuH = type === 'node' ? 160 : 220;
  const left = x + menuW > window.innerWidth ? x - menuW : x;
  const top = y + menuH > window.innerHeight ? y - menuH : y;

  const handleDeleteNode = () => {
    deleteNode(targetId);
    closeContextMenu();
  };

  const handleDuplicateNode = () => {
    duplicateNode(targetId);
    closeContextMenu();
  };

  const handleCutNode = () => {
    const node = nodes.find(n => n.id === targetId);
    if (!node) return;
    useStore.setState({ clipboard: { nodes: [node], edges: [] } });
    deleteNode(targetId);
    closeContextMenu();
  };

  const handleCopyNode = () => {
    const node = nodes.find(n => n.id === targetId);
    if (!node) return;
    useStore.setState({ clipboard: { nodes: [node], edges: [] } });
    closeContextMenu();
  };

  const handlePaste = () => {
    pasteClipboard();
    closeContextMenu();
  };

  const handleToggleActive = () => {
    toggleNodeActive(targetId);
    closeContextMenu();
  };

  const isNodeActive = nodeActive[targetId] !== false;

  const handlePreviewNode = () => {
    const node = nodes.find(n => n.id === targetId);
    if (!node) return;
    const filePath = node.data.config?.file_path;
    if (filePath && openPreview) {
      openPreview({
        url: previewUrl(filePath),
        type: getMediaType(filePath),
        name: displayName(filePath),
      });
    }
    closeContextMenu();
  };

  const targetNode = nodes.find(n => n.id === targetId);
  const isMediaNode = targetNode?.type === 'media' && !!targetNode?.data?.config?.file_path;

  const handleOpenFileLocation = () => {
    const node = nodes.find(n => n.id === targetId);
    if (!node) return;
    const files = node.data.config?.files || [];
    const filePath = files[itemIndex];
    if (filePath) openFolder(filePath).then(r => { if (r?.error) alert(r.error); }).catch(() => {});
    closeContextMenu();
  };

  const handlePreviewItem = () => {
    const node = nodes.find(n => n.id === targetId);
    if (!node) return;
    const files = node.data.config?.files || [];
    const filePath = files[itemIndex];
    if (filePath && openPreview) {
      openPreview({
        url: previewUrl(filePath),
        type: getMediaType(filePath),
        name: displayName(filePath),
      });
    }
    closeContextMenu();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 px-1"
      style={{ left, top, minWidth: menuW }}
      onContextMenu={e => e.preventDefault()}
    >
      {type === 'node' && (
        <>
          <MenuItem icon={Scissors} label="Cắt" onClick={handleCutNode} />
          <MenuItem icon={Copy} label="Sao chép" onClick={handleCopyNode} />
          {clipboard?.nodes?.length > 0 && (
            <MenuItem icon={Clipboard} label="Dán" onClick={handlePaste} />
          )}
          <Divider />
          <MenuItem icon={Copy} label="Nhân đôi" onClick={handleDuplicateNode} />
          <Divider />
          <MenuItem icon={Power} label={isNodeActive ? 'Deactivate Node' : 'Activate Node'} onClick={handleToggleActive} />
          {isMediaNode && (
            <>
              <Divider />
              <MenuItem icon={Eye} label="Xem trước" onClick={handlePreviewNode} />
            </>
          )}
          <Divider />
          <MenuItem icon={Trash2} label="Xoá" onClick={handleDeleteNode} danger />
        </>
      )}

      {type === 'item' && (
        <>
          <MenuItem icon={Scissors} label="Cắt" onClick={() => { cutItemFromNode(targetId, itemIndex); closeContextMenu(); }} />
          <MenuItem icon={Copy} label="Sao chép" onClick={() => { copyItemFromNode(targetId, itemIndex); closeContextMenu(); }} />
          {itemClipboard && (
            <MenuItem icon={Clipboard} label="Dán" onClick={() => { pasteItemToNode(targetId); closeContextMenu(); }} />
          )}
          <Divider />
          <MenuItem icon={FolderOpen} label="Mở thư mục chứa" onClick={handleOpenFileLocation} />
          <MenuItem icon={Eye} label="Xem trước" onClick={handlePreviewItem} />
          <Divider />
          <MenuItem icon={Trash2} label="Xoá" onClick={() => { removeItemFromNode(targetId, itemIndex); closeContextMenu(); }} danger />
        </>
      )}
    </div>
  );
}
