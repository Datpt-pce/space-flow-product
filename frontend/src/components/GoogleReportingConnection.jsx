import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { fetchReportingConnections, startReportingConnection } from '../lib/api.js';

export default function GoogleReportingConnection({ value = '', onChange, onConnected }) {
  const admin = useStore(s => s.currentUser?.role === 'admin');
  const [connections, setConnections] = useState([]);
  const [configured, setConfigured] = useState(null);
  const [name, setName] = useState('Google báo cáo');
  const [scope, setScope] = useState(admin ? 'public' : 'private');
  const [message, setMessage] = useState('');
  const popup = useRef(null);
  const cls = 'w-full p-2 border rounded-lg bg-[var(--n0,#fff)] border-[var(--card-border,#e5e7eb)]';
  const load = async () => {
    try { const data = await fetchReportingConnections(); setConnections(data.connections); setConfigured(data.configured); }
    catch (error) { setMessage(error.message); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const receive = event => {
      if (event.origin !== window.location.origin || !popup.current || event.source !== popup.current || event.data?.type !== 'google-reporting-connected') return;
      popup.current = null;
      if (event.data.status === 'success') { setMessage('Đã kết nối Google'); load(); onChange?.(event.data.credentialId); onConnected?.(); }
      else setMessage('Chưa kết nối được. Thử lại và cấp quyền Google Sheets.');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onChange, onConnected]);
  const connect = async () => {
    popup.current = window.open('about:blank', 'spaceflow-google-report', 'width=620,height=740');
    if (!popup.current) { setMessage('Trình duyệt đang chặn popup; cho phép popup rồi thử lại.'); return; }
    try { const { url } = await startReportingConnection(name, scope); popup.current.location.href = url; setMessage('Hoàn tất đăng nhập trong cửa sổ Google.'); }
    catch (error) { popup.current?.close(); popup.current = null; setMessage(error.message); }
  };
  return <div className="flex flex-col gap-2 border rounded-lg p-3 border-[var(--card-border,#e5e7eb)]">
    <strong>Kết nối Google báo cáo</strong>
    {onChange && <label>Tài khoản điền Sheet<select aria-label="Tài khoản điền Sheet" className={cls} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Chọn kết nối được cấp quyền</option>
      {value && !connections.some(c => c.id === value) && <option value={value}>Kết nối chưa có quyền hoặc đã bị xóa</option>}
      {connections.map(c => <option key={c.id} value={c.id}>{c.name} — {c.email || 'Google'} ({c.scope === 'public' ? 'dùng chung' : 'của tôi'})</option>)}
    </select></label>}
    {!onChange && connections.map(c => <p key={c.id}>{c.name} — {c.email || 'Google'} ({c.scope === 'public' ? 'dùng chung' : 'của tôi'})</p>)}
    <button type="button" className="self-start underline" onClick={load}>Làm mới kết nối</button>
    <details><summary className="cursor-pointer">Kết nối / kết nối lại Google</summary>
      <div className="flex flex-col gap-2 mt-2">
        <p>Gmail được kết nối cần quyền Edit trên Sheet. {admin ? 'Kết nối dùng chung: cấp quyền cho user tại Settings → Users → Credentials.' : 'Để dùng Gmail chung, nhờ Admin cấp quyền kết nối; bạn không cần tạo API riêng.'}</p>
        {configured === false && <p>Admin cần cấu hình Google OAuth trên server một lần trước khi kết nối.</p>}
        <label>Tên kết nối Google<input aria-label="Tên kết nối Google" className={cls} value={name} onChange={e => setName(e.target.value)} /></label>
        {admin && <label>Phạm vi kết nối<select aria-label="Phạm vi kết nối Google" className={cls} value={scope} onChange={e => setScope(e.target.value)}><option value="public">Dùng chung — cấp quyền theo user</option><option value="private">Chỉ tôi dùng</option></select></label>}
        <button type="button" disabled={!configured || !name.trim()} onClick={connect} className="self-start p-2 rounded bg-[var(--n100,#f3f4f6)] disabled:opacity-50">Đăng nhập Google</button>
      </div>
    </details>
    {message && <p role="status">{message}</p>}
  </div>;
}
