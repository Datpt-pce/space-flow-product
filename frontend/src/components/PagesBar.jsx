import { useState, useRef, useEffect } from 'react';
import { Plus, GripVertical, Copy, X, Pencil } from 'lucide-react';
import { useStore } from '../store.js';

export default function PagesBar() {
  const pages = useStore(s => s.pages);
  const activePageId = useStore(s => s.activePageId);
  const switchPage = useStore(s => s.switchPage);
  const addPage = useStore(s => s.addPage);
  const deletePage = useStore(s => s.deletePage);
  const renamePage = useStore(s => s.renamePage);
  const reorderPages = useStore(s => s.reorderPages);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const activePage = pages.find(p => p.id === activePageId);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (page, e) => {
    e.stopPropagation();
    setEditingId(page.id);
    setEditingName(page.name);
  };

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      renamePage(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  const handleSwitchPage = (pageId) => {
    switchPage(pageId);
    setIsOpen(false);
  };

  const handleAddPage = (e) => {
    e.stopPropagation();
    addPage();
    setIsOpen(true);
  };

  const handleDragStart = (e, pageId) => {
    dragIdRef.current = pageId;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, pageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (pageId !== dragIdRef.current) setDragOverId(pageId);
  };

  const handleDrop = (e, pageId) => {
    e.preventDefault();
    if (dragIdRef.current && dragIdRef.current !== pageId) {
      reorderPages(dragIdRef.current, pageId);
    }
    setDragOverId(null);
    dragIdRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverId(null);
    dragIdRef.current = null;
  };

  return (
    <div ref={panelRef} className="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2">
      {/* Panel (open state) */}
      {isOpen && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden w-52">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-sm font-semibold text-gray-800">Pages</span>
            <button
              onClick={handleAddPage}
              className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-0.5 transition-colors font-medium"
            >
              <Plus size={12} />
              <span>New</span>
            </button>
          </div>

          {/* Page list */}
          <div className="flex flex-col pb-2 max-h-64 overflow-y-auto">
            {pages.map((page) => {
              const isActive = page.id === activePageId;
              return (
                <div
                  key={page.id}
                  draggable={editingId !== page.id}
                  onDragStart={(e) => handleDragStart(e, page.id)}
                  onDragOver={(e) => handleDragOver(e, page.id)}
                  onDrop={(e) => handleDrop(e, page.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => { if (editingId === page.id) return; handleSwitchPage(page.id); }}
                  className={`group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-xl cursor-pointer transition-colors select-none
                    ${dragOverId === page.id ? 'bg-blue-50 border border-blue-200' : isActive ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <GripVertical size={13} className="text-gray-300 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                  {editingId === page.id ? (
                    <input
                      ref={inputRef}
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={handleKeyDown}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-transparent outline-none text-sm font-medium text-gray-800"
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => startRename(page, e)}
                      className={`flex-1 text-sm font-medium truncate ${isActive ? 'text-gray-900' : 'text-gray-600'}`}
                    >
                      {page.name}
                    </span>
                  )}
                  {editingId !== page.id && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(page, e); }}
                        className="text-gray-300 hover:text-gray-600 p-0.5 rounded transition-colors"
                        title="Đổi tên"
                      >
                        <Pencil size={11} />
                      </button>
                      {pages.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(page.id); }}
                          className="text-gray-300 hover:text-red-400 p-0.5 rounded transition-colors"
                          title="Xoá trang"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toggle chip */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl shadow-md px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <Copy size={13} className="text-gray-400" />
        <span className="max-w-28 truncate">{activePage?.name ?? 'Page'}</span>
      </button>

      {/* Confirm delete dialog */}
      {confirmDeleteId && (() => {
        const target = pages.find(p => p.id === confirmDeleteId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmDeleteId(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-5 w-72" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold text-gray-800 mb-1">Xoá trang?</p>
              <p className="text-xs text-gray-500 mb-4">
                Trang <span className="font-medium text-gray-700">"{target?.name}"</span> và toàn bộ nội dung sẽ bị xoá vĩnh viễn.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => { deletePage(confirmDeleteId); setConfirmDeleteId(null); }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  Xoá
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
