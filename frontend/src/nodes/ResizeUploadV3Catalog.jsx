import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.js';
import { saveResizeUploadV3Catalog, deleteResizeUploadV3Catalog } from '../lib/api.js';
import { Modal, inputCls } from './resizeUploadShared.jsx';

const button = 'px-3 py-2 rounded-lg bg-[var(--n100,#f3f4f6)] text-[11px] hover:bg-[var(--n200,#e5e7eb)]';
const blankPlatform = name => ({ name, code: '', folder: '', thumbnail_folder: '' });

export default function ResizeUploadV3Catalog({ catalogs, onChange, onClose }) {
  const isAdmin = useStore(s => s.currentUser?.role === 'admin');
  const pickFolder = useStore(s => s.pickFolder);
  const [scope, setScope] = useState('private');
  const [appId, setAppId] = useState('');
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const apps = scope === 'public' ? catalogs.public : catalogs.effective;
  const editable = scope === 'private' || isAdmin;
  const select = id => { setAppId(id); setDraft(id ? structuredClone(apps[id]) : null); setMessage(''); };
  const editPlatform = (id, field, value) => setDraft(d => ({ ...d, platforms: { ...d.platforms, [id]: { ...d.platforms[id], [field]: value } } }));
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const raw = (scope === 'private' ? catalogs.mine : catalogs.public_overrides) || {};
      const hidden = Object.fromEntries(Object.entries(raw[appId]?.platforms || {}).filter(([, value]) => value === null));
      let entry = { ...draft, platforms: { ...hidden, ...draft.platforms } };
      if (scope === 'private' && catalogs.public[appId]) {
        // Only persist changed fields; later shared path/code updates remain visible.
        const shared = catalogs.public[appId];
        entry = { name: draft.name, platforms: { ...hidden } };
        for (const [key, platform] of Object.entries(draft.platforms)) {
          const fields = Object.fromEntries(Object.entries(platform).filter(([field, value]) => value !== shared.platforms?.[key]?.[field]));
          if (Object.keys(fields).length) entry.platforms[key] = fields;
        }
      }
      for (const key of Object.keys(catalogs.public[appId]?.platforms || {})) {
        if (!draft.platforms[key]) entry.platforms[key] = null;
      }
      const data = { ...raw, [appId]: entry };
      onChange(await saveResizeUploadV3Catalog(scope, data));
      setMessage(scope === 'private' ? 'Đã lưu. Chỉ bạn thấy và dùng phần riêng này.' : 'Đã lưu thư viện chung trên server.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setSaving(true);
    try {
      const next = { ...(catalogs.mine || {}) }; delete next[appId];
      onChange(await saveResizeUploadV3Catalog('private', next));
      setDraft(null); setAppId(''); setMessage('Đã xóa phần riêng của App này.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  const removeShared = async () => {
    if (!isAdmin || saving || !catalogs.public[appId]) return;
    if (!window.confirm(`Xóa App “${catalogs.public[appId].name}” khỏi thư viện chung?\n\nToàn bộ nền tảng, mã app và đường dẫn chung của App sẽ bị xóa cho mọi người dùng. Workflow đang dùng App này có thể cần chọn App khác hoặc cấu hình lại.\n\nBản riêng của từng người được giữ lại nhưng không còn kế thừa cấu hình chung của App. File video và thumbnail không bị xóa.\n\nBạn có chắc muốn xóa?`)) return;
    setSaving(true); setMessage('');
    try {
      // A tombstone also removes bundled Apps instead of revealing their defaults again.
      const next = { ...(catalogs.public_overrides || {}), [appId]: null };
      onChange(await saveResizeUploadV3Catalog('public', next));
      setDraft(null); setAppId(''); setMessage('Đã xóa App khỏi thư viện chung.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };

  return createPortal(<Modal title="Quản lý App / Mã app / Đường dẫn — V3" width={900} onClose={onClose}>
    <div className="text-[var(--text,#111827)] flex flex-col gap-3" onKeyDown={e => e.stopPropagation()}>
      <div className="flex gap-2">
        {[['private', 'Riêng của tôi'], ['public', 'Thư viện chung trên server']].map(([value, title]) =>
          <button key={value} className={`${button} ${scope === value ? 'ring-2 ring-red-400' : ''}`} onClick={() => { setScope(value); setAppId(''); setDraft(null); }}>{title}</button>)}
      </div>
      <p className="text-[11px] text-[var(--sub,#4b5563)]">Thư viện chung là mẫu chuẩn. App và đường dẫn riêng chỉ áp dụng cho tài khoản của bạn; không thay đổi dữ liệu người khác. {scope === 'public' && !isAdmin && 'Chỉ admin có thể sửa bản chung.'}</p>
      <div className="flex items-center gap-2">
        <select aria-label="Chọn App trong thư viện" className={inputCls} value={appId} onChange={e => select(e.target.value)}>
          <option value="">Chọn App để xem hoặc sửa…</option>
          {Object.entries(apps).map(([id, app]) => <option key={id} value={id}>{app.name}{scope === 'private' && catalogs.mine?.[id] ? ' · có bản riêng' : ''}</option>)}
        </select>
        {editable && <button className={`${button} whitespace-nowrap`} onClick={() => {
          setAppId(`app-${Date.now()}`); setDraft({ name: '', platforms: { android: blankPlatform('AND - Android'), ios: blankPlatform('IOS - iOS'), webfunnel: blankPlatform('Webfunnel') } }); setMessage('');
        }}>+ Thêm App</button>}
      </div>
      {draft && <fieldset disabled={!editable || saving} className="flex flex-col gap-3 disabled:opacity-70">
        <label className="text-[11px]">Tên App<input aria-label="Tên App" className={`${inputCls} mt-1`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        {Object.entries(draft.platforms).map(([key, platform]) => <div key={key} className="ml-4 p-3 rounded-lg border border-[var(--card-border,#e5e7eb)] flex flex-col gap-2">
          <div className="flex gap-2 items-center"><span className="text-[11px] font-semibold w-24">Nền tảng</span>
            <input aria-label={`Tên nền tảng ${key}`} className={inputCls} value={platform.name || key} onChange={e => editPlatform(key, 'name', e.target.value)} />
            <button type="button" className={`${button} whitespace-nowrap text-red-500`} onClick={() => setDraft(d => {
              const platforms = { ...d.platforms }; delete platforms[key]; return { ...d, platforms };
            })}>Xóa nền tảng</button>
          </div>
          {[['code', 'Mã app', 'Ví dụ HomeA1'], ['folder', 'Drive — video', 'Đường dẫn Google Drive đã đồng bộ trên máy'], ['thumbnail_folder', 'Drive — thumbnail', 'Đường dẫn thư mục thumbnail']].map(([field, label, placeholder]) =>
            <label key={field} className="ml-6 grid grid-cols-[120px_1fr_auto] items-center gap-2 text-[11px]">
              {label}<input aria-label={`${key} ${label}`} className={inputCls} placeholder={placeholder} value={platform[field] || ''} onChange={e => editPlatform(key, field, e.target.value)} />
              {field !== 'code' && <button className={button} type="button" onClick={async () => { const path = await pickFolder(); if (path) editPlatform(key, field, path); }}>Chọn…</button>}
            </label>)}
        </div>)}
        <button className={`${button} self-start ml-4`} onClick={() => {
          const key = `platform-${Date.now()}`;
          setDraft({ ...draft, platforms: { ...draft.platforms, [key]: blankPlatform('Nền tảng mới') } });
        }}>+ Thêm nền tảng</button>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-[11px] disabled:opacity-50" disabled={!draft.name.trim()} onClick={save}>{saving ? 'Đang lưu…' : `Lưu ${scope === 'private' ? 'bản riêng' : 'bản chung'}`}</button>
          {scope === 'private' && catalogs.mine?.[appId] && <button className={button} onClick={remove}>Xóa phần riêng của App</button>}
          {scope === 'public' && isAdmin && catalogs.public[appId] && <button className={`${button} text-red-600`} onClick={removeShared}>Xóa App khỏi thư viện chung</button>}
        </div>
      </fieldset>}
      {scope === 'private' && catalogs.mine && <button className={`${button} self-start`} disabled={saving} onClick={async () => {
        try { onChange(await deleteResizeUploadV3Catalog()); setAppId(''); setDraft(null); setMessage('Đang dùng thư viện chung.'); }
        catch (error) { setMessage(error.message); }
      }}>Bỏ toàn bộ bản riêng, dùng thư viện chung</button>}
      {message && <p role="status" className="text-[12px]">{message}</p>}
    </div>
  </Modal>, document.body);
}
