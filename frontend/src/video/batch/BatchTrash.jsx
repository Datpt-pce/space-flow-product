import { useEffect, useState } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { batchRequest } from './batchApi';
import { useDialogFocus } from '../useDialogFocus';

export default function BatchTrash({ onClose, onChanged }) {
  const [data, setData] = useState({ projects: [], outputs: [] }), [tab, setTab] = useState('projects');
  const [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ref = useDialogFocus(() => { if (!busy) onClose(); });
  const rows = data[tab];
  const refresh = () => batchRequest('/trash').then(result => { setData(result); setSelected([]); });
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function perform(action, ids = selected) {
    const targets = rows.filter(p => ids.includes(p.id));
    if (!targets.length) return;
    if (action === 'purge' && !window.confirm(`Xóa vĩnh viễn ${targets.length} project Lab và timeline bên trong?\n${targets.map(p => p.name).join('\n')}\n\nKhông thể khôi phục project. File nguồn, MP4 đã lưu và backup vẫn được giữ.`)) return;
    setBusy(true); setError('');
    try {
      if (tab === 'projects') await batchRequest(`/trash/${action}`, { projects: targets.map(p => ({ id: p.id, revision: p.revision })) });
      else {
        const groups = Map.groupBy(targets, row => `${row.projectId}/${row.runId}`);
        for (const group of groups.values()) await batchRequest(`/${group[0].projectId}/runs/${group[0].runId}/archive`, { rowIndexes: group.map(p => p.rowIndex), restore: true });
      }
      await onChanged();
      await refresh();
    } catch (e) { setError(e.message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <div className="batch-dialog-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label="Thùng rác Lab" className="batch-dialog batch-trash-dialog">
    <div className="batch-section-heading"><h2><Trash2 size={18}/> Thùng rác</h2><button disabled={busy} onClick={onClose}>Đóng thùng rác</button></div>
    <div className="batch-toolbar">{[['projects', 'Project Lab'], ['outputs', 'Timeline đã xóa']].map(([key, title]) => <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => { setTab(key); setSelected([]); }}>{title} · {data[key].length}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    <label className="batch-checkbox"><input type="checkbox" aria-label="Chọn tất cả trong thùng rác" disabled={busy || !rows.length} checked={!!rows.length && selected.length === rows.length} onChange={e => setSelected(e.target.checked ? rows.map(p => p.id) : [])}/>Chọn tất cả ({rows.length})</label>
    <div className="batch-trash-list">{rows.length ? rows.map(row => <label key={row.id} className="batch-checkbox"><input type="checkbox" aria-label={`Chọn khôi phục ${row.name}`} disabled={busy} checked={selected.includes(row.id)} onChange={() => setSelected(all => all.includes(row.id) ? all.filter(id => id !== row.id) : [...all, row.id])}/><span>{row.name}{row.projectName && <small> · {row.projectName}</small>}</span></label>) : <p className="batch-muted">Thùng rác trống.</p>}</div>
    <div className="batch-toolbar"><button disabled={busy || !selected.length} onClick={() => perform('restore')}><RotateCcw size={15}/>Khôi phục {selected.length} đã chọn</button><span className="batch-spacer"/>
      {tab === 'projects' && <><button className="batch-danger-outline" disabled={busy || !selected.length} onClick={() => perform('purge')}>Xóa vĩnh viễn {selected.length} đã chọn</button><button className="batch-danger-outline" disabled={busy || !rows.length} onClick={() => perform('purge', rows.map(p => p.id))}>Xóa tất cả project</button></>}
    </div>
  </section></div>;
}
