// Graph Library Phase 7 (specs/space-flow-master-plan/02-graph-library.md): save/list/load/delete
// saved views for 1 scope ('global' or a Local Graph's root entity id). Camera/pinned-position
// capture needs the live Sigma instance, which this component (outside <SigmaContainer>, same
// header row as FilterPanel) doesn't have — the parent passes `getCurrentState()` (a getter it
// backs with a ref to the Sigma instance) instead of raw values, so "Save" always reads whatever
// is live at click time.

import { useEffect, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { fetchSavedGraphViews, createSavedGraphView, deleteSavedGraphView } from '../lib/api.js';

export default function SavedViewsPanel({ scope, getCurrentState, onApplyView }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const load = () => fetchSavedGraphViews(scope).then(setViews).catch((err) => setError(err.message));
  useEffect(() => { if (open) load(); }, [open, scope]);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      const state = getCurrentState();
      await createSavedGraphView({ scope, name: name.trim(), ...state });
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    await deleteSavedGraphView(id).catch((err) => setError(err.message));
    load();
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Saved Views"
        className={`p-1 rounded-lg transition-colors ${open ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]' : 'text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#4b5563)]'}`}
      >
        <Bookmark size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-lg shadow-lg p-2 text-xs">
          <div className="flex items-center gap-1 mb-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="Tên view mới"
              className="flex-1 h-6 px-1.5 text-[10px] rounded border border-[var(--card-border,#e5e7eb)]"
            />
            <button onClick={handleSave} className="h-6 px-2 rounded bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-[10px]">Lưu</button>
          </div>
          {error && <p className="text-[10px] text-red-500 mb-1">{error}</p>}
          {views.length === 0 && <p className="text-[10px] text-[var(--n400,#9ca3af)] italic">Chưa có view nào.</p>}
          {views.map((v) => (
            <div key={v.id} className="flex items-center justify-between py-1 hover:bg-[var(--n50,#f9fafb)] rounded px-1">
              <button className="text-left text-[11px] text-[var(--sub,#4b5563)] truncate flex-1" onClick={() => { onApplyView(v); setOpen(false); }}>
                {v.name}
              </button>
              <button onClick={() => handleDelete(v.id)} className="text-[var(--n300,#d1d5db)] hover:text-red-500 flex-shrink-0">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
