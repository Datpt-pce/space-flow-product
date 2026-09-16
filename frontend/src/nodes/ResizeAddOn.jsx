import { inputCls } from './resizeUploadShared.jsx';

export default function ResizeAddOn({ row, scope, onChange }) {
  return <div className="flex flex-col gap-1">
    <label className="flex gap-1 items-center whitespace-nowrap"><input aria-label={`AddOn ${scope}`} type="checkbox" className="accent-red-500" checked={!!row.use_addon} onChange={e => onChange({ use_addon: e.target.checked })} />AddOn</label>
    {row.use_addon && <input aria-label={`Nội dung AddOn ${scope}`} className={`${inputCls} w-24 placeholder:text-[var(--sub,#6b7280)] placeholder:opacity-60`} placeholder="Nhập text" value={row.addon || ''} onChange={e => onChange({ addon: e.target.value })} />}
  </div>;
}
