import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { apiFetch } from '../lib/transport.js';
import { track } from '../lib/analyticsClient.js';

export async function adminApi(path, method = 'GET', body, headers = {}) {
  const response = await apiFetch(`/api${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Không hoàn tất được yêu cầu.');
  return value;
}
export function useAdminData(loader, dependencies = [], interval = 0) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++seq.current; setLoading(true); setError('');
    try { const value = await loader(); if (id === seq.current) setData(value); }
    catch (err) { if (id === seq.current) setError(err.message); }
    finally { if (id === seq.current) setLoading(false); }
  }, dependencies);
  useEffect(() => { refresh(); const timer = interval ? setInterval(() => !document.hidden && refresh(), interval) : null;
    return () => { ++seq.current; clearInterval(timer); }; }, [refresh, interval]);
  return { data, error, loading, refresh };
}
export function AdminHeading({ title, description, loading, refresh }) {
  return <div className="review-page-heading"><div><p className="review-eyebrow">QUẢN LÝ WORKSPACE</p><h1>{title}</h1><p>{description}</p></div>
    <button disabled={loading} onClick={() => { track('data_refresh_clicked', {}, { feature: 'admin' }); refresh(); }}><RefreshCw size={15} />Làm mới dữ liệu</button></div>;
}
export function AdminSearch({ value, onChange, label }) { return <label className="review-search admin-search"><Search size={16} /><input aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} /></label>; }
export function AdminMessage({ error, notice }) { return error || notice ? <div className={`review-banner ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div> : null; }
export function AdminEmpty({ children = 'Chưa có dữ liệu trong môi trường này.' }) { return <p className="admin-empty">{children}</p>; }
export function AdminDialog({ title, children, close, submit, busy, disabled, action = 'Lưu thay đổi' }) {
  return <div className="review-dialog-backdrop"><form className="review-dialog admin-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => { event.preventDefault(); submit(); }}>
    <div className="review-section-heading"><h2>{title}</h2><button type="button" aria-label="Đóng" disabled={busy} onClick={close}><X size={18} /></button></div>
    <div className="admin-dialog-body">{children}</div><div className="review-actions"><button type="button" disabled={busy} onClick={close}>Hủy</button>
      <button className="review-primary" disabled={busy || disabled}>{busy ? 'Đang lưu…' : action}</button></div></form></div>;
}
export const dateLabel = value => value ? new Date(typeof value === 'string' && !value.includes('T') ? `${value.replace(' ', 'T')}Z` : value).toLocaleString('vi-VN') : 'Chưa có';
