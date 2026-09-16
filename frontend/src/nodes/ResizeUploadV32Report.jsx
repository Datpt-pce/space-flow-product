import { useState } from 'react';
import GoogleReportingConnection from '../components/GoogleReportingConnection.jsx';
import ResizeSheetTabSelect from './ResizeSheetTabSelect.jsx';
import ResizeUploadV32AppsScriptGuide from './ResizeUploadV32AppsScriptGuide.jsx';
import { CredentialField } from '../components/ConfigFields.jsx';
import { inputCls } from './resizeUploadShared.jsx';
import { reportResizeUploadV32 } from '../lib/api.js';

export default function ResizeUploadV32Report({ config, set, output, onReported }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resultContext, setResultContext] = useState('');
  const manual = config.sheet_manual_selection === true;
  const selected = config.sheet_selected_targets || [];
  const contextKey = JSON.stringify([{ ...config, sheet_selected_targets: undefined }, output?.drive_groups, output?.files_out]);
  const currentPreview = result && resultContext === contextKey;
  const displayed = currentPreview ? result : output?.sheet_report;
  const canSubmit = !manual || (currentPreview && result.plans?.some(p => p.selection_key && selected.includes(p.selection_key) && ['ready', 'not_selected', 'unchanged', 'written'].includes(p.status)));
  const enabled = config.sheet_report_enabled === true;
  const test = config.test_mode !== false;
  const provider = config.sheet_report_provider || 'google_api';
  const themes = [...new Set([...(config.normalized_groups || []).map(group => group.theme_original), ...(output?.drive_groups || []).map(group => group.theme)].filter(Boolean))];
  const run = async preview => {
    setBusy(true);
    try {
      const requestConfig = preview && manual ? { ...config, sheet_selected_targets: [] } : config;
      if (preview && manual) set('sheet_selected_targets', []);
      const next = await reportResizeUploadV32(requestConfig, output.drive_groups, preview);
      setResult(next);
      setResultContext(contextKey);
      if (!preview) onReported(next);
    }
    catch (error) { setResult({ status: 'attention', message: error.message }); setResultContext(contextKey); }
    finally { setBusy(false); }
  };
  return <div className="border border-[var(--card-border,#e5e7eb)] rounded-xl p-3 flex flex-col gap-2">
    <label className="flex gap-2 font-semibold"><input type="checkbox" checked={enabled} onChange={e => set('sheet_report_enabled', e.target.checked)} />Tự điền path output vào Google Sheet (tùy chọn)</label>
    <label className="flex gap-2"><input type="checkbox" checked={config.sheet_label_enabled === true} onChange={e => set('sheet_label_enabled', e.target.checked)} />Ưu tiên label từ Google Sheet</label>
    {config.sheet_label_enabled && <p>Mở Nhận diện Input → Đọc label từ Sheet → kiểm tra và áp dụng. Đọc label dùng kết nối bên dưới, độc lập với bật/tắt ghi báo cáo.</p>}
    {(enabled || config.sheet_label_enabled) && <>
      <p>Khớp Detail/Theme + PIC Editor, điền cột Link Cloud. Bỏ qua khác biệt hoa/thường và dấu phân cách; tên sai cần khai báo alias. Nhiều dòng khớp cùng editor được điền từng dòng, giữ nguyên ô đã có nội dung. Test bật: không ghi Google Sheet. Path lấy từ folder đã copy thành công, mỗi nền tảng một dòng trong ô Link Cloud.</p>
      <label>Phương thức báo cáo<select aria-label="Phương thức báo cáo" className={`${inputCls} mt-1`} value={provider} onChange={e => { set('sheet_report_provider', e.target.value); setResult(null); }}>
        <option value="google_api">Google API</option><option value="apps_script">Apps Script</option>
      </select></label>
      <label>Google Sheet URL<input aria-label="Google Sheet URL" className={`${inputCls} mt-1`} value={config.sheet_url || ''} onChange={e => set('sheet_url', e.target.value)} /></label>
      <ResizeSheetTabSelect config={config} set={set} />
      {[['sheet_pic_editor', 'Tên PIC Editor trên Sheet'], ['sheet_search_range', 'Vùng dòng báo cáo, ví dụ I5:M500 (trống = vùng dữ liệu)']].map(([key, label]) => <label key={key}>{label}<input aria-label={label} className={`${inputCls} mt-1`} value={config[key] || ''} onChange={e => set(key, e.target.value)} /></label>)}
      {provider === 'apps_script' ? <div className="flex flex-col gap-2">
        <a className="underline self-start" href="/api/resize-upload-v3-2/sheet-script" download>Tải Apps Script V3.2</a>
        <CredentialField field={{ id: 'sheet_script_credential_name', label: 'Kết nối Apps Script', type: 'credential', credentialType: 'google-apps-script' }} value={config.sheet_script_credential_name || ''} onChange={value => set('sheet_script_credential_name', value)} />
        <ResizeUploadV32AppsScriptGuide />
      </div> : <GoogleReportingConnection value={config.sheet_google_credential_id || ''} onChange={value => set('sheet_google_credential_id', value)} />}
      <div className="grid grid-cols-3 gap-2">{[['sheet_detail_column', 'Cột Detail', 'I'], ['sheet_pic_column', 'Cột PIC Editor', 'K'], ['sheet_link_column', 'Cột Link Cloud', 'M']].map(([key, label, example]) => <label key={key}>{label}<input aria-label={label} className={`${inputCls} mt-1`} placeholder={`Tự tìm header; ví dụ ${example}`} value={config[key] || ''} onChange={e => set(key, e.target.value.trim().toUpperCase())} /></label>)}</div>
      <details><summary className="cursor-pointer">Tên Theme khác trên Sheet (alias)</summary><p>Nhập đúng tên khác hoặc toàn bộ Detail trên Sheet, mỗi dòng một tên. Alias chỉ dùng đối chiếu, không đổi tên nguồn hay nội dung Sheet.</p>{themes.map(theme => <label className="block mt-2" key={theme}>{theme}<textarea aria-label={`Alias Sheet ${theme}`} className={`${inputCls} mt-1`} value={(config.sheet_theme_aliases?.[theme] || []).join('\n')} onChange={e => set('sheet_theme_aliases', { ...config.sheet_theme_aliases, [theme]: e.target.value.split('\n') })} /></label>)}</details>
      <label className="flex gap-2"><input type="checkbox" checked={manual} disabled={busy} onChange={e => set('sheet_manual_selection', e.target.checked)} />Chọn dòng báo cáo thủ công</label>
      {manual && <p>Tên trùng: xem trước rồi tick đúng ô Link Cloud cần điền. Chưa chọn thì không ghi. Ô Link Cloud gộp được chọn cả vùng. Mỗi lần chạy video mới cần chọn lại; PIC và ô đã có nội dung vẫn được kiểm tra. Với Apps Script, tải lại code và Deploy phiên bản mới để dùng chế độ này.</p>}
      <div className="flex gap-2"><button className="p-2 rounded bg-[var(--n100,#f3f4f6)] disabled:opacity-50" disabled={!enabled || test || busy || !output?.drive_groups?.length} onClick={() => run(true)}>Xem trước ô sẽ điền</button><button className="p-2 rounded bg-[var(--n100,#f3f4f6)] disabled:opacity-50" disabled={!enabled || test || busy || !output?.drive_groups?.length || !canSubmit} onClick={() => run(false)}>Thử lại báo cáo, không resize</button></div>
      {displayed && <div role="status">{displayed.status}: {displayed.message}{displayed.plans?.map((plan, i) => <div className="border-t border-[var(--card-border,#e5e7eb)] py-2 mt-2" key={i}>
        {manual && currentPreview && plan.selection_key && <label className="flex gap-2 font-semibold"><input type="checkbox" aria-label={`Chọn ô ${plan.cell}`} disabled={busy || !['ready', 'not_selected', 'unchanged', 'written'].includes(plan.status)} checked={selected.includes(plan.selection_key)} onChange={e => set('sheet_selected_targets', e.target.checked ? [...new Set([...selected, plan.selection_key])] : selected.filter(key => key !== plan.selection_key))} />{plan.cell}{plan.targetRows > 1 ? ` — gộp ${plan.targetRows} dòng` : ''}</label>}
        <p>{plan.detail || plan.theme} · PIC: {plan.pic_editor || '—'} → {plan.cell || 'chưa xác định ô'}: {manual && selected.includes(plan.selection_key) && plan.status === 'not_selected' ? 'Đã chọn' : plan.status} {plan.status === 'not_selected' && selected.includes(plan.selection_key) ? '' : plan.message}</p>
        <span className="block whitespace-pre-wrap break-all">{plan.value}</span>
      </div>)}</div>}
    </>}
  </div>;
}
