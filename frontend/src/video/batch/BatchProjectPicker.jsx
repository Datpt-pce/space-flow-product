import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Folder, X } from 'lucide-react';
import BatchInlineName from './BatchInlineName';

export default function BatchProjectPicker({ project, projects, disabled, onSelect, onRename, onRemove }) {
  const [open, setOpen] = useState(false), ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape' && e.target.tagName !== 'INPUT') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  const remove = target => <button type="button" className="batch-remove-name" aria-label={`Xóa folder ${target.name}`} title="Chuyển project Lab vào thùng rác" disabled={disabled || target.archived} onClick={() => onRemove(target.id)}><X size={14}/></button>;
  return <div className="batch-project-picker" ref={ref}>
    <div className="batch-project-current">
      {project ? <><BatchInlineName key={project.id} name={project.name} label="Tên folder Lab" prefix={<Folder size={15}/>} disabled={disabled || project.archived} onRename={name => onRename(project.id, name)}/>{remove(project)}</> : <span>Chọn project</span>}
      <button type="button" aria-label="Chọn project Lab" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}><ChevronDown size={14}/></button>
    </div>
    {open && <div className="batch-project-options" aria-label="Các folder Lab">{projects.length ? projects.map(p => {
      const target = p.id === project?.id ? project : p;
      return <div key={p.id} data-lab-project={p.id} className="batch-project-option">
        <BatchInlineName name={target.name} label={`Folder ${target.name}`} prefix={<Folder size={14}/>} selected={p.id === project?.id} disabled={disabled} deferSelect
          onRename={name => onRename(p.id, name)} onSelect={async () => { await onSelect(p.id); setOpen(false); }}/>{remove(target)}
      </div>;
    }) : <p className="batch-muted">Chưa có project.</p>}</div>}
  </div>;
}
