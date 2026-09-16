import ResizeInputPreview from './ResizeInputPreview.jsx';
import ResizeOpenFolderButton from './ResizeOpenFolderButton.jsx';
import ResizeAddOn from './ResizeAddOn.jsx';
import ResizeResultLinks from './ResizeResultLinks.jsx';
import { queuedDriveFolders, resizeDriveRowError } from '../lib/resizeDrivePreparation.js';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Clapperboard, Settings2, Copy, Trash2, Plus, X } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchResizeUploadV3Catalog, previewResizeUploadV32 } from '../lib/api.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';
import { CredentialField } from '../components/ConfigFields.jsx';
import { Modal, inputCls, MODES, BG_STYLES, basename, TaskSelectorModal } from './resizeUploadShared.jsx';
import ResizeUploadV3Catalog from './ResizeUploadV3Catalog.jsx';
import ResizeUploadV32Wiring from './ResizeUploadV32Wiring.jsx';
import ResizeUploadV32Recognition from './ResizeUploadV32Recognition.jsx';
import ResizeUploadV32Report from './ResizeUploadV32Report.jsx';

const button = 'px-2.5 py-1.5 rounded-lg bg-[var(--n100,#f3f4f6)] text-[11px] hover:bg-[var(--n200,#e5e7eb)] disabled:opacity-50';
const makeRow = () => ({ id: crypto.randomUUID(), selected: true, app: '', platforms: [], input_folders: [], task_urls: '', mode: '4_sizes_meta', export_thumbnail: true, use_unc: true, use_today_date: true, custom_date: '', use_addon: false, addon: '' });

