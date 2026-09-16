import { inputCls } from './resizeUploadShared.jsx';

export default function ResizeUploadInputLanguages({ errors, values = {}, onChange, onRecheck, busy }) {
  const groups = [...new Map(errors.filter(error => error.language_key).map(error => [error.language_key, error])).values()];
  if (!groups.length) return null;
  return <fieldset disabled={busy} className="flex flex-col gap-2 border border-[var(--card-border,#e5e7eb)] rounded-lg p-3" onKeyDown={event => event.stopPropagation()}>
    <p>Nhóm có nhiều ngôn ngữ nên chưa thể gán các file thiếu mã. Nhập mã cho các file đó, ví dụ EN hoặc ENxVI, rồi kiểm tra lại.</p>
    {groups.map(group => <label key={group.language_key} className="flex items-center gap-3" title={group.language_key.split('\n')[0]}>
      <span className="flex-1 break-all">{group.theme}</span>
      <input aria-label={`Ngôn ngữ nhóm ${group.theme}`} className={`${inputCls} max-w-40`} placeholder="EN / ENxVI" value={values[group.language_key] || ''} onChange={event => onChange({ ...values, [group.language_key]: event.target.value })} />
    </label>)}
    <button className="self-start px-3 py-1.5 rounded-lg bg-[var(--n100,#f3f4f6)] disabled:opacity-50" onClick={onRecheck}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra lại ngôn ngữ'}</button>
  </fieldset>;
}
