import { useState } from 'react';
import { useDialogFocus } from '../useDialogFocus.js';
import { useVideoStore } from '../store.js';
import { updateVideoAssetRights } from '../../lib/api.js';
export default function MediaRightsDialog({ asset, onClose }) {
  const ref = useDialogFocus(onClose);
  const [license, setLicense] = useState(asset.rights?.license || '');
  const [source, setSource] = useState(asset.rights?.source || '');
  const [expiresAt, setExpiresAt] = useState(asset.rights?.expiresAt?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Quyền sử dụng media" className="w-[480px] max-w-[calc(100vw-32px)] max-h-[80dvh] overflow-auto p-5 rounded-2xl bg-[var(--card)] text-[var(--text)]">
    <h2 className="font-semibold mb-3">Quyền sử dụng media</h2><p className="text-xs break-all mb-3">{asset.sourcePath.split(/[\\/]/).pop()}</p>
    <form className="space-y-3 text-sm" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try {
      const updated = await updateVideoAssetRights(asset.id, { license, source, expiresAt: expiresAt ? `${expiresAt}T23:59:59.999Z` : '' });
      useVideoStore.setState(s => ({ assets: s.assets.map(a => a.id === asset.id ? updated : a) })); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); } }}>
      <label className="block">Giấy phép / ghi chú<input value={license} onChange={e => setLicense(e.target.value)} maxLength={1000} className="block mt-1 w-full border rounded p-2 bg-[var(--card)]" /></label>
      <label className="block">Nguồn media<input value={source} onChange={e => setSource(e.target.value)} maxLength={2000} className="block mt-1 w-full border rounded p-2 bg-[var(--card)]" /></label>
      <label className="block">Ngày hết hạn (UTC, để trống nếu không có)<input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="block mt-1 w-full border rounded p-2 bg-[var(--card)]" /></label>
      <p className="text-xs text-[var(--n600)]">Ngày hết hạn được dùng khi kiểm tra và xuất video. Thay đổi thông tin này sẽ yêu cầu kiểm tra lại các bản đã duyệt có dùng media.</p>
      {error && <p role="alert" className="text-[var(--video-error)]">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="border rounded-lg px-3 py-2" onClick={onClose}>Đóng</button><button disabled={busy} className="border rounded-lg px-3 py-2 disabled:opacity-40">Lưu thông tin</button></div>
    </form>
  </section></div>;
}
