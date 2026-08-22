import { useState } from 'react';
import { resolveDropPaths } from './dropResolve.js';

// Trích từ logic drag-drop trong ListNode.jsx (LTS) — dùng chung cho ListNodeBeta và (khi cần)
// các node khác nhận file thả trực tiếp lên card. resolveDropPaths() tự xử lý cả internal drag
// (từ MediaNode, dataTransfer 'space-flow-file') lẫn OS drop (Windows Explorer), không cần tách
// nhánh thủ công như ListNode.jsx cũ.
export function useFileDropTarget({ onFilesAdded }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragOver = (e) => {
    const ok = e.dataTransfer.types.includes('space-flow-file') || e.dataTransfer.types.includes('Files');
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const onDragLeave = () => setIsDragOver(false);

  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    try {
      const paths = await resolveDropPaths(e);
      if (paths && paths.length) onFilesAdded(paths);
    } catch {}
  };

  return { isDragOver, dropHandlers: { onDragOver, onDragLeave, onDrop } };
}
