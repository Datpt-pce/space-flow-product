import { useEffect, useId, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { fetchResizeUploadV32Tabs } from '../lib/api.js';
import { inputCls } from './resizeUploadShared.jsx';

export default function ResizeSheetTabSelect({ config, set }) {
  const selectId = useId();
  const [state, setState] = useState({ tabs: [], busy: false, error: '', key: '' });
  const [revision, setRevision] = useState(0);
  const provider = config.sheet_report_provider || 'google_api';
  const credential = provider === 'apps_script' ? config.sheet_script_credential_name : config.sheet_google_credential_id;
  const url = (config.sheet_url || '').trim();
  const key = JSON.stringify([url, provider, credential]);
  useEffect(() => {
    let active = true;
    setState({ tabs: [], busy: !!(url && credential), error: '', key });
    if (!url || !credential) return;
    const timer = setTimeout(async () => {
      try {
        const result = await fetchResizeUploadV32Tabs({ rows: [], sheet_url: url, sheet_report_provider: provider,
          sheet_google_credential_id: provider === 'google_api' ? credential : '', sheet_script_credential_name: provider === 'apps_script' ? credential : '' });
        if (active) setState({ tabs: result.tabs, busy: false, error: '', key });
      } catch (error) { if (active) setState({ tabs: [], busy: false, error: error.message, key }); }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [key, revision]);
  const current = state.key === key ? state : { tabs: [], busy: !!(url && credential), error: '' };
  const value = config.sheet_tab || '';
  return <div>
    <label htmlFor={selectId}>Tên tab báo cáo</label>
    <div className="flex items-center gap-2 mt-1">
      <select id={selectId} aria-label="Tên tab báo cáo" className={inputCls} value={value} disabled={current.busy} onChange={event => { set('sheet_tab', event.target.value); set('sheet_selected_targets', []); set('sheet_label_ack', ''); }}>
        <option value="">{current.busy ? 'Đang tải tab…' : 'Chọn tab báo cáo…'}</option>
        {value && !current.tabs.some(tab => tab.title === value) && <option value={value}>{value} (đã lưu)</option>}
        {current.tabs.map(tab => <option key={tab.id} value={tab.title}>{tab.title}</option>)}
      </select>
      <button type="button" title="Tải lại danh sách tab" aria-label="Tải lại danh sách tab" disabled={!url || !credential || current.busy} onClick={() => setRevision(value => value + 1)} className="p-1 text-red-500 disabled:opacity-40">
        {current.busy ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
      </button>
    </div>
    {(!url || !credential) && <p>Nhập URL Sheet và chọn kết nối để tải danh sách tab.</p>}
    {current.error && <p role="alert" className="text-red-500">{current.error}</p>}
    {!current.busy && !current.error && url && credential && state.key === key && !current.tabs.length && <p>Sheet chưa có tab để chọn.</p>}
  </div>;
}
