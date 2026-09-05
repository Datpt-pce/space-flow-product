import { useEffect, useRef, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { fetchLatestVersion, fetchSystemStatus, updateDependencies } from '../lib/api.js';

const LAST_SEEN_KEY = 'sf_last_seen_version';
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export default function VersionBell() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [agentAvailable, setAgentAvailable] = useState(null); // null = chưa kiểm tra
  const [updateStatus, setUpdateStatus] = useState('idle'); // idle | running | done | error
  const [updateRestarting, setUpdateRestarting] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const panelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchLatestVersion().then(data => {
        if (!cancelled && data) setVersionInfo(data);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Chi kiem tra agent co san sang cap nhat khong khi panel mo (tranh spam relay sang
  // agent cua user moi 5 phut qua vong poll version o tren).
  useEffect(() => {
    if (!isOpen || agentAvailable !== null) return;
    fetchSystemStatus().then(res => setAgentAvailable(!!res.available)).catch(() => setAgentAvailable(false));
  }, [isOpen, agentAvailable]);

  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  if (!versionInfo?.version) return null;

  const isUnseen = localStorage.getItem(LAST_SEEN_KEY) !== versionInfo.version;

  const handleToggle = () => {
    setIsOpen(o => !o);
    if (isUnseen) localStorage.setItem(LAST_SEEN_KEY, versionInfo.version);
  };

  const handleUpdateAgent = async () => {
    setUpdateStatus('running');
    setUpdateError('');
    setUpdateRestarting(false);
    try {
      await updateDependencies((eventType, data) => {
        if (eventType === 'error') {
          setUpdateError(`[${data.target}] ${data.error}`);
          setUpdateStatus('error');
        } else if (eventType === 'done') {
          setUpdateStatus('done');
          setUpdateRestarting(!!data.restarting);
        }
      });
    } catch (err) {
      setUpdateError(err.message);
      setUpdateStatus('error');
    }
  };

  return (
    <div ref={panelRef} className="absolute top-3 right-3 z-40">
      <button
        title="Phiên bản mới"
        onClick={handleToggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-md text-[var(--n500,#6b7280)] hover:text-[var(--n800,#1f2937)] hover:shadow-sm transition-colors"
      >
        <Bell size={16} />
        {isUnseen && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
        )}
      </button>

      {isOpen && (
        <div className="absolute top-11 right-0 w-80 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-2xl p-4">
          <p className="text-sm font-semibold text-[var(--n800,#1f2937)] mb-2">
            Phiên bản V{versionInfo.version}
          </p>
          <p className="text-sm text-[var(--n600,#4b5563)] whitespace-pre-wrap">
            {versionInfo.notes || 'Chưa có ghi chú cho phiên bản này.'}
          </p>

          {agentAvailable && (
            <div className="border-t border-[var(--card-border,#f3f4f6)] mt-3 pt-3">
              <button
                onClick={handleUpdateAgent}
                disabled={updateStatus === 'running'}
                className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {updateStatus === 'running' && <Loader2 size={12} className="animate-spin" />}
                {updateStatus === 'running' ? 'Đang cập nhật...' : 'Cập nhật Agent'}
              </button>
              {updateStatus === 'done' && (
                <p className="text-xs text-green-600 mt-2">
                  {updateRestarting ? 'Hoàn tất — agent đang tự khởi động lại...' : 'Hoàn tất — agent đã ở bản mới nhất.'}
                </p>
              )}
              {updateStatus === 'error' && <p className="text-xs text-red-600 mt-2">Lỗi: {updateError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
