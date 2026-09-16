import { useState } from 'react';
import { Settings, X } from 'lucide-react';
import { useVideoStore } from '../store';
import { useDialogFocus } from '../useDialogFocus';
import BatchCanvasSettings from './BatchCanvasSettings';

export default function BatchProjectSettings({ project, busy, blocked, dirty, error, onArchive }) {
  const [open, setOpen] = useState(false);
  const ref = useDialogFocus(() => setOpen(false), open);
  async function save() {
    try { await useVideoStore.getState().batchSave(); setOpen(false); }
    catch { /* Keep the draft and show the store's save error in this dialog. */ }
  }
  return <>
    <button type="button" aria-label="Cài đặt project BCL" title={`Cài đặt ${project.name}`} aria-haspopup="dialog" aria-expanded={open} disabled={busy} onClick={() => setOpen(true)}><Settings size={15}/> Cài đặt</button>
    {open && <div className="batch-dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section ref={ref} role="dialog" aria-modal="true" aria-label="Cài đặt project BCL" tabIndex={-1} className="batch-dialog batch-project-settings-dialog">
        <div className="batch-section-heading"><h2>Cài đặt project</h2><button type="button" aria-label="Đóng cài đặt project" onClick={() => setOpen(false)}><X size={16}/></button></div>
        <label>Tên project<input aria-label="Tên project Lab" value={project.name} maxLength={120} disabled={blocked} onChange={e => useVideoStore.getState().batchEdit(p => { p.name = e.target.value; })}/></label>
        <BatchCanvasSettings project={project} disabled={blocked}/>
        <p className="batch-muted">Áp dụng cho toàn bộ batch của project này. Lưu cùng các thay đổi của Lab.</p>
        {error && <p role="alert">{error}</p>}
        <div className="batch-toolbar">
          <button type="button" disabled={busy} onClick={() => { setOpen(false); onArchive(); }}>{project.archived ? 'Khôi phục Lab' : 'Archive Lab'}</button>
          <span className="batch-spacer"/>
          <button type="button" className="batch-primary" disabled={blocked || !dirty} onClick={save}>Lưu thiết lập</button>
        </div>
      </section>
    </div>}
  </>;
}
