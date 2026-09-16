import { useEffect, useId, useState } from 'react';

export default function PropertyField({ label, value, onCommit, onPreview, onCancelPreview, slider = false, min = 0, max = 100, step = 1, type = 'number', options, disabled }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = raw => {
    if (type === 'number') {
      if (raw === '' || !Number.isFinite(Number(raw))) { setDraft(value); return; }
      raw = Math.min(max, Math.max(min, Number(raw)));
    }
    if (raw !== value) onCommit(raw);
    onCancelPreview?.();
  };
  const classes = 'min-w-0 w-full h-8 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 text-[var(--text)] disabled:opacity-40';
  return <label htmlFor={id} className="flex items-center justify-between gap-3 text-xs text-[var(--n600)]">
    <span className="shrink-0">{label}</span>
    {options ? <select id={id} aria-label={label} disabled={disabled} className={classes} value={value} onChange={e => onCommit(e.target.value)}>
      {options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
    </select> : type === 'checkbox' ? <input id={id} aria-label={label} type="checkbox" disabled={disabled} checked={!!value} onChange={e => onCommit(e.target.checked)} />
      : <>{slider && type === 'number' && <input type="range" aria-label={`${label} — thanh trượt`} min={min} max={max} step={step} disabled={disabled}
        className="min-w-12 flex-1 accent-[var(--accent)]" value={draft === '' ? value : draft}
        onChange={e => { setDraft(e.target.value); onPreview?.(Number(e.target.value)); }}
        onPointerUp={e => commit(e.currentTarget.value)} onKeyUp={e => commit(e.currentTarget.value)}
        onPointerCancel={() => { setDraft(value); onCancelPreview?.(); }} onBlur={() => commit(draft)} />}
      <input id={id} aria-label={label} className={classes} style={{ maxWidth: type === 'color' ? 80 : slider ? 76 : 160 }} disabled={disabled}
        type={type} min={min} max={max} step={step} value={draft} onChange={e => { setDraft(e.target.value); if (type === 'color') commit(e.target.value); }}
        onBlur={() => commit(draft)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value); onCancelPreview?.(); e.stopPropagation(); } }} /></>}
  </label>;
}
