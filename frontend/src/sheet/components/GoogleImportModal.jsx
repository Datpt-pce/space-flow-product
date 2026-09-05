// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3): "paste URL → copy
// snapshot 1 lần → độc lập hoàn toàn". Imports into the CURRENTLY OPEN sheet as a new tab — the
// user re-opens the sheet afterward (via openSheet) so SheetWorkspace.jsx re-mounts Univer from
// the fresh snapshot; the live in-memory Univer instance never gets edited directly from here
// (this modal has no @univerjs/* import, matching SheetLibraryModal.jsx's same boundary).

import { useState } from 'react';
import { X, Cloud } from 'lucide-react';
import { useSheetStore } from '../store.js';
import { importGoogleSheet } from '../../lib/api.js';

export default function GoogleImportModal() {
  const isOpen = useSheetStore(s => s.isGoogleImportOpen);
  const closeGoogleImport = useSheetStore(s => s.closeGoogleImport);
  const currentSheetId = useSheetStore(s => s.currentSheetId);
  const currentSheetName = useSheetStore(s => s.currentSheetName);
  const openSheet = useSheetStore(s => s.openSheet);

  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | working | error | success
  const [errorMsg, setErrorMsg] = useState('');
  const [resultInfo, setResultInfo] = useState(null);

  if (!isOpen) return null;

  const handleImport = async (e) => {
    e.preventDefault();
    if (!url.trim() || !currentSheetId) return;
    setStatus('working');
    setErrorMsg('');
    try {
      const data = await importGoogleSheet(currentSheetId, url.trim());
      setResultInfo(data);
      setStatus('success');
      setUrl('');
      // Univer instance đang mount không tự thấy tab mới (snapshot chỉ đổi ở DB) — remount
      // bằng cách "mở lại" chính sheet này, giống hành vi SheetLibraryModal.jsx's handleLoad.
      openSheet(currentSheetId, currentSheetName);
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeGoogleImport(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden" style={{ width: 480 }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-base font-semibold text-[var(--text,#111827)] flex items-center gap-2">
            <Cloud size={16} /> Import từ Google Sheets
          </h2>
          <button onClick={closeGoogleImport} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleImport} className="px-6 py-5 flex flex-col gap-3">
          <p className="text-xs text-[var(--n500,#6b7280)]">
            Dán URL của 1 Google Sheets công khai (không cần đăng nhập Google). Dữ liệu sẽ được copy
            1 lần thành 1 tab mới trong sheet đang mở — muốn đồng bộ liên tục, dùng "Kết nối Google Sheets".
          </p>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="h-9 px-3 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
          />
          {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}
          {status === 'success' && resultInfo && (
            <p className="text-xs text-emerald-600">Đã import tab "{resultInfo.tabTitle}" ({resultInfo.rowCount} hàng).</p>
          )}
          <button
            type="submit"
            disabled={status === 'working' || !url.trim() || !currentSheetId}
            className="h-9 px-3 rounded-lg text-sm font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-start"
          >
            {status === 'working' ? 'Đang import…' : 'Import'}
          </button>
        </form>
      </div>
    </div>
  );
}
