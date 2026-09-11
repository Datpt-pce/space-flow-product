import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchSystemStatus, updateDependencies, fetchAutoUpdateConfig, updateAutoUpdateConfig, fetchLatestVersion } from '../../lib/api.js';

export function SystemTab() {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [lines, setLines] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [available, setAvailable] = useState(null); // null = đang kiểm tra, true/false
  const [canUpdateCode, setCanUpdateCode] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [pythonWarning, setPythonWarning] = useState(null);
  const [unavailableReason, setUnavailableReason] = useState('');
  const [autoUpdateCfg, setAutoUpdateCfg] = useState(null); // null = chưa tải xong
  const [agentVersion, setAgentVersion] = useState(null);
  const [serverVersion, setServerVersion] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    fetchSystemStatus()
      .then(res => { setAvailable(res.available); setCanUpdateCode(!!res.canUpdateCode); setAgentVersion(res.version || null); })
      .catch(err => { setAvailable(false); setUnavailableReason(err.message); });
    fetchLatestVersion().then(data => setServerVersion(data?.version || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUpdateCode) return;
    fetchAutoUpdateConfig().then(setAutoUpdateCfg).catch(() => {});
  }, [canUpdateCode]);

  const saveAutoUpdateCfg = async (next) => {
    setAutoUpdateCfg(next); // cập nhật UI ngay, không chờ round-trip
    try {
      await updateAutoUpdateConfig(next);
    } catch {
      // Lưu ngầm - lỗi hiếm gặp (vd file config không ghi được) không đáng làm gián đoạn UI này.
    }
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const handleUpdate = async () => {
    setStatus('running');
    setLines([]);
    setErrorMsg('');
    setRestarting(false);
    setPythonWarning(null);
    try {
      await updateDependencies((eventType, data) => {
        if (eventType === 'log') {
          setLines(prev => [...prev, data.line]);
        } else if (eventType === 'error') {
          setErrorMsg(`[${data.target}] ${data.error}`);
          setStatus('error');
        } else if (eventType === 'done') {
          setStatus('done');
          setRestarting(!!data.restarting);
          setPythonWarning(data.pythonWarning || null);
        }
      });
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-4 py-1 h-full">
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">{canUpdateCode ? 'Code & thư viện' : 'Thư viện'}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--sub,#374151)]">
            {canUpdateCode ? 'Lấy code mới nhất + thư viện JS/Python (yt-dlp...)' : 'Cập nhật thư viện JS (root/frontend/backend) + Python (yt-dlp...)'}
          </span>
          {available === false ? (
            <span className="text-xs text-[var(--n400,#9ca3af)]">Không khả dụng ở môi trường này</span>
          ) : (
            <button
              onClick={handleUpdate}
              disabled={status === 'running' || available !== true}
              className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'running' && <Loader2 size={12} className="animate-spin" />}
              {status === 'running' ? 'Đang cập nhật...' : canUpdateCode ? 'Cập nhật' : 'Cập nhật tất cả thư viện'}
            </button>
          )}
        </div>
        {available === false && (
          <p className="text-xs text-[var(--n400,#9ca3af)] mt-2">
            {unavailableReason || 'Chỉ chạy được ở máy dev (native) — nơi root, frontend và backend cùng nằm trên một máy. ' +
              'Trên bản product (Docker) mỗi service chạy trong container riêng nên không áp dụng được.'}
          </p>
        )}
        {canUpdateCode && agentVersion && serverVersion && agentVersion !== serverVersion && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-2">
            Agent đang ở bản V{agentVersion}, server đang ở bản V{serverVersion} — một số tính năng mới có thể lỗi trên máy này cho tới khi bạn bấm "Cập nhật".
          </p>
        )}
      </div>

      {canUpdateCode && autoUpdateCfg && (
        <div>
          <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Tự động cập nhật</p>
          <label className="flex items-center gap-2 text-sm text-[var(--sub,#374151)] cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpdateCfg.enabled}
              onChange={(e) => saveAutoUpdateCfg({ ...autoUpdateCfg, enabled: e.target.checked })}
            />
            Tự động lấy code mới + khởi động lại khi có bản mới (không cần bấm "Cập nhật")
          </label>
          <div className="flex items-center gap-2 mt-2 pl-5">
            <span className="text-xs text-[var(--sub,#4b5563)]">Chỉ áp dụng trong khung giờ (để trống = mọi lúc):</span>
            <input
              type="time"
              value={autoUpdateCfg.windowStart || ''}
              disabled={!autoUpdateCfg.enabled}
              onChange={(e) => saveAutoUpdateCfg({ ...autoUpdateCfg, windowStart: e.target.value || null, windowEnd: e.target.value ? (autoUpdateCfg.windowEnd || e.target.value) : null })}
              className="text-xs border border-[var(--card-border,#f3f4f6)] rounded px-1.5 py-0.5 disabled:opacity-50"
            />
            <span className="text-xs text-[var(--sub,#4b5563)]">đến</span>
            <input
              type="time"
              value={autoUpdateCfg.windowEnd || ''}
              disabled={!autoUpdateCfg.enabled}
              onChange={(e) => saveAutoUpdateCfg({ ...autoUpdateCfg, windowEnd: e.target.value || null, windowStart: e.target.value ? (autoUpdateCfg.windowStart || e.target.value) : null })}
              className="text-xs border border-[var(--card-border,#f3f4f6)] rounded px-1.5 py-0.5 disabled:opacity-50"
            />
          </div>
        </div>
      )}

      {status === 'done' && (
        <p className={`text-xs ${pythonWarning ? 'text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2' : 'text-green-600'}`}>
          {restarting
            ? 'Hoàn tất — code đã ở bản mới nhất, agent đang tự khởi động lại. Kiểm tra lại tab Agent sau vài giây để xác nhận Online.'
            : pythonWarning
              ? `Đã cập nhật thư viện JS — nhưng thư viện Python (yt-dlp...) CHƯA cập nhật được: ${pythonWarning}`
              : 'Hoàn tất — các thư viện đã ở bản mới nhất hoặc đã được cập nhật.'}
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>
      )}

      {lines.length > 0 && (
        <pre
          ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#f3f4f6)] rounded-lg p-3 text-[11px] font-mono text-[var(--sub,#4b5563)] whitespace-pre-wrap"
        >
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

