// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4 task checklist):
// "UI: badge Synced/Pending/Conflict/Offline/Permission-lost, nút 'Refresh now'/'Disconnect'".
// No @univerjs/* import — same boundary as SheetLibraryModal.jsx/GoogleImportModal.jsx. A link
// created here writes straight into the sheet's snapshot (backend/routes/sheets.js's
// POST /:id/link-google), so on success this re-opens the sheet the same way GoogleImportModal
// does to pick up the new tab in the live Univer instance.

import { useEffect, useState } from 'react';
import { X, Link2, RefreshCw, Unlink, CheckCircle2, Clock, AlertTriangle, WifiOff, ShieldAlert } from 'lucide-react';
import { useSheetStore } from '../store.js';
import {
  fetchGoogleOAuthStatus, connectGoogleOAuth, disconnectGoogleOAuth,
  linkGoogleSheet, fetchSheetExternalLinks, refreshSheetExternalLink, deleteSheetExternalLink,
} from '../../lib/api.js';

const STATUS_META = {
  synced: { label: 'Synced', icon: CheckCircle2, className: 'text-emerald-600' },
  pending: { label: 'Pending', icon: Clock, className: 'text-amber-500' },
  conflict: { label: 'Conflict', icon: AlertTriangle, className: 'text-amber-600' },
  offline: { label: 'Offline', icon: WifiOff, className: 'text-[var(--n400,#9ca3af)]' },
  permission_lost: { label: 'Permission lost', icon: ShieldAlert, className: 'text-red-600' },
};

export default function GoogleLinkPanel() {
  const isOpen = useSheetStore(s => s.isGoogleLinkOpen);
  const closeGoogleLink = useSheetStore(s => s.closeGoogleLink);
  const currentSheetId = useSheetStore(s => s.currentSheetId);
  const currentSheetName = useSheetStore(s => s.currentSheetName);
  const openSheet = useSheetStore(s => s.openSheet);

  const [connected, setConnected] = useState(null); // null = loading
  const [links, setLinks] = useState([]);
  const [url, setUrl] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const loadStatus = () => fetchGoogleOAuthStatus().then(r => setConnected(r.connected)).catch(() => setConnected(false));
  const loadLinks = () => {
    if (!currentSheetId) return;
    fetchSheetExternalLinks(currentSheetId).then(setLinks).catch(() => setLinks([]));
  };

  useEffect(() => {
    if (!isOpen) return;
    loadStatus();
    loadLinks();
    // Post-redirect feedback from backend/routes/google-oauth.js's callback (?googleSheetsConnect=...).
    const params = new URLSearchParams(window.location.search);
    const result = params.get('googleSheetsConnect');
    if (result) {
      setErrorMsg(result === 'success' ? '' : `Kết nối Google thất bại (${result}).`);
      if (result === 'success') setStatus('connected-success');
      params.delete('googleSheetsConnect');
      const next = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState({}, '', next);
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSheetId]);

  if (!isOpen) return null;

  const handleLink = async (e) => {
    e.preventDefault();
    if (!url.trim() || !currentSheetId) return;
    setStatus('working');
    setErrorMsg('');
    try {
      await linkGoogleSheet(currentSheetId, url.trim(), Number(intervalSeconds) || 60);
      setUrl('');
      setStatus('idle');
      loadLinks();
      openSheet(currentSheetId, currentSheetName); // remount Univer để thấy tab mới, giống GoogleImportModal
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleRefresh = async (linkId) => {
    await refreshSheetExternalLink(currentSheetId, linkId).catch(() => {});
    loadLinks();
    openSheet(currentSheetId, currentSheetName);
  };

  const handleUnlink = async (linkId) => {
    if (!window.confirm('Ngắt link này? Dữ liệu tab đã import vẫn giữ nguyên, chỉ dừng tự động đồng bộ.')) return;
    await deleteSheetExternalLink(currentSheetId, linkId).catch(() => {});
    loadLinks();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeGoogleLink(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden" style={{ width: 560, maxHeight: 560 }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-base font-semibold text-[var(--text,#111827)] flex items-center gap-2">
            <Link2 size={16} /> Kết nối Google Sheets (đồng bộ đọc)
          </h2>
          <button onClick={closeGoogleLink} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--n50,#f9fafb)]">
            <div className="text-sm">
              {connected === null ? 'Đang kiểm tra…' : connected ? (
                <span className="text-emerald-600 font-medium">Đã kết nối tài khoản Google</span>
              ) : (
                <span className="text-[var(--n500,#6b7280)]">Chưa kết nối tài khoản Google</span>
              )}
            </div>
            {connected ? (
              <button onClick={() => disconnectGoogleOAuth().then(loadStatus)} className="text-xs px-2.5 py-1 rounded-lg border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:bg-[var(--n100,#f3f4f6)]">
                Ngắt kết nối
              </button>
            ) : (
              <button onClick={connectGoogleOAuth} className="text-xs px-2.5 py-1 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)]">
                Kết nối Google
              </button>
            )}
          </div>

          {connected && (
            <form onSubmit={handleLink} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider">Thêm link mới</p>
              <div className="flex items-center gap-2">
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
                />
                <input
                  type="number"
                  min={15}
                  value={intervalSeconds}
                  onChange={e => setIntervalSeconds(e.target.value)}
                  title="Chu kỳ đồng bộ (giây), tối thiểu 15"
                  className="w-16 h-8 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs"
                />
                <button
                  type="submit"
                  disabled={status === 'working' || !url.trim()}
                  className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 transition-colors"
                >
                  {status === 'working' ? 'Đang kết nối…' : 'Kết nối'}
                </button>
              </div>
              {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}
            </form>
          )}

          <div>
            <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">Đã liên kết</p>
            {links.length === 0 ? (
              <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có link nào.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {links.map(link => {
                  const meta = STATUS_META[link.syncStatus] || STATUS_META.offline;
                  const Icon = meta.icon;
                  return (
                    <div key={link.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--sub,#374151)] truncate">{link.spreadsheetId}</div>
                        <div className={`text-[11px] flex items-center gap-1 ${meta.className}`}>
                          <Icon size={11} /> {meta.label}
                          {link.mode === 'linked_readonly' && ` · mỗi ${link.refreshIntervalSeconds}s`}
                          {link.lastError && <span className="text-[var(--n400,#9ca3af)] truncate"> — {link.lastError}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {link.mode === 'linked_readonly' && (
                          <button onClick={() => handleRefresh(link.id)} title="Refresh now" className="text-[var(--n400,#9ca3af)] hover:text-blue-500 p-1">
                            <RefreshCw size={13} />
                          </button>
                        )}
                        <button onClick={() => handleUnlink(link.id)} title="Disconnect" className="text-[var(--n300,#d1d5db)] hover:text-red-500 p-1">
                          <Unlink size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
