// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2 task checklist):
// "frontend/src/sheet/components/SheetLibraryModal.jsx (mẫu WorkflowLibraryModal.jsx)". Unlike
// WorkflowLibraryModal (which saves the CURRENT canvas), Sheet documents are created explicitly
// HERE (blank or from an imported file) — SheetWorkspace.jsx only ever loads/autosaves an
// existing id (Phase 1's design: POST creates, PUT-only from then on).
//
// Deliberately imports engine/blankWorkbook.js (no @univerjs/* side effects) instead of
// engine/univerAdapter.js — this modal can open/list/import sheets without ever pulling in the
// full Univer runtime; only actually MOUNTING a sheet (SheetWorkspace.jsx) pays that cost.

import { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { X, Trash2, FolderOpen, Upload } from 'lucide-react';
import { useStore } from '../../store.js';
import { useSheetStore } from '../store.js';
import { fetchSheets, updateSheet, deleteSheetFromLibrary } from '../../lib/api.js';
import { createBlankWorkbook } from '../engine/blankWorkbook.js';
import { excelWorkbookToSnapshot } from '../io/xlsx.js';
import { csvToSnapshot } from '../io/csv.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function SheetLibraryModal() {
  const isOpen = useSheetStore(s => s.isSheetLibraryOpen);
  const closeSheetLibrary = useSheetStore(s => s.closeSheetLibrary);
  const openSheet = useSheetStore(s => s.openSheet);
  const createFromSnapshot = useSheetStore(s => s.createFromSnapshot);
  const setActiveModule = useStore(s => s.setActiveModule);

  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [status, setStatus] = useState('idle'); // idle | working | error
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  const load = () => fetchSheets().then(setList).catch(() => setList([]));
  useEffect(() => { if (isOpen) load(); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeSheetLibrary(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSheetLibrary]);

  if (!isOpen) return null;

  const openAndClose = (id, sheetName) => {
    openSheet(id, sheetName);
    setActiveModule('sheet');
    closeSheetLibrary();
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus('working');
    setErrorMsg('');
    try {
      await createFromSnapshot(name.trim(), createBlankWorkbook(name.trim()));
      setName('');
      setStatus('idle');
      setActiveModule('sheet');
      closeSheetLibrary();
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatus('working');
    setErrorMsg('');
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const sheetName = file.name.replace(/\.(xlsx|csv)$/i, '');
      let workbook;
      if (isCsv) {
        const text = await file.text();
        workbook = csvToSnapshot(text, sheetName);
      } else {
        const buffer = await file.arrayBuffer();
        const excelWorkbook = new ExcelJS.Workbook();
        await excelWorkbook.xlsx.load(buffer);
        workbook = excelWorkbookToSnapshot(excelWorkbook, sheetName);
      }
      await createFromSnapshot(sheetName, workbook);
      setStatus('idle');
      setActiveModule('sheet');
      closeSheetLibrary();
    } catch (err) {
      setErrorMsg(`Import thất bại: ${err.message}`);
      setStatus('error');
    }
  };

  const handleLoad = (sheet) => openAndClose(sheet.id, sheet.name);

  const handleToggleVisibility = async (sheet) => {
    await updateSheet(sheet.id, { visibility: sheet.visibility === 'team' ? 'private' : 'team' });
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xoá sheet này khỏi thư viện?')) return;
    await deleteSheetFromLibrary(id);
    load();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSheetLibrary(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden"
        style={{ width: 560, height: 560 }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-base font-semibold text-[var(--text,#111827)]">Thư viện Sheet</h2>
          <button
            onClick={closeSheetLibrary}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          <form onSubmit={handleCreate} className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider">Tạo sheet mới</p>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Tên sheet"
                className="flex-1 h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
              />
              <select
                value={visibility}
                onChange={e => setVisibility(e.target.value)}
                className="h-8 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs"
              >
                <option value="private">Riêng tư</option>
                <option value="team">Chung cả team</option>
              </select>
              <button
                type="submit"
                disabled={status === 'working' || !name.trim()}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Tạo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                type="button"
                title="Import từ .xlsx / .csv"
                onClick={() => fileInputRef.current?.click()}
                disabled={status === 'working'}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)] disabled:opacity-50 transition-colors"
              >
                <Upload size={13} />
              </button>
            </div>
            {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}
          </form>

          <div>
            <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">Đã lưu</p>
            {list.length === 0 ? (
              <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có sheet nào trong thư viện.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {list.map(sheet => (
                  <div key={sheet.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--sub,#374151)] truncate">{sheet.name}</div>
                      <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">
                        {sheet.isMine ? 'Của tôi' : sheet.ownerName} · {formatDate(sheet.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {sheet.isMine ? (
                        <button
                          onClick={() => handleToggleVisibility(sheet)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${sheet.visibility === 'team' ? 'bg-blue-50 text-blue-500 hover:bg-blue-100' : 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)] hover:bg-[var(--n200,#e5e7eb)]'}`}
                          title="Bấm để đổi phạm vi chia sẻ"
                        >
                          {sheet.visibility === 'team' ? 'Chung' : 'Riêng tư'}
                        </button>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500">Chung</span>
                      )}
                      <button
                        onClick={() => handleLoad(sheet)}
                        className="text-[var(--n400,#9ca3af)] hover:text-blue-500 p-1"
                        title="Mở sheet"
                      >
                        <FolderOpen size={14} />
                      </button>
                      {sheet.isMine && (
                        <button onClick={() => handleDelete(sheet.id)} className="text-[var(--n300,#d1d5db)] hover:text-red-500 p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
