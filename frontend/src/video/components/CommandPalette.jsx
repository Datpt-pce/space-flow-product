import { useState } from 'react';
import { useDialogFocus } from '../useDialogFocus.js';
export default function CommandPalette({ actions, onClose }) {
  const ref = useDialogFocus(onClose);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const matches = actions.filter(a => normalize(a.label).includes(normalize(query)));
  const selectedIndex = Math.min(index, Math.max(0, matches.length - 1));
  const run = action => { if (!action || action.disabled) return; onClose(); action.run(); };
  return <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/50" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Tìm thao tác" className="w-[480px] max-w-[calc(100vw-32px)] rounded-2xl p-4 bg-[var(--card)] text-[var(--text)]" onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex((selectedIndex + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(1, matches.length)); }
      if (e.key === 'Enter') { e.preventDefault(); run(matches[selectedIndex]); }
    }}>
      <label className="text-sm font-semibold">Tìm thao tác<input aria-label="Tìm thao tác" value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} placeholder="Nhập tên thao tác…" className="w-full my-3 border rounded-lg p-2 bg-[var(--card)]" /></label>
      <div className="max-h-[50vh] overflow-y-auto space-y-1">{matches.map((a, i) => <button key={a.label} disabled={a.disabled} onClick={() => run(a)} className={`block w-full text-left text-sm rounded-lg px-3 py-2 disabled:opacity-40 ${i === selectedIndex ? 'bg-[var(--n100)]' : ''}`}>{a.label}</button>)}</div>
      {!matches.length && <p className="text-xs py-2">Không có thao tác phù hợp.</p>}<button className="text-xs underline mt-3" onClick={onClose}>Đóng (Esc)</button>
    </section>
  </div>;
}