export default function ResizeUploadV32Node({ id, data, selected, width }) {
  const config = data.config || {};
  const rows = config.rows || [];
  const rowErrors = Object.fromEntries(rows.map(row => [row.id, resizeDriveRowError('resize-upload-v3-2', config, row)]));
  const wiring = config.routing_mode === 'wiring';
  const edges = useStore(s => s.edges);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const upstreamFolders = edges.filter(edge => edge.target === id && edge.targetHandle === 'folders_in')
    .flatMap(edge => nodeOutputs[edge.source]?.[edge.sourceHandle] || [])
    .map(item => typeof item === 'string' ? item : item?.binary?.data?.path).filter(Boolean);
  const update = useStore(s => s.updateNodeConfig);
  const runDirect = useStore(s => s.runNmsV3);
  const runWorkflow = useStore(s => s.runWorkflow);
  const pickFolder = useStore(s => s.pickFolder);
  const duplicate = useStore(s => s.duplicateNode);
  const remove = useStore(s => s.deleteNode);
  const status = useStore(s => s.nodeStatuses[id]);
  const progress = useStore(s => s.nodeProgress[id]);
  const output = useStore(s => s.nodeOutputs[id]);
  const userId = useStore(s => s.currentUser?.id);
  const [catalogs, setCatalogs] = useState({ public: {}, mine: null, effective: {} });
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taskRow, setTaskRow] = useState(null);
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const running = status === 'running';
  const displayProgress = progress || ((running || busy) ? {
    message: running ? 'Đang chờ Agent gửi tiến độ xử lý…' : 'Đang kiểm tra thư mục đầu vào…',
  } : null);
  const testMode = config.test_mode !== false;
  const set = (field, value) => update(id, field, value);
  const setRows = value => { set('rows', value); set('short_video_ack', ''); setPreview(null); };
  const changeRow = (rowId, fields) => setRows(rows.map(row => row.id === rowId ? { ...row, ...fields } : row));

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await fetchResizeUploadV3Catalog();
        if (!disposed) setCatalogs(next);
      } catch (error) { if (!disposed) setMessage(error.message); }
      finally { pending = false; }
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, catalogOpen]);
  const connectedInputs = () => {
    const state = useStore.getState();
    const folders = state.edges.filter(edge => edge.target === id && edge.targetHandle === 'folders_in')
      .flatMap(edge => state.nodeOutputs[edge.source]?.[edge.sourceHandle] || [])
      .map(item => typeof item === 'string' ? item : item?.binary?.data?.path).filter(Boolean);
    return { folders_in: folders };
  };
  const validateOutputFolder = () => {
    if (!testMode && !config.output_folder?.trim()) {
      setMessage('Bắt buộc chọn Output Folder trước khi chạy thật. Mở Cài đặt V3.2 (nút bánh răng) để chọn thư mục.');
      return false;
    }
    return true;
  };
  const inspect = async (mode = null) => {
    if (mode && !validateOutputFolder()) return;
    setBusy(true); setMessage(''); setPendingRun(mode);
    try {
      if (!mode && queuedDriveFolders('resize-upload-v3-2', config).length) throw new Error('Input có link Drive chờ tải. Nhấn chạy node để tải trước khi kiểm tra.');
      const prepared = mode ? await useStore.getState().prepareResizeDriveInputs(id) : config;
      if (!prepared) return;
      const result = await previewResizeUploadV32({ ...prepared, short_video_ack: '', label_timestamp: '' }, connectedInputs());
      setPreview(result);
      if (mode && !result.errors.length && !result.warnings.length) await start(mode, result);
      else setPreviewOpen(true);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const start = async (mode, checked) => {
    if (!validateOutputFolder()) { setPreviewOpen(false); return; }
    set('short_video_ack', checked?.fingerprint || '');
    set('label_timestamp', checked?.label_timestamp || '');
    setPreviewOpen(false);
    if (mode === 'workflow') await runWorkflow(id);
    else await runDirect(id, mode || 'full', connectedInputs());
  };

  return <div style={{ width: width || 1160, height: '100%', minHeight: 640 }} className="relative flex flex-col text-[var(--text,#111827)]">
    <ResizeControls selected={selected} minW={1060} maxW={1800} minH={640} maxH={1400} />
    <NodeToolbar isVisible={!!selected} position={Position.Top}>
      <div className="flex gap-1 p-1 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-xl shadow-lg">
        <button className={button} disabled={running || busy} onClick={() => inspect('workflow')}>Run from here</button>
        <button className={button} title="Duplicate" onClick={() => duplicate(id)}><Copy size={14} /></button>
        <button className={button} title="Delete" onClick={() => remove(id)}><Trash2 size={14} /></button>
      </div>
    </NodeToolbar>
    <div className="absolute bottom-full mb-2 text-[12px] text-[var(--sub,#4b5563)]">{data.manifest.name} #{data.nodeNumber ?? id.slice(-4)}</div>
    <div className={`flex flex-col flex-1 min-h-0 rounded-2xl p-4 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] shadow-sm ${selected ? 'ring-2 ring-red-400' : ''}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><div className="flex items-center gap-2 text-sm font-semibold"><Clapperboard size={18} className="text-red-500" />Resize & Upload V3.2</div>
          <div className="text-[10px] text-[var(--sub,#4b5563)] mt-1">Input linh hoạt · Theme / thoại × chữ · Label gốc hoặc label tự cấp</div></div>
        <button className={`nodrag ${button}`} onClick={() => setCatalogOpen(true)}>Quản lý App / Mã app / Đường dẫn</button>
      </div>
      <div className="nodrag flex items-center gap-3 mb-3 text-[11px]">
        <button className={button} disabled={running || busy} onClick={() => setRecognitionOpen(true)}>Nhận diện Input</button>
        <span>{(config.normalized_groups || []).length} nhóm đã nhận diện · Thoại × chữ giữ riêng</span>
      </div>
      <div className="nodrag flex flex-wrap gap-2 mb-2 text-[11px]">{[...new Set([...(config.source_folders || []), ...upstreamFolders])].map(path => <span key={path} className="inline-flex items-center" title={path}>{basename(path)}<ResizeOpenFolderButton path={path} /></span>)}</div>
      <div className="nodrag flex items-center gap-2 mb-3 text-[11px]" role="group" aria-label="Mô hình V3.2">
        {[['table', 'Bảng V3'], ['wiring', 'Nối dây']].map(([mode, label]) => <button key={mode} className={button} aria-pressed={(config.routing_mode || 'table') === mode} disabled={running || busy} onClick={() => { set('routing_mode', mode); set('short_video_ack', ''); setPreview(null); }}>{label}</button>)}
        <span>{wiring ? 'Chỉ chạy nhóm đã nối · Checkbox áp dụng riêng cho từng nhánh' : 'Mỗi nhóm Input × các nền tảng đã chọn'}</span>
      </div>
      {wiring ? <ResizeUploadV32Wiring rows={rows} rowErrors={rowErrors} folders={(config.normalized_groups || []).map(group => group.id)} upstreamFolders={[]} catalog={catalogs.effective}
        onRows={setRows} onFolders={() => {}} onRecognize={() => setRecognitionOpen(true)} onTask={setTaskRow}
        onMessage={setMessage} pickFolder={pickFolder} makeRow={makeRow} output={output} disabled={running || busy} />
      : <>
      <div className="nodrag flex items-center justify-between mb-2 text-[11px]">
        <label className="flex gap-2 items-center"><input type="checkbox" className="accent-red-500" checked={rows.length > 0 && rows.every(row => row.selected)} onChange={e => setRows(rows.map(row => ({ ...row, selected: e.target.checked })))} />Chọn tất cả ({rows.filter(row => row.selected).length}/{rows.length})</label>
        <button className={`${button} text-red-500 flex items-center gap-1`} onClick={() => setRows([...rows, makeRow()])}><Plus size={12} />Thêm dòng</button>
      </div>
      <div className="nodrag nowheel flex-1 min-h-[160px] overflow-auto rounded-xl border border-[var(--card-border,#e5e7eb)]">
        <table className="w-full text-[10px] text-left" style={{ minWidth: 1000 }}>
          <thead className="sticky top-0 bg-[var(--n50,#f9fafb)] z-10"><tr>{['#', 'App', 'Input — Theme', 'Asana', 'Resize', 'Nền tảng', 'Thumb', 'Drive', 'Datetime', 'AddOn', 'Kết quả / Links', ''].map((title, i) => <th className="p-2 font-semibold" key={i}>{title}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => {
            const app = catalogs.effective[row.app];
            const result = output?.rows?.[row.id];
            const rowError = rowErrors[row.id] || result?.error;
            return <tr key={row.id} aria-invalid={!!rowError} title={rowError || undefined} className={`align-top border-t border-[var(--card-border,#e5e7eb)] ${rowError ? 'bg-red-500/10 ring-1 ring-inset ring-red-400' : ''}`}>
              <td className="p-2"><label className="flex gap-1">{index + 1}<input aria-label={`Chọn dòng ${index + 1}`} className="accent-red-500" type="checkbox" checked={!!row.selected} onChange={e => changeRow(row.id, { selected: e.target.checked })} /></label></td>
              <td className="p-2"><select aria-label={`App dòng ${index + 1}`} className={`${inputCls} min-w-28`} value={row.app} onChange={e => changeRow(row.id, { app: e.target.value, platforms: [] })}>
                <option value="">Chọn App…</option>{Object.entries(catalogs.effective).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}
              </select></td>
              <td className="p-2 min-w-48"><details><summary>Nhóm Input: {row.input_folders.length || 'tất cả'}</summary>
                <div className="flex flex-col gap-2 py-2">{(config.normalized_groups || []).map(group => <label key={group.id} className="flex gap-1"><input type="checkbox" checked={row.input_folders.includes(group.id)} onChange={e => changeRow(row.id, { input_folders: e.target.checked ? [...row.input_folders, group.id] : row.input_folders.filter(p => p !== group.id) })} />{basename(group.id)} ({group.count})</label>)}</div>
                <p>Không chọn nhóm riêng = tất cả nhóm. Dùng checkbox dòng để bỏ qua cả dòng.</p>
              </details><button className="text-red-500 mt-2" onClick={() => setRecognitionOpen(true)}>Nhận diện / sửa Input</button></td>
              <td className="p-2"><textarea aria-label={`Asana dòng ${index + 1}`} className={`${inputCls} w-28 h-14 resize-none`} placeholder="Task URLs" value={row.task_urls} onChange={e => changeRow(row.id, { task_urls: e.target.value })} onKeyDown={e => e.stopPropagation()} /><button className="text-red-500 mt-1" onClick={() => setTaskRow(row.id)}>Chọn từ Asana</button></td>
              <td className="p-2"><select aria-label={`Resize dòng ${index + 1}`} className={`${inputCls} w-14`} value={row.mode} onChange={e => changeRow(row.id, { mode: e.target.value })}>{MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.value.startsWith('4') ? '4' : mode.value.startsWith('3') ? '3' : '8'}</option>)}</select></td>
              <td className="p-2"><details className="min-w-28"><summary className="cursor-pointer rounded border border-[var(--card-border,#e5e7eb)] px-2 py-1.5">{row.platforms.length ? `${row.platforms.length} đã chọn` : 'Chọn nền tảng'}</summary>
                <div className="flex flex-col gap-2 py-2">{Object.entries(app?.platforms || {}).map(([key, platform]) => <label key={key} className="flex gap-1 items-start whitespace-nowrap"><input type="checkbox" className="accent-red-500 mt-0.5" checked={row.platforms.includes(key)} onChange={e => changeRow(row.id, { platforms: e.target.checked ? [...row.platforms, key] : row.platforms.filter(p => p !== key) })} />{platform.name || key}<span className="text-[var(--sub,#6b7280)]">{platform.code || 'chưa có mã'}</span></label>)}{!app && <span>Chọn App trước</span>}</div>
              </details></td>
              <td className="p-2 text-center"><input aria-label={`Thumbnail dòng ${index + 1}`} type="checkbox" className="accent-red-500" checked={row.export_thumbnail !== false} onChange={e => changeRow(row.id, { export_thumbnail: e.target.checked })} /></td>
              <td className="p-2 text-center"><input aria-label={`Drive dòng ${index + 1}`} type="checkbox" className="accent-red-500" checked={row.use_unc !== false} onChange={e => changeRow(row.id, { use_unc: e.target.checked })} /><div className="text-[8px] mt-1">{testMode ? 'Test local' : ''}</div></td>
              <td className="p-2"><label className="flex gap-1 whitespace-nowrap"><input aria-label={`Hôm nay dòng ${index + 1}`} type="checkbox" className="accent-red-500" checked={row.use_today_date !== false} onChange={e => changeRow(row.id, { use_today_date: e.target.checked })} />Hôm nay</label>{row.use_today_date === false && <input aria-label={`Ngày dòng ${index + 1}`} className={`${inputCls} mt-1 w-20`} placeholder="YYMMDD" value={row.custom_date} onChange={e => changeRow(row.id, { custom_date: e.target.value })} />}</td>
              <td className="p-2"><ResizeAddOn row={row} scope={`dòng ${index + 1}`} onChange={fields => changeRow(row.id, fields)} /></td>
              <td className="p-2 min-w-32 max-w-52"><div className={!rowError && result?.status === 'done' ? 'text-green-600' : 'text-red-500'}>{rowError || (result?.status === 'done' ? '✓ Xong' : '—')}</div><ResizeResultLinks links={result?.unc_links} thumbnailLinks={result?.thumbnail_links} row={row} catalog={catalogs.effective} /></td>
              <td className="p-2"><button aria-label={`Xóa dòng ${index + 1}`} onClick={() => setRows(rows.filter(r => r.id !== row.id))}><X size={12} /></button></td>
            </tr>;
          })}{!rows.length && <tr><td colSpan={12} className="text-center py-10 text-[var(--sub,#6b7280)]">Thêm dòng → chọn App → nhận diện Input → chọn nền tảng.</td></tr>}</tbody>
        </table>
      </div>
      </>}
      <div className="text-[10px] mt-2 text-[var(--sub,#6b7280)]">Tên file: <span className="font-mono">Theme_MãApp_Label_NgônNgữ[_AddOn]_Size_ThờiLượng_Ngày</span></div>
      <div className="nodrag flex items-center gap-2 mt-3">
        <button className="flex-1 py-2 rounded-lg bg-red-600 text-white text-[12px] font-semibold disabled:opacity-50" disabled={running || busy || !rows.some(row => row.selected)} onClick={() => inspect('full')}>{running ? 'Đang xử lý…' : busy ? 'Đang kiểm tra…' : testMode ? 'RESIZE & LƯU TEST DESKTOP' : 'RESIZE & UPLOAD'}</button>
        <button className={button} disabled={running || busy || !rows.some(row => row.selected)} onClick={() => inspect('upload_only')}>Upload (không resize)</button>
        <button className={button} disabled={running || busy} onClick={() => inspect()}>Kiểm tra Input</button>
        <button className={button} title="Cài đặt V3.2" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /></button>
      </div>
      <div className="text-[10px] mt-2 text-[var(--sub,#6b7280)]">{testMode ? 'Test: video + thumbnail → Desktop/SpaceFlow-Resize-Upload-V3.2-Test. Drive và Asana chưa chạy.' : 'Đích Drive và thumbnail lấy theo App / nền tảng trong thư viện của bạn.'}</div>
      {displayProgress && <div className="mt-2"><div role="progressbar" aria-label="Tiến độ Resize V3.2" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayProgress.percent} className="h-1.5 rounded bg-[var(--n100,#f3f4f6)] overflow-hidden"><div className={`h-full rounded bg-red-500 ${displayProgress.percent == null ? 'animate-pulse' : ''}`} style={{ width: displayProgress.percent == null ? '100%' : `${displayProgress.percent}%` }} /></div><div role="status" className="text-[10px] mt-1 truncate">{displayProgress.message}</div></div>}
      {output?.sheet_report && <p className="text-[11px] mt-2" role="status">Google Sheet: {output.sheet_report.status === 'disabled' ? 'đã tắt' : output.sheet_report.status === 'test_skipped' ? 'Test — không gửi' : output.sheet_report.status === 'done' ? 'đã báo cáo' : 'cần kiểm tra / thử lại trong Cài đặt'} {output.sheet_report.message}</p>}
      {(message || output?.error) && <p role="alert" className="text-[11px] text-red-500 mt-2">{message || output.error}</p>}
    </div>
    <Handle type="target" id="folders_in" position={Position.Left} className="port-handle port-handle--input" data-label="Theme folders" style={portStyle('array', 0, 1, 'left')}>{portGlyph('array')}</Handle>
    {['unc_links', 'files_out', 'thumbnail_files', 'recognized_items', 'drive_links'].map((port, index) => <Handle key={port} type="source" id={port} position={Position.Right} className="port-handle port-handle--output" data-label={port} style={portStyle('array', index, 5, 'right')}>{portGlyph('array')}</Handle>)}

    {recognitionOpen && <ResizeUploadV32Recognition paused={running} config={config} inputs={{ folders_in: upstreamFolders }} set={set} pickFolder={pickFolder} onClose={() => setRecognitionOpen(false)} onSettings={() => { setRecognitionOpen(false); setSettingsOpen(true); }} />}
    {catalogOpen && <ResizeUploadV3Catalog catalogs={catalogs} onChange={setCatalogs} onClose={() => setCatalogOpen(false)} />}
    {settingsOpen && createPortal(<Modal title="Cài đặt Resize & Upload V3.2" width={700} onClose={() => setSettingsOpen(false)}><div className="flex flex-col gap-3 text-[11px] text-[var(--text,#111827)]">
      <label className="flex gap-2 items-center"><input type="checkbox" checked={testMode} onChange={e => set('test_mode', e.target.checked)} />Chế độ test — lưu Desktop</label>
      {[[testMode ? 'test_output_folder' : 'output_folder', testMode ? 'Folder test (để trống dùng Desktop)' : 'Output Folder (bắt buộc)']].map(([key, label]) => <label key={key}>{label}<div className="flex gap-2 mt-1"><input aria-label={label} required={!testMode} aria-required={!testMode} className={inputCls} value={config[key] || ''} onChange={e => set(key, e.target.value)} /><button className={button} onClick={async () => { const path = await pickFolder(); if (path) set(key, path); }}>Chọn…</button></div></label>)}
      <ResizeUploadV32Report config={config} set={set} output={output} onReported={report => useStore.setState(state => ({ nodeOutputs: { ...state.nodeOutputs, [id]: { ...state.nodeOutputs[id], sheet_report: report, drive_links: [...new Set((report.plans || []).flatMap(plan => plan.links || []))] } } }))} />
      <label>Kiểu nền<select className={`${inputCls} mt-1`} value={config.bg_style || 'color'} onChange={e => set('bg_style', e.target.value)}>{BG_STYLES.map(bg => <option key={bg.value} value={bg.value}>{bg.label}</option>)}</select></label>
      {(config.bg_style || 'color') === 'color' && <label className="flex gap-2 items-center">Màu nền<input type="color" value={config.color_color || '#FEFBE7'} onChange={e => set('color_color', e.target.value)} /></label>}
      {config.bg_style === 'blur' && <label>Độ mờ<input className={inputCls} type="number" min="0" max="100" value={config.blur_value ?? 30} onChange={e => set('blur_value', Number(e.target.value))} /></label>}
      <label className="flex gap-2"><input type="checkbox" checked={config.use_asana !== false} onChange={e => set('use_asana', e.target.checked)} />Cập nhật Asana khi chạy thật</label>
      <CredentialField field={{ id: 'asana_credential_name', label: 'Asana PAT', type: 'credential' }} value={config.asana_credential_name || ''} onChange={value => set('asana_credential_name', value)} />
      <input className={inputCls} placeholder="Progress GID (trống = tự tìm)" value={config.asana_field_gid || ''} onChange={e => set('asana_field_gid', e.target.value)} />
      <input className={inputCls} placeholder="Done Option GID (trống = tự tìm)" value={config.asana_option_gid || ''} onChange={e => set('asana_option_gid', e.target.value)} />
    </div></Modal>, document.body)}
    {previewOpen && preview && createPortal(<Modal title="Kiểm tra Theme / Ngôn ngữ / Video" width={780} onClose={() => setPreviewOpen(false)}><div className="flex flex-col gap-3 text-[12px] text-[var(--text,#111827)]">
      <p><strong>{preview.combinations ?? 0} tổ hợp nhóm/nền tảng</strong> · {wiring ? 'Theo dây đã nối' : 'Theo bảng V3'}</p>
      {!!preview.warnings.length && <div className="rounded-lg p-3 bg-amber-50 text-amber-900"><strong>Chưa đủ tối thiểu 5 video / ngôn ngữ</strong>{preview.warnings.map((warning, i) => <div key={i}>{warning.message}</div>)}<p className="mt-2">Bạn vẫn có thể chạy các video hiện có. Folder trống được bỏ qua.</p></div>}
      {preview.errors.map((error, i) => <p className="text-red-500" key={i}>{error.message}</p>)}
      <ResizeInputPreview nodeId={id} paused={running} preview={preview} config={config} set={set} inspect={previewResizeUploadV32} inputs={connectedInputs} onPreview={setPreview} onBusy={setBusy} />
      <p className="text-[10px] text-[var(--sub,#6b7280)]">Label thay thế chỉ dùng cho đầu ra. Các icon phía trên thay đổi trực tiếp file nguồn.</p>
      <div className="flex justify-end gap-2"><button className={button} onClick={() => setPreviewOpen(false)}>Quay lại</button><button className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50" disabled={busy || !!preview.errors.length || !preview.rows.length} onClick={() => start(pendingRun || 'full', preview)}>{preview.warnings.length ? 'Vẫn chạy tiếp' : 'Chạy ngay'}</button></div>
    </div></Modal>, document.body)}
    {taskRow && createPortal(<TaskSelectorModal credentialName={config.asana_credential_name || ''} usedUrls={{}} onClose={() => setTaskRow(null)} onInsert={urls => {
      const row = rows.find(r => r.id === taskRow); if (row) changeRow(taskRow, { task_urls: [...new Set([...row.task_urls.split(/\r?\n/).filter(Boolean), ...urls])].join('\n') });
    }} />, document.body)}
  </div>;
}
