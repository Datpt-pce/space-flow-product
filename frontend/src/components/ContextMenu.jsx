import { useEffect, useRef } from 'react';
import { Scissors, Clipboard, Trash2, Copy, Power, FolderOpen, Eye, ShieldAlert, RotateCw, Pin, PinOff, SkipForward, Pencil } from 'lucide-react';
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

function MenuItem({ icon: Icon, label, onClick, danger, disabled }) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors rounded-lg ${
        disabled
          ? 'text-[var(--n300,#d1d5db)] cursor-not-allowed'
          : danger
            ? 'text-red-500 hover:bg-red-50'
            : 'text-[var(--sub,#374151)] hover:bg-[var(--n100,#f3f4f6)]'
      }`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <Icon size={13} className="flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-[var(--n100,#f3f4f6)] my-1 mx-1" />;
}

export default function ContextMenu() {
  const contextMenu = useStore(s => s.contextMenu);
  const closeContextMenu = useStore(s => s.closeContextMenu);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const nodeActive = useStore(s => s.nodeActive);
  const toggleNodeActive = useStore(s => s.toggleNodeActive);
  const nodeContinueOnFail = useStore(s => s.nodeContinueOnFail);
  const toggleContinueOnFail = useStore(s => s.toggleContinueOnFail);
  const nodeRetryOnFail = useStore(s => s.nodeRetryOnFail);
  const toggleRetryOnFail = useStore(s => s.toggleRetryOnFail);
  const continueWorkflow = useStore(s => s.continueWorkflow);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const nodePinnedData = useStore(s => s.nodePinnedData);
  const pinNodeOutput = useStore(s => s.pinNodeOutput);
  const unpinNodeOutput = useStore(s => s.unpinNodeOutput);
  const duplicateNode = useStore(s => s.duplicateNode);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const pasteClipboard = useStore(s => s.pasteClipboard);
  const removeItemFromNode = useStore(s => s.removeItemFromNode);
  const copyItemFromNode = useStore(s => s.copyItemFromNode);
  const cutItemFromNode = useStore(s => s.cutItemFromNode);
  const pasteItemToNode = useStore(s => s.pasteItemToNode);
  const itemClipboard = useStore(s => s.itemClipboard);
  const requestEditListItem = useStore(s => s.requestEditListItem);
  const removeListItemBeta = useStore(s => s.removeListItemBeta);
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

  const { type, targetId, itemIndex, itemKind, itemToken, x, y } = contextMenu;

  // Keep menu within viewport
  const menuW = 180;
  const menuH = type === 'node' ? 216 : 220;
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
  const isContinueOnFail = nodeContinueOnFail[targetId] === true;
  const isRetryOnFail = nodeRetryOnFail[targetId] === true;
  const isPinned = !!nodePinnedData[targetId];
  const hasOutputToPin = !!nodeOutputs[targetId];

  const handleTogglePin = () => {
    if (isPinned) unpinNodeOutput(targetId);
    else if (hasOutputToPin) pinNodeOutput(targetId);
    closeContextMenu();
  };

  const handleToggleContinueOnFail = () => {
    toggleContinueOnFail(targetId);
    closeContextMenu();
  };

  const handleToggleRetryOnFail = () => {
    toggleRetryOnFail(targetId);
    closeContextMenu();
  };

  const handleContinue = () => {
    continueWorkflow(targetId);
    closeContextMenu();
  };

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
      className="fixed z-[9999] bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-xl py-1.5 px-1"
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
          <MenuItem
            icon={ShieldAlert}
            label={isContinueOnFail ? 'Continue On Fail: On' : 'Continue On Fail: Off'}
            onClick={handleToggleContinueOnFail}
          />
          <MenuItem
            icon={RotateCw}
            label={isRetryOnFail ? 'Retry On Fail: On' : 'Retry On Fail: Off'}
            onClick={handleToggleRetryOnFail}
          />
          <MenuItem
            icon={isPinned ? PinOff : Pin}
            label={isPinned ? 'Unpin Output' : 'Pin Output'}
            onClick={handleTogglePin}
            disabled={!isPinned && !hasOutputToPin}
          />
          <MenuItem icon={SkipForward} label="Continue (resume from checkpoint)" onClick={handleContinue} />
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

      {type === 'item' && itemKind === 'text' && (
        // Row của ListNodeBeta — item text (config.textItems), xoá theo token, không phải itemIndex
        // (itemIndex trỏ vào config.files, không áp dụng cho text item).
        <>
          <MenuItem icon={Pencil} label="Edit" onClick={() => { requestEditListItem(targetId, itemToken); closeContextMenu(); }} />
          <Divider />
          <MenuItem icon={Trash2} label="Xoá" onClick={() => { removeListItemBeta(targetId, itemToken); closeContextMenu(); }} danger />
        </>
      )}

      {type === 'item' && itemKind === 'file' && (
        // Row file của ListNodeBeta — itemIndex vẫn đúng vị trí trong config.files (dùng lại
        // handleOpenFileLocation/handlePreviewItem), nhưng xoá theo token để renumber itemOrder
        // đúng (xem removeListItemBeta trong store.js).
        <>
          <MenuItem icon={FolderOpen} label="Mở thư mục chứa" onClick={handleOpenFileLocation} />
          <MenuItem icon={Eye} label="Xem trước" onClick={handlePreviewItem} />
          <Divider />
          <MenuItem icon={Trash2} label="Xoá" onClick={() => { removeListItemBeta(targetId, itemToken); closeContextMenu(); }} danger />
        </>
      )}

      {type === 'item' && !itemKind && (
        // Mọi call site LTS cũ (ListNode.jsx và các node khác) không truyền itemKind — hành vi
        // giữ nguyên y hệt trước khi thêm Beta.
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
