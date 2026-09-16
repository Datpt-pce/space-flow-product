// Graph Library Phase 5 (specs/space-flow-master-plan/02-graph-library.md): query text box +
// color group list + direction-arrow toggle. Purely a controlled presentational component — the
// actual filter/color logic lives in queryEngine.js, the actual Sigma wiring in the graph view
// that renders this (LocalGraphPanel.jsx today, GlobalGraphView.jsx in Phase 6).

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

const SWATCH_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c'];

export default function FilterPanel({
  query, onQueryChange, colorGroups, onColorGroupsChange, showArrows, onShowArrowsChange,
  orphanOnly, onOrphanOnlyChange, // optional — Global Graph only (02-graph-library.md §0: a Local
  // Graph's entities all reached the root via BFS, so "orphan" (degree=0) is never meaningful there.
}) {
  const [newGroupQuery, setNewGroupQuery] = useState('');

  const addGroup = () => {
    if (!newGroupQuery.trim()) return;
    const color = SWATCH_COLORS[colorGroups.length % SWATCH_COLORS.length];
    onColorGroupsChange([...colorGroups, { id: crypto.randomUUID(), query: newGroupQuery.trim(), color }]);
    setNewGroupQuery('');
  };

  const removeGroup = (id) => onColorGroupsChange(colorGroups.filter((g) => g.id !== id));

  return (
    <div className="px-3 py-2 border-b border-[var(--card-border,#f3f4f6)] flex flex-col gap-2 flex-shrink-0">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="type:workflow owner:me date:>2026-01-01"
        className="w-full h-7 px-2 text-[11px] rounded-md border border-[var(--card-border,#e5e7eb)] focus:outline-none focus:border-[var(--n400,#9ca3af)]"
      />

      <div className="flex flex-wrap items-center gap-1">
        {colorGroups.map((g) => (
          <span
            key={g.id}
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full text-white"
            style={{ backgroundColor: g.color }}
          >
            {g.query}
            <button onClick={() => removeGroup(g.id)} className="hover:opacity-70">
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          value={newGroupQuery}
          onChange={(e) => setNewGroupQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
          placeholder="+ color group query"
          className="h-5 px-1.5 text-[10px] rounded-md border border-dashed border-[var(--card-border,#e5e7eb)] w-28 focus:outline-none"
        />
        <button onClick={addGroup} className="text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)]">
          <Plus size={12} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--n500,#6b7280)] cursor-pointer">
          <input type="checkbox" checked={showArrows} onChange={(e) => onShowArrowsChange(e.target.checked)} />
          Hiện chiều mũi tên
        </label>
        {onOrphanOnlyChange && (
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--n500,#6b7280)] cursor-pointer">
            <input type="checkbox" checked={orphanOnly} onChange={(e) => onOrphanOnlyChange(e.target.checked)} />
            Chỉ orphan (degree 0)
          </label>
        )}
      </div>
    </div>
  );
}
