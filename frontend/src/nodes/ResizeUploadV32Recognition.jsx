import ResizeDriveInput from './ResizeDriveInput.jsx';
import ResizeOpenFolderButton from './ResizeOpenFolderButton.jsx';
import { useResizeInputSync } from '../lib/useResizeInputSync.js';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, inputCls, resolveDropPaths, basename } from './resizeUploadShared.jsx';
import { recognizeResizeUploadV32, readResizeUploadV32Labels } from '../lib/api.js';

const button = 'px-3 py-1.5 rounded-lg bg-[var(--n100,#f3f4f6)] hover:bg-[var(--n200,#e5e7eb)] disabled:opacity-50';
const defaults = [{ fields: 'theme,app,label,language', separator: '_' }, { fields: 'theme,app,language', separator: '_' }];

export default function ResizeUploadV32Recognition({ config, inputs, set, pickFolder, onClose, onSettings, paused = false }) {
  const [manual, setManual] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(true);
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState({ theme: '', app: '', language: '' });
  const [page, setPage] = useState(0);
  const roots = config.source_folders || [];
  const profiles = config.naming_profiles || defaults;
  const mutate = (key, value) => { set(key, value); set('short_video_ack', ''); setDirty(true); };
  const add = paths => mutate('source_folders', [...new Set([...roots, ...paths])]);
  const scan = async () => {
    setBusy(true); setMessage('');
    try { const next = await recognizeResizeUploadV32(config, inputs); setResult(next); setDirty(false); setPage(0); setSelected([]); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const readSheet = async () => {
    setBusy(true); setMessage(''); setDirty(true);
    set('sheet_label_ack', ''); set('sheet_label_snapshot', null);
    try {
      const snapshot = await readResizeUploadV32Labels(config);
      set('sheet_label_snapshot', snapshot); set('sheet_label_overrides', {}); set('sheet_label_ack', '');
      const next = await recognizeResizeUploadV32({ ...config, sheet_label_snapshot: snapshot, sheet_label_overrides: {} }, inputs);
      setResult(next); setDirty(false); setPage(0); setSelected([]);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const edit = (record, fields) => {
    const previous = config.input_overrides?.[record.path] || {};
    const next = { ...record.fields, ...previous.fields, ...fields };
    if (Object.hasOwn(fields, 'language')) { next.voice = ''; next.text = ''; }
    mutate('input_overrides', { ...config.input_overrides, [record.path]: { ...previous, confirmed: true, fields: next, label_manual: Object.hasOwn(fields, 'label') || (previous.label_manual ?? !!(previous.confirmed && previous.fields?.label)) } });
  };
  const records = result?.records || [];
  const visible = records.slice(page * 50, (page + 1) * 50);
  const sync = useResizeInputSync({
    enabled: !!result && !dirty && !busy && !paused,
    sourceKey: JSON.stringify([config, inputs]),
    scan: () => recognizeResizeUploadV32({ ...config, label_timestamp: result.label_timestamp }, inputs),
    onResult: next => {
      if (next.fingerprint === result.fingerprint && JSON.stringify(next.errors) === JSON.stringify(result.errors)) return;
      setResult(next);
      setSelected(current => current.filter(path => next.records.some(record => record.path === path)));
      setPage(current => Math.min(current, Math.max(0, Math.ceil(next.records.length / 50) - 1)));
      set('short_video_ack', ''); set('sheet_label_ack', '');
    },
  });
  const canApply = result && !dirty && !sync.refreshing && !sync.error && !paused && !result.unresolved && !result.errors.length;

  return createPortal(<Modal title="V3.2 — Nhận diện & chuẩn hóa Input" width={1120} onClose={onClose}>
    <div className="flex flex-col gap-3 text-[12px] text-[var(--text,#111827)]" onKeyDown={e => e.stopPropagation()}>
      <p>Đọc tên file và folder, giữ nguyên nguồn. ENxVI = thoại EN × chữ VI; EN đơn lẻ giữ nguyên, chưa xác định riêng thoại/chữ.</p>
      <p>Folder tên bất kỳ có thể chứa nhiều Theme: Theme_App_Label_EN, Theme_1_EN, Theme_Label_EN hoặc Theme_1. File thiếu mã kế thừa ngôn ngữ duy nhất của cùng Theme trong folder; cả nhóm thiếu mã mặc định EN. Có nhiều ngôn ngữ thì sửa cột Thoại × chữ rồi quét lại.</p>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <div className="border border-[var(--card-border,#e5e7eb)] rounded-xl p-3 flex flex-col gap-2">
          <label><input type="checkbox" checked={config.sheet_label_enabled === true} onChange={e => mutate('sheet_label_enabled', e.target.checked)} /> Ưu tiên label từ Google Sheet</label>
          {config.sheet_label_enabled && <>
            <p>Ghép theo thứ tự video trong bảng ↔ dòng Sheet của đúng Theme/PIC. Label đúng mẫu A…B…C…D…E…F…(G…) được dùng; thiếu/sai/trùng thì tạo theo thời gian. Label bạn sửa tay được giữ. Xem và sửa từng dòng trước khi áp dụng.</p>
            <p>Đọc Sheet là thao tác riêng, chỉ đọc kể cả khi Test bật. Chạy video dùng bản đã duyệt, không tự đọc lại hoặc ghi Sheet trong Test.</p>
            <div className="flex gap-2"><button className={button} onClick={readSheet}>Đọc label từ Sheet</button><button className={button} onClick={onSettings}>Cài đặt kết nối Sheet</button></div>
            {config.sheet_label_snapshot && <span>{config.sheet_label_snapshot.rows?.length || 0} dòng đã đọc · {config.sheet_tab} · PIC {config.sheet_pic_editor}</span>}
          </>}
        </div>
        <div className="border-2 border-dashed border-[var(--card-border,#e5e7eb)] rounded-xl p-3" aria-label="Thả folder nhận diện" onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={async e => {
          e.preventDefault(); e.stopPropagation(); if (busy) return;
          try { const paths = await resolveDropPaths(e); if (!paths.length) throw new Error('Không lấy được path; dùng chọn folder hoặc dán đường dẫn.'); add(paths); }
          catch (error) { setMessage(error.message); }
        }}>
          <ResizeDriveInput version="v3-2" disabled={busy} onImport={add} />
          <div className="flex gap-2"><textarea aria-label="Folder nguồn V3.2" className={`${inputCls} h-16`} placeholder="Kéo folder vào đây hoặc dán mỗi đường dẫn một dòng" value={manual} onChange={e => setManual(e.target.value)} />
            <div className="flex flex-col gap-2"><button className={button} onClick={() => { const paths = manual.split(/\r?\n/).map(p => p.trim().replace(/^"|"$/g, '')).filter(Boolean); add(paths); setManual(''); }}>Thêm nguồn</button><button className={button} onClick={async () => { const path = await pickFolder(); if (path) add([path]); }}>Chọn folder…</button></div></div>
          <div className="flex flex-wrap gap-2 mt-2">{roots.map(path => <span key={path} title={path} className="inline-flex items-center gap-1"><span>{basename(path)}</span><ResizeOpenFolderButton path={path} /><button type="button" aria-label={`Xóa nguồn ${basename(path)}`} className={button} onClick={() => mutate('source_folders', roots.filter(p => p !== path))}>×</button></span>)}</div>
          {!!inputs.folders_in?.length && <p className="mt-2">+ {inputs.folders_in.length} folder từ node nối vào.</p>}
        </div>
        <details className="border border-[var(--card-border,#e5e7eb)] rounded-xl p-3"><summary className="cursor-pointer font-semibold">Mẫu tên — đổi thứ tự / thêm bớt SubID</summary>
          <p className="my-2">Trường cách nhau bằng dấu phẩy: theme, app, label, language hoặc voice, text. Thêm tên riêng như variant, editor; dấu ? cho trường tùy chọn. Theme có thể chứa dấu phân cách. Nhiều mẫu cùng khớp sẽ yêu cầu kiểm tra.</p>
          {profiles.map((profile, i) => <div key={i} className="flex gap-2 mb-2"><input aria-label={`Trường mẫu ${i + 1}`} className={inputCls} value={profile.fields} onChange={e => mutate('naming_profiles', profiles.map((p, n) => n === i ? { ...p, fields: e.target.value } : p))} /><input aria-label={`Dấu phân cách mẫu ${i + 1}`} className={`${inputCls} max-w-20`} value={profile.separator} onChange={e => mutate('naming_profiles', profiles.map((p, n) => n === i ? { ...p, separator: e.target.value } : p))} /><button className={button} aria-label={`Xóa mẫu ${i + 1}`} onClick={() => mutate('naming_profiles', profiles.filter((_, n) => n !== i))}>×</button></div>)}
          <button className={button} onClick={() => mutate('naming_profiles', [...profiles, { fields: 'app,theme,language,label,variant?', separator: '_' }])}>Thêm mẫu</button>
          <p className="mt-2">Tên có khóa luôn được hỗ trợ: <code>theme=Demo__label=A123__voice=EN__text=VI__variant=02</code>. Thứ tự khóa không quan trọng; SubID khác được giữ trong metadata.</p>
        </details>
        <div className="flex gap-3 items-center"><button className={`${button} font-semibold text-red-500`} onClick={scan}>{busy ? 'Đang quét…' : 'Quét / kiểm tra lại'}</button>{result && <span>{records.length} video · {result.groups.length} nhóm · {result.unresolved} cần kiểm tra {dirty && '· Có thay đổi, cần quét lại'}</span>}</div>
        {result && <p className="text-[11px] text-[var(--sub,#6b7280)]">{dirty || paused ? 'Tạm dừng đồng bộ khi đang sửa / chạy.' : sync.refreshing ? 'Đang đồng bộ thư mục…' : 'Tự cập nhật mỗi 3 giây và khi quay lại trang.'}</p>}
        {sync.error && <p role="alert" className="text-red-500">Chưa đồng bộ được Input: {sync.error}</p>}
        {result?.errors.map((error, i) => <p role="alert" className="text-red-500" key={i}>{error}</p>)}
        {records.length > 0 && <>
          <div className="flex flex-wrap gap-2 items-center"><label><input type="checkbox" aria-label="Chọn tất cả video để sửa" checked={records.every(r => selected.includes(r.path))} onChange={e => setSelected(e.target.checked ? records.map(r => r.path) : [])} /> Sửa hàng loạt ({selected.length})</label>
            {['theme', 'app', 'language'].map(key => <input key={key} aria-label={`Sửa hàng loạt ${key}`} placeholder={key} className={`${inputCls} max-w-40`} value={bulk[key]} onChange={e => setBulk({ ...bulk, [key]: e.target.value })} />)}
            <button className={button} disabled={!selected.length} onClick={() => {
              const next = { ...config.input_overrides }, fields = Object.fromEntries(Object.entries(bulk).filter(([, value]) => value.trim()));
              for (const record of records.filter(r => selected.includes(r.path))) {
                const previous = next[record.path] || {};
                next[record.path] = { ...previous, confirmed: true, label_manual: previous.label_manual ?? !!(previous.confirmed && previous.fields?.label), fields: { ...record.fields, ...previous.fields, ...fields, ...(fields.language ? { voice: '', text: '' } : {}) } };
              }
              mutate('input_overrides', next);
            }}>Áp dụng cho đã chọn</button>
          </div>
          <div className="overflow-auto max-h-[340px] border border-[var(--card-border,#e5e7eb)] rounded-lg"><table className="w-full text-left text-[11px] min-w-[990px]"><thead className="sticky top-0 bg-[var(--n50,#f9fafb)]"><tr>{['Sửa', 'Dùng', 'Tên gốc', 'Theme', 'Mã App', 'Thoại × chữ', 'Label đầu ra', 'Trạng thái / SubID'].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>
            {visible.map((record, i) => { const override = config.input_overrides?.[record.path] || {}; const fields = { ...record.fields, ...override.fields }; return <tr key={record.path} className="border-t border-[var(--card-border,#e5e7eb)] align-top">
              <td className="p-2"><input type="checkbox" aria-label={`Chọn sửa video ${page * 50 + i + 1}`} checked={selected.includes(record.path)} onChange={e => setSelected(e.target.checked ? [...selected, record.path] : selected.filter(p => p !== record.path))} /></td>
              <td className="p-2"><input type="checkbox" aria-label={`Dùng video ${page * 50 + i + 1}`} checked={!(override.excluded ?? record.excluded)} onChange={e => mutate('input_overrides', { ...config.input_overrides, [record.path]: { ...override, excluded: !e.target.checked } })} /></td>
              <td className="p-2 max-w-56 break-all" title={record.path}>{record.name}<ResizeOpenFolderButton path={record.path} label={`Mở vị trí video ${record.name}`} />{record.candidates.length > 1 && <select aria-label={`Cách hiểu video ${page * 50 + i + 1}`} className={`${inputCls} mt-1`} value="" onChange={e => edit(record, record.candidates[Number(e.target.value)])}><option value="" disabled>Chọn cách hiểu…</option>{record.candidates.map((candidate, n) => <option key={n} value={n}>{Object.entries(candidate).map(([key, value]) => `${key}=${value}`).join(' · ')}</option>)}</select>}</td>
              {['theme', 'app', 'language', 'label'].map(key => <td key={key} className="p-1"><input aria-label={`${key} video ${page * 50 + i + 1}`} className={`${inputCls} min-w-24`} value={key === 'label' && config.sheet_label_enabled ? (dirty && override.label_manual ? override.fields?.label : record.label) || '' : fields[key] || ''} placeholder={key === 'label' ? `Tự cấp: ${record.label}` : key} onChange={e => edit(record, { [key]: e.target.value })} /></td>)}
              <td className="p-2 min-w-40"><span className={record.errors.length ? 'text-amber-600' : 'text-green-600'}>{record.excluded ? 'Bỏ qua' : record.errors.join('; ') || 'Đã nhận diện'}</span><div>{Object.entries(fields).filter(([key]) => !['theme', 'app', 'language', 'label', 'voice', 'text'].includes(key)).map(([key, value]) => `${key}=${value}`).join(' · ')}</div>
                {config.sheet_label_enabled && <><p>{record.sheet_message}</p><select aria-label={`Dòng label video ${page * 50 + i + 1}`} className={`${inputCls} mt-1`} value={config.sheet_label_overrides?.[record.path] === null ? 'time' : config.sheet_label_overrides?.[record.path] ?? 'auto'} onChange={e => {
                  mutate('input_overrides', { ...config.input_overrides, [record.path]: { ...override, label_manual: false, fields: { ...override.fields, label: '' } } });
                  mutate('sheet_label_overrides', { ...config.sheet_label_overrides, [record.path]: e.target.value === 'auto' ? 'auto' : e.target.value === 'time' ? null : Number(e.target.value) });
                }}><option value="auto">Tự ghép theo thứ tự</option><option value="time">Tạo label thời gian</option>{record.sheet_candidates?.map(candidate => <option key={candidate.row} value={candidate.row}>Dòng {candidate.row + 1}: {candidate.label}</option>)}</select></>}
              </td>
            </tr>; })}
          </tbody></table></div>
          <div className="flex gap-2 items-center"><button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page + 1}/{Math.ceil(records.length / 50)}</span><button className={button} disabled={(page + 1) * 50 >= records.length} onClick={() => setPage(page + 1)}>Sau</button></div>
        </>}
      </fieldset>
      {message && <p role="alert" className="text-red-500">{message}</p>}
      <div className="flex justify-end gap-2"><button className={button} onClick={onClose}>Đóng</button><button className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50" disabled={busy || !canApply} onClick={() => { set('normalized_groups', result.groups.map(({ records: _records, ...group }) => group)); set('label_timestamp', result.label_timestamp); set('sheet_label_ack', config.sheet_label_enabled ? result.fingerprint : ''); set('short_video_ack', ''); onClose(); }}>Dùng các nhóm đã nhận diện</button></div>
    </div>
  </Modal>, document.body);
}
