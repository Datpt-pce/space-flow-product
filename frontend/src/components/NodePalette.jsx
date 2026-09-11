import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Star } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';

const CATEGORY_ORDER = ['trigger', 'input', 'image', 'ai', 'data', 'output', 'control'];

export default function NodePalette() {
  const isPaletteOpen = useStore(s => s.isPaletteOpen);
  const paletteInsertPosition = useStore(s => s.paletteInsertPosition);
  const closePalette = useStore(s => s.closePalette);
  const nodeManifests = useStore(s => s.nodeManifests);
  const addNodeToCanvas = useStore(s => s.addNodeToCanvas);
  const favoriteNodeIds = useStore(s => s.favoriteNodeIds);
  const toggleFavoriteNode = useStore(s => s.toggleFavoriteNode);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef(null);

  const allManifests = useMemo(() => Object.values(nodeManifests), [nodeManifests]);

  const filtered = useMemo(() => {
    const base = allManifests.filter(m => {
      const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.description?.toLowerCase().includes(search.toLowerCase());
      const matchCat = !activeCategory || m.category === activeCategory;
      return matchSearch && matchCat;
    });
    const favs = base.filter(m => favoriteNodeIds.includes(m.id));
    const others = base.filter(m => !favoriteNodeIds.includes(m.id));
    return [...favs, ...others];
  }, [allManifests, search, activeCategory, favoriteNodeIds]);

  const favouriteItems = useMemo(
    () => filtered.filter(m => favoriteNodeIds.includes(m.id)),
    [filtered, favoriteNodeIds]
  );

  const grouped = useMemo(() => {
    const g = {};
    for (const m of filtered) {
      if (favoriteNodeIds.includes(m.id)) continue;
      if (!g[m.category]) g[m.category] = [];
      g[m.category].push(m);
    }
    return g;
  }, [filtered, favoriteNodeIds]);

  const categories = useMemo(
    () => CATEGORY_ORDER.filter(c => allManifests.some(m => m.category === c)),
    [allManifests]
  );

  const handleAdd = (manifest) => {
    const position = paletteInsertPosition ?? {
      x: 300 + Math.random() * 200,
      y: 150 + Math.random() * 150,
    };
    addNodeToCanvas(manifest, position);
    closePalette();
  };

  // Reset state when palette opens
  useEffect(() => {
    if (isPaletteOpen) {
      setSearch('');
      setActiveCategory(null);
      setFocusedIndex(-1);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isPaletteOpen]);

  // Reset focusedIndex when filtered list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [search, activeCategory]);

  // Keyboard navigation
  useEffect(() => {
    if (!isPaletteOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { closePalette(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && filtered[focusedIndex]) {
        e.preventDefault();
        handleAdd(filtered[focusedIndex]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPaletteOpen, closePalette, filtered, focusedIndex]);

  if (!isPaletteOpen) return null;

  const onDragStart = (e, manifest) => {
    e.dataTransfer.setData('application/space-flow-node', manifest.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Flat list index for keyboard nav highlight
  let flatIndex = 0;

  const renderItem = (m, color) => {
    const myIndex = flatIndex++;
    const isFocused = myIndex === focusedIndex;
    const isFavorite = favoriteNodeIds.includes(m.id);
    return (
      <div
        key={m.id}
        draggable
        onDragStart={e => onDragStart(e, m)}
        onClick={() => handleAdd(m)}
        className={`mx-2 mb-0.5 px-3 py-2 rounded-xl cursor-pointer transition-colors flex items-center gap-3 group ${
          isFocused ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-[var(--n50,#f9fafb)] active:bg-[var(--n100,#f3f4f6)]'
        }`}
      >
        <div
          className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
          style={{ background: color + '18' }}
        >
          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[var(--n800,#1f2937)] group-hover:text-[var(--text,#111827)] leading-tight">
            {m.name}
          </div>
          <div className="text-[10px] text-[var(--n400,#9ca3af)] truncate leading-tight mt-0.5">
            {m.description}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); toggleFavoriteNode(m.id); }}
          className={`flex-shrink-0 p-1 rounded transition-opacity ${
            isFavorite ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-[var(--n300,#d1d5db)] hover:text-amber-400'
          }`}
          title={isFavorite ? 'Bỏ khỏi Favourites' : 'Đánh dấu Favourite'}
        >
          <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40" onClick={closePalette} />

      {/* Palette panel */}
      <div
        className="absolute z-50 bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 280, maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--card-border,#f3f4f6)]">
          <Search size={14} className="text-[var(--n400,#9ca3af)] flex-shrink-0" />
          <input
            ref={searchRef}
            className="flex-1 text-sm text-[var(--sub,#374151)] placeholder-[var(--n400,#9ca3af)] outline-none bg-transparent"
            placeholder="Search nodes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)]">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category filter row */}
        {categories.length > 1 && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--card-border,#f3f4f6)] overflow-x-auto no-scrollbar">
            <button
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                !activeCategory ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]' : 'text-[var(--n500,#6b7280)] hover:bg-[var(--n100,#f3f4f6)]'
              }`}
              onClick={() => setActiveCategory(null)}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap capitalize ${
                  activeCategory === cat ? 'text-white' : 'text-[var(--n500,#6b7280)] hover:bg-[var(--n100,#f3f4f6)]'
                }`}
                style={activeCategory === cat ? { background: CATEGORY_COLORS[cat] } : {}}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Node list */}
        <div className="flex-1 overflow-y-auto py-2">
          {favouriteItems.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--n400,#9ca3af)] flex items-center gap-1">
                <Star size={10} className="text-amber-400" fill="currentColor" />
                Favourites
              </div>
              {favouriteItems.map(m => renderItem(m, CATEGORY_COLORS[m.category]))}
            </div>
          )}

          {CATEGORY_ORDER.map(cat => {
            const items = grouped[cat];
            if (!items?.length) return null;
            const color = CATEGORY_COLORS[cat];

            return (
              <div key={cat}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--n400,#9ca3af)]">
                  {cat}
                </div>
                {items.map(m => renderItem(m, color))}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--n400,#9ca3af)]">
              No nodes found
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-3 py-2 border-t border-[var(--card-border,#f3f4f6)] text-[10px] text-[var(--n400,#9ca3af)]">
          <span><kbd className="bg-[var(--n100,#f3f4f6)] px-1.5 py-0.5 rounded text-[10px]">Tab</kbd> Toggle</span>
          <span><kbd className="bg-[var(--n100,#f3f4f6)] px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> Close</span>
          <span>↑↓ Navigate</span>
          <span>↵ Insert</span>
        </div>
      </div>
    </>
  );
}
