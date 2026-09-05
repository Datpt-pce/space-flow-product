import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, Star } from 'lucide-react';

const STORAGE_KEY = 've.fontFavourites';
function readFavourites() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(font => typeof font === 'string') : [];
  } catch { return []; }
}

export default function FontPicker({ value, fonts, onChange, disabled }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState(readFavourites), [position, setPosition] = useState(null);
  const triggerRef = useRef(null), popupRef = useRef(null), searchRef = useRef(null), id = useId();
  const available = [...new Set([value, ...fonts].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const matched = available.filter(font => font.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const favouriteFonts = matched.filter(font => favourites.includes(font));
  const otherFonts = matched.filter(font => !favourites.includes(font));
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); };
  useEffect(() => {
    const sync = event => { if (event.key === STORAGE_KEY) setFavourites(readFavourites()); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current.getBoundingClientRect(), margin = 8;
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - margin * 2);
      const below = window.innerHeight - rect.bottom - margin - 4, above = rect.top - margin - 4;
      const upwards = below < 240 && above > below;
      const height = Math.max(0, Math.min(380, upwards ? above : below));
      setPosition({ left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), width, maxHeight: height,
        ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
    };
    place();
    // Position state makes the initially hidden portal visible before focusing.
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    const outside = event => { if (!popupRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close(false); };
    const scroll = event => { if (!popupRef.current?.contains(event.target)) place(); };
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true);
    return () => { cancelAnimationFrame(focusFrame); window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  const star = font => {
    const next = favourites.includes(font) ? favourites.filter(item => item !== font) : [...favourites, font];
    setFavourites(next); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* In-memory preference still works in restricted storage. */ }
    searchRef.current?.focus();
  };
  const choose = font => { if (!disabled && font !== value) onChange(font); close(); };
  const section = (title, entries) => <section aria-label={title}>
    <div className="px-3 py-2 text-[11px] font-medium text-[var(--n600)]">{title}</div>
    {entries.map(font => <div key={font} className="flex items-center gap-1 px-1 hover:bg-[var(--accent-tint)] rounded-lg">
      <button type="button" data-font-choice={font} aria-label={`Chọn font ${font}`} aria-pressed={font === value}
        className="min-w-0 flex-1 flex items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => choose(font)}>
        <Check aria-hidden="true" size={14} className={`shrink-0 text-[var(--accent)] ${font === value ? '' : 'invisible'}`} /><span className="truncate" title={font}>{font}</span>
      </button>
      <button type="button" aria-label={`${favourites.includes(font) ? 'Bỏ' : 'Thêm'} Favourite ${font}`} aria-pressed={favourites.includes(font)} title={favourites.includes(font) ? 'Bỏ Favourite' : 'Thêm vào Favourite'}
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[var(--accent)] hover:bg-[var(--accent-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => star(font)}>
        <Star aria-hidden="true" size={15} fill={favourites.includes(font) ? 'currentColor' : 'none'} />
      </button>
    </div>)}
    {!entries.length && title === 'Favourite' && <p className="px-3 pb-2 text-[var(--n600)]">{query ? 'Không có Favourite phù hợp.' : 'Đánh dấu sao để lưu font yêu thích.'}</p>}
  </section>;
  return <div className="flex items-center justify-between gap-3 text-xs text-[var(--n600)]">
    <span>Phông chữ</span>
    <button ref={triggerRef} type="button" aria-label="Phông chữ" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      className="min-w-0 flex-1 h-8 flex items-center justify-between gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 text-[var(--text)] disabled:opacity-40"
      onClick={() => { if (open) close(); else { setQuery(''); setOpen(true); } }}><span className="truncate">{value}</span><ChevronDown aria-hidden="true" size={14} className="shrink-0" /></button>
    {open && !disabled && createPortal(<div ref={popupRef} id={id} role="dialog" aria-label="Chọn phông chữ" style={position || { visibility: 'hidden' }}
      className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)] text-xs text-[var(--text)] shadow-xl"
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) close(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          const buttons = [...popupRef.current.querySelectorAll('[data-font-choice]')], current = buttons.indexOf(document.activeElement);
          const next = current < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
          buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter' && event.target === searchRef.current && !event.nativeEvent.isComposing) { event.preventDefault(); const font = favouriteFonts[0] || otherFonts[0]; if (font) choose(font); }
      }}>
      <div className="shrink-0 p-2 border-b border-[var(--card-border)]"><label className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] px-2"><Search aria-hidden="true" size={14} className="text-[var(--n600)]" />
        <input ref={searchRef} aria-label="Tìm tên font" placeholder="Tìm tên font…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 w-full h-9 bg-transparent outline-none" />
      </label></div>
      <div className="min-h-0 overflow-y-auto p-1">
        {section('Favourite', favouriteFonts)}
        {otherFonts.length > 0 && section('Tất cả font', otherFonts)}
        {!matched.length && <p role="status" className="px-3 py-4 text-[var(--n600)]">Không tìm thấy font phù hợp.</p>}
      </div>
    </div>, document.body)}
  </div>;
}
