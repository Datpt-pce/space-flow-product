import { useEffect, useRef, useState } from 'react';

export default function BatchInlineName({ name, label, disabled, onRename, onSelect, deferSelect = false, prefix, selected, className = '' }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(name), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), active = useRef(false), pending = useRef(false), clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  function begin() {
    clearTimeout(clickTimer.current);
    if (disabled) return;
    active.current = true; setValue(name); setError(''); setEditing(true);
  }
  async function commit() {
    if (!active.current || pending.current) return;
    const next = value.trim();
    if (!next) { setError('Tên không được để trống.'); return; }
    pending.current = true; setSaving(true);
    try {
      if (next !== name) await onRename(next);
      active.current = false; setEditing(false); setError('');
    } catch (e) { setError(e.message); }
    finally { pending.current = false; setSaving(false); }
  }
  return <div className={`batch-inline-name ${className}`}>
    {editing ? <input aria-label={label} value={value} maxLength={120} autoFocus disabled={saving || disabled}
      onFocus={e => e.target.select()} onChange={e => { setValue(e.target.value); setError(''); }} onBlur={commit}
      onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); active.current = false; setEditing(false); setError(''); } }}/>
      : <button type="button" className="batch-name-button" aria-label={label} aria-pressed={selected} title={`${name} · Nhấp đúp hoặc F2 để đổi tên`} disabled={disabled}
        onClick={e => { if (!onSelect || e.detail > 1) return; if (deferSelect) clickTimer.current = setTimeout(onSelect, 240); else onSelect(); }}
        onDoubleClick={e => { e.stopPropagation(); begin(); }} onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); begin(); } }}>
        {prefix}<span>{name}</span>
      </button>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
