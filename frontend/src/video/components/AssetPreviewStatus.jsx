import { useState } from 'react';
import { retryVideoAssetPreview } from '../../lib/api.js';
import { useVideoStore } from '../store.js';

export default function AssetPreviewStatus({ asset, allowRetry = false, compact = false }) {
  const [retrying, setRetrying] = useState(false), [error, setError] = useState(null);
  if (!asset || asset.kind !== 'video' || asset.status !== 'ok' || !['queued', 'running', 'error'].includes(asset.previewStatus)) return null;
  const name = asset.sourcePath?.split(/[\\/]/).pop() || 'video';
  const percent = Math.max(0, Math.min(99, Math.floor(asset.previewProgress || 0)));
  async function retry(e) {
    e.stopPropagation(); setRetrying(true); setError(null);
    try {
      const updated = await retryVideoAssetPreview(asset.id);
      useVideoStore.setState(s => ({ assets: s.assets.map(a => a.id === updated.id ? updated : a), assetsVersion: s.assetsVersion + 1 }));
    } catch (err) { setError(err.message); }
    finally { setRetrying(false); }
  }
  return <div className="asset-preview-status min-w-0 text-[11px] text-[var(--n600)]" data-preview-status={asset.previewStatus}>
    {asset.previewStatus === 'error' ? <>
      <span title={asset.previewError}>{compact ? 'Preview lỗi' : 'Preview lỗi · vẫn dùng được file gốc'}</span>
      {allowRetry && <button type="button" onClick={retry} disabled={retrying} className="ml-2 underline">{retrying ? 'Đang thử lại…' : 'Thử lại preview'}</button>}
      {error && <p role="alert">{error}</p>}
    </> : <>
      <span>{asset.previewStatus === 'queued' ? (compact ? 'Chờ preview' : 'Đang chờ preview') : `${compact ? 'Preview' : 'Đang tạo preview'} · ${percent}%`}</span>
      <progress aria-label={`Tiến trình preview ${name}`} max="100" value={percent} className="block w-full h-1 mt-1 accent-[var(--accent)]" />
    </>}
  </div>;
}
