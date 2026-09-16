import { useEffect, useState } from 'react';
import { Pencil, Check, X, Trash2, FolderInput, Folder, File, LoaderCircle, RefreshCw } from 'lucide-react';
import { basename, inputCls } from './resizeUploadShared.jsx';
import ResizeOpenFolderButton from './ResizeOpenFolderButton.jsx';
import { useResizeInputSync } from '../lib/useResizeInputSync.js';
import { inputTree } from '../lib/resizeInputPaths.js';
import { NodeHistoryControls } from '../components/NodeHistoryScope.jsx';
import { useStore } from '../store.js';

export default function ResizeInputPreview({ nodeId, preview, config, set, inspect, inputs, onPreview, onBusy, paused = false }) {
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const historyBusy = useStore(state => state.nodeHistoryBusy);
  const saving = historyBusy === nodeId;
  const connected = inputs();
  const sourceKey = JSON.stringify([config, connected]);
  const [scannedKey, setScannedKey] = useState(sourceKey);
  const stale = scannedKey !== sourceKey;
  const trees = inputTree(preview);
  const roots = trees.map(tree => tree.path);
  const sync = useResizeInputSync({
    enabled: !editing && !historyBusy && !paused,
    sourceKey,
    scan: () => inspect({ ...config, label_timestamp: preview.label_timestamp || '', short_video_ack: '' }, connected),
    onResult: next => {
      if (next.fingerprint !== preview.fingerprint && config.short_video_ack) set('short_video_ack', '');
      onPreview(next);
      setScannedKey(sourceKey);
    },
  });
  useEffect(() => { onBusy(!!editing || saving || stale || sync.refreshing || !!sync.error); }, [editing, saving, stale, sync.refreshing, sync.error, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  const cancel = () => { setEditing(null); setError(''); };
  const begin = (item, action) => { setEditing({ ...item, action }); setValue(action === 'rename' ? basename(item.path) : ''); setError(''); };
  const save = async () => {
    setError('');
    try {
      await useStore.getState().performNodeInputAction(nodeId, { action: editing.action, path: editing.path, roots, name: value, folder: value, recognition: preview.recognition, inputs: connected });
      cancel();
    } catch (failure) { setError(failure.message); }
  };
  const folders = [];
  const collect = item => { if (item.folder) folders.push(item.path); item.children.forEach(collect); };
  trees.forEach(collect);
  const editor = item => editing?.path === item.path && <div className="ml-5 my-2 flex flex-wrap items-center gap-2" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Enter' && !saving) { event.preventDefault(); void save(); }
    if (event.key === 'Escape' && !saving) cancel();
  }}>
    {editing.action === 'delete' ? <p>Xóa “{basename(item.path)}”{item.folder ? ' và toàn bộ nội dung' : ''}? Có thể dùng Undo để khôi phục.</p>
      : <>
        <input autoFocus aria-label={editing.action === 'rename' ? 'Tên mới' : 'Folder đích'} className={`${inputCls} max-w-96`} value={value} disabled={saving} onChange={event => setValue(event.target.value)} />
        {editing.action === 'move' && <>
          <select aria-label="Chọn folder đích trong Input" className={`${inputCls} max-w-64`} value={folders.includes(value) ? value : ''} onChange={event => setValue(event.target.value)}><option value="">Chọn folder trong Input…</option>{folders.filter(path => path !== item.path).map(path => <option key={path} value={path}>{path}</option>)}</select>
          <button disabled={saving} onClick={async () => { const path = await useStore.getState().pickFolder(); if (path) setValue(path); }}>Chọn folder…</button>
        </>}
      </>}
    <button aria-label={editing.action === 'delete' ? 'Xác nhận xóa' : 'Lưu thay đổi'} disabled={saving} onClick={save} className="p-1 text-green-600">{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}</button>
    <button aria-label="Hủy thao tác" disabled={saving} onClick={cancel} className="p-1"><X size={16} /></button>
    {error && <span role="alert" className="text-red-500">{error}</span>}
  </div>;
  const renderItem = (item, root = false) => <div key={item.path} className={root ? 'mt-2' : 'ml-5 mt-1'}>
    <div className="flex items-center gap-1 text-[11px] break-all" title={item.path}>
      {item.folder ? <Folder size={14} className="shrink-0 text-amber-500" /> : <File size={13} className="shrink-0" />}
      <span>{basename(item.path)}</span>
      {[[Pencil, 'rename', 'Đổi tên'], [Trash2, 'delete', 'Xóa'], [FolderInput, 'move', 'Di chuyển']].map(([Icon, action, label]) => <button key={action} type="button" title={`${label} ${basename(item.path)}`} aria-label={`${label} ${item.folder ? 'folder' : 'asset'} ${basename(item.path)}`} disabled={!!editing || !!historyBusy || stale || paused || !!item.error} className="p-1 text-red-500 disabled:opacity-30" onClick={() => begin(item, action)}><Icon size={13} /></button>)}
      <ResizeOpenFolderButton path={item.path} label={item.folder ? `Mở thư mục nguồn ${basename(item.path)}` : `Mở vị trí video ${basename(item.path)}`} />
    </div>
    {item.error && <p role="alert" className="text-red-500 text-[11px]">{item.error}</p>}
    {editor(item)}
    {item.children.map(child => renderItem(child))}
  </div>;
  return <div data-node-history={nodeId} data-history-draft={!!editing}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
      <p className="text-[11px] text-[var(--sub,#6b7280)]">Đổi tên, xóa hoặc di chuyển trực tiếp folder/file nguồn. Ctrl+Z hoàn tác · Ctrl+Shift+Z làm lại.</p>
      <NodeHistoryControls nodeId={nodeId} disabled={!!editing} />
    </div>
    <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-[var(--sub,#6b7280)]">
      <span>{editing || saving || paused ? 'Tạm dừng đồng bộ khi đang sửa / chạy.' : 'Tự cập nhật mỗi 3 giây và khi quay lại trang.'}</span>
      <button type="button" title="Cập nhật ngay" aria-label="Cập nhật ngay" className="p-1 text-red-500 disabled:opacity-40" disabled={!!editing || !!historyBusy || paused || sync.refreshing} onClick={sync.refresh}>{sync.refreshing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
    </div>
    {sync.error && <p role="alert" className="text-red-500 mb-2">Chưa đồng bộ được Input: {sync.error}. Kiểm tra Agent rồi thử lại.</p>}
    {trees.map(tree => renderItem(tree, true))}
    <div className="mt-3 border-t border-[var(--card-border,#e5e7eb)] pt-2">{preview.rows.map((row, index) => <div key={row.row_id}>
      <strong>Dòng {index + 1}</strong>{row.themes.map(theme => <div key={theme.theme} className="ml-3"><strong>{theme.theme}</strong>{theme.languages.map(lang => <details key={lang.language} className="ml-4"><summary>{lang.language} — {lang.count} video</summary>{lang.videos.map(video => <div key={video.path} className="text-[11px]">{video.name}{video.renamed && <span className="text-amber-700"> → {video.label}</span>}</div>)}</details>)}</div>)}
    </div>)}</div>
  </div>;
}
