import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, FolderOpen, ChevronDown, X } from 'lucide-react';
import { useVideoStore } from '../store.js';
import { createDefaultProjectPayload } from '../defaultProject.js';
import { videoWorkspaceRequest } from '../../lib/api.js';
import { useViewportMenu } from './useViewportMenu.js';

export default function ProjectTimelines({ mode }) {
  const project = useVideoStore(s => s.project), pending = useVideoStore(s => s.pendingCommands);
  const version = useVideoStore(s => s.workspaceGroupsVersion);
  const [groups, setGroups] = useState([]), [error, setError] = useState(null);
  const [editing, setEditing] = useState(null), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const editRef = useRef(null), savingRef = useRef(false);
  const stripRef = useRef(null), measureRef = useRef(null), menuRef = useRef(null), overflowRef = useRef(null);
  const [layout, setLayout] = useState({ available: 0, widths: [] });
  const [menu, setMenu] = useState(null);
  const refresh = () => videoWorkspaceRequest('/workspace-groups').then(setGroups).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [project?.id, version]);
  const group = groups.find(g => g.timelines.some(t => t.id === project?.id));
  const entries = useMemo(() => mode === 'project'
    ? (groups.some(g => g.timelines.length) ? groups.filter(g => g.timelines.length).map(g => ({ key: g.id, id: g.timelines.find(t => t.id === project?.id)?.id || g.timelines[0].id, name: g.name, count: g.timelines.length, standalone: g.id.startsWith('standalone:') }))
      : project ? [{ ...project, key: `standalone:${project.id}`, standalone: true, count: 1 }] : [])
    : (groups.find(g => g.timelines.some(t => t.id === project?.id))?.timelines || (project ? [project] : [])).map(t => ({ ...t, key: t.id })), [groups, mode, project?.id, project?.name]);
  const activeKey = mode === 'project' ? group?.id || `standalone:${project?.id}` : project?.id;
  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled || !stripRef.current || !measureRef.current) return;
      const available = stripRef.current.clientWidth;
      const widths = [...measureRef.current.children].map(node => Math.ceil(node.getBoundingClientRect().width));
      setLayout(previous => previous.available === available && previous.widths.length === widths.length && widths.every((width, i) => width === previous.widths[i]) ? previous : { available, widths });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stripRef.current); observer.observe(measureRef.current);
    document.fonts?.ready.then(measure);
    return () => { cancelled = true; observer.disconnect(); };
  }, [entries]);
  const widthOf = entry => layout.widths[entries.indexOf(entry)] || 100;
  const totalWidth = entries.reduce((sum, entry) => sum + widthOf(entry) + 4, -4);
  const budget = Math.max(0, layout.available - (totalWidth > layout.available ? 36 : 0));
  const visible = [];
  let used = 0;
  for (const entry of entries) {
    const width = widthOf(entry) + (visible.length ? 4 : 0);
    if (used + width > budget) break;
    visible.push(entry); used += width;
  }
  const priority = entries.find(entry => entry.key === (editing?.key || activeKey)) || entries[0];
  if (priority && !visible.includes(priority)) {
    while (visible.length && used + widthOf(priority) + 4 > budget) {
      used -= widthOf(visible.pop()) + (visible.length ? 4 : 0);
    }
    visible.push(priority);
  }
  const shown = entries.filter(entry => visible.includes(entry));
  const hidden = entries.filter(entry => !visible.includes(entry));
  useViewportMenu(menuRef, menu, setMenu);
  useEffect(() => {
    if (!menu) return undefined;
    const outside = e => { if (!menuRef.current?.contains(e.target) && !overflowRef.current?.contains(e.target)) setMenu(null); };
    const escape = e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); overflowRef.current?.focus(); } };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    menuRef.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [!!menu]);
  useEffect(() => { if (!hidden.length) setMenu(null); }, [hidden.length]);
  async function open(id) {
    if (pending.length) { setError('Chờ lưu các chỉnh sửa trước khi chuyển timeline.'); return; }
    await useVideoStore.getState().openProject(id);
  }
  async function create() {
    try {
      if (pending.length) throw new Error('Chờ lưu các chỉnh sửa trước khi tạo timeline.');
      const name = window.prompt(mode === 'project' ? 'Tên project mới' : 'Tên timeline mới', mode === 'project' ? 'Project mới' : `Timeline ${(group?.timelines.length || 1) + 1}`);
      if (!name?.trim()) return;
      const result = await videoWorkspaceRequest(mode === 'project' ? '' : `/${project.id}/sibling`, { name, payload: createDefaultProjectPayload() });
      await open(result.id); await refresh();
    } catch (e) { setError(e.message); }
  }
  function beginRename(target) {
    if (busy || pending.length || !target) return;
    editRef.current = target; setEditing(target); setDraft(target.name); setError(null); setMenu(null);
  }
  function cancelRename() { editRef.current = null; setEditing(null); }
  async function saveRename() {
    const target = editRef.current, name = draft.trim();
    if (!target || savingRef.current) return;
    if (!name) { setError('Tên không được để trống.'); return; }
    if (name === target.name) { cancelRename(); return; }
    savingRef.current = true; setBusy(true); setError(null);
    try {
      await videoWorkspaceRequest(mode === 'project' ? `/${target.id}/workspace-group` : `/${target.id}`, { name }, 'PUT');
      useVideoStore.setState(s => ({ workspaceGroupsVersion: s.workspaceGroupsVersion + 1,
        project: s.project?.id === target.id && (mode === 'timeline' || target.standalone) ? { ...s.project, name } : s.project }));
      cancelRename();
    } catch (e) { setError(e.message); }
    finally { savingRef.current = false; setBusy(false); }
  }
  async function remove(target) {
    if (busy || pending.length) return;
    const label = mode === 'project' ? `project "${target.name}" và ${target.count} timeline` : `timeline "${target.name}"`;
    if (!window.confirm(`Chuyển ${label} vào thùng rác? Có thể khôi phục các timeline từ Thùng rác.`)) return;
    setBusy(true); setError(null);
    try { await useVideoStore.getState().deleteProject(target.id, { workspace: mode === 'project' }); setMenu(null); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const nameInput = <input aria-label={mode === 'project' ? 'Tên project' : 'Tên timeline'} value={draft} maxLength={200}
    autoFocus onFocus={e => e.target.select()} disabled={busy} onChange={e => setDraft(e.target.value)} onBlur={saveRename}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); saveRename(); } if (e.key === 'Escape') { e.preventDefault(); cancelRename(); } }}
    className="min-w-0 flex-1 bg-transparent text-xs px-3 py-2 border rounded border-[var(--accent)] outline-none" />;
  function tab(entry, inMenu = false) {
    return <div key={entry.key} data-workspace-tab={entry.key} className={`group flex items-center shrink-0 min-w-0 text-xs font-medium ${inMenu ? '' : `border-b-2 ${entry.key === activeKey ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--n600)]'}`}`}
      style={inMenu ? undefined : { width: Math.min(widthOf(entry), budget) }}>
      {!inMenu && editing?.key === entry.key ? nameInput : <button type="button" id={!inMenu ? `workspace-${mode}-${entry.key}` : undefined} data-workspace-name role={inMenu ? 'menuitem' : mode === 'timeline' ? 'tab' : undefined} aria-selected={!inMenu && mode === 'timeline' ? entry.key === activeKey : undefined} aria-current={!inMenu && mode === 'project' && entry.key === activeKey ? 'page' : undefined}
        tabIndex={inMenu || entry.key === activeKey ? 0 : -1} disabled={busy}
        onClick={() => { if (entry.id !== project?.id) open(entry.id); setMenu(null); }}
        onDoubleClick={() => beginRename(entry)}
        onKeyDown={e => {
          if (e.key === 'F2') { e.preventDefault(); beginRename(entry); }
          if (!inMenu && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); e.stopPropagation();
            const tabs = [...stripRef.current.querySelectorAll('[data-workspace-name]')], index = tabs.indexOf(e.currentTarget);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next]?.focus();
          }
        }}
        draggable={mode === 'timeline' && entry.id !== project?.id && !pending.length}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-video-timeline', JSON.stringify({ projectId: entry.id, name: entry.name })); }}
        title={entry.name} className="flex-1 min-w-0 truncate px-3 py-2 text-left rounded hover:bg-[var(--accent-tint)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]">{entry.name}</button>}
      <button type="button" aria-label={`Xoá ${mode} "${entry.name}"`} title={`Xoá ${mode} "${entry.name}"`} disabled={busy || !!pending.length}
        onClick={e => { e.stopPropagation(); remove(entry); }}
        className="w-6 h-6 mr-1 shrink-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--accent-tint)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><X size={12} /></button>
    </div>;
  }
  return <div data-tab-strip={mode} className={`relative flex flex-1 items-center gap-1 min-w-0 ${mode === 'timeline' ? 'border-b border-[var(--card-border)] px-2 pt-2' : ''}`}>
    {mode === 'project' && <FolderOpen size={14} className="shrink-0" />}
    <div className="absolute left-0 top-0 h-0 max-w-full overflow-hidden invisible pointer-events-none" aria-hidden="true">
      <div ref={measureRef} className="flex w-max text-xs font-medium">{entries.map(entry => <span key={entry.key} className="inline-flex shrink-0 items-center"><span className="max-w-40 truncate px-3 py-2">{entry.name}</span><span className="w-6 mr-1 shrink-0" /></span>)}</div>
    </div>
    {/* Only tabs belong to a tablist. Close/overflow buttons and the inline
        editor remain in the row's group, outside that accessibility ownership. */}
    {mode === 'timeline' && shown.some(entry => entry.key !== editing?.key) && <div role="tablist" aria-label="Timelines" className="contents"
      aria-owns={shown.filter(entry => entry.key !== editing?.key).map(entry => `workspace-timeline-${entry.key}`).join(' ')} />}
    <div ref={stripRef} role={mode === 'project' ? 'navigation' : 'group'} aria-label={mode === 'project' ? 'Projects' : 'Timeline trong project'} className="flex flex-1 items-center gap-1 min-w-0 overflow-hidden">
      {shown.map(entry => tab(entry))}
      {hidden.length > 0 && <button ref={overflowRef} type="button" aria-label={mode === 'project' ? 'Project khác' : 'Timeline khác'} aria-haspopup="menu" aria-expanded={!!menu}
        onClick={() => { const rect = overflowRef.current.getBoundingClientRect(); setMenu(menu ? null : { x: rect.left, y: mode === 'timeline' ? Math.max(8, rect.top - Math.min(hidden.length * 36 + 8, 320)) : rect.bottom + 4 }); }}
        className="w-8 h-8 shrink-0 flex items-center justify-center rounded hover:bg-[var(--accent-tint)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"><ChevronDown size={14} /></button>}
    </div>
    <button type="button" onClick={create} disabled={busy || !!pending.length} aria-label={mode === 'project' ? 'Tạo project' : 'Thêm timeline'} title={mode === 'project' ? 'Tạo project' : 'Thêm timeline'} className="p-2 shrink-0 rounded hover:bg-[var(--accent-tint)] disabled:opacity-40"><Plus size={14} /></button>
    {error && <button role="alert" className="absolute top-full left-0 z-50 max-w-full rounded bg-[var(--card)] border border-[var(--card-border)] p-2 text-xs text-[var(--video-error)]" onClick={() => setError(null)}>{error}</button>}
    {menu && hidden.length > 0 && createPortal(<div ref={menuRef} role="menu" aria-label={mode === 'project' ? 'Project vượt chiều ngang' : 'Timeline vượt chiều ngang'}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setMenu(null); overflowRef.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')], index = items.indexOf(document.activeElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
      className="fixed z-[9999] w-64 max-w-[calc(100vw-16px)] max-h-80 overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--card)] shadow-xl py-1" style={{ left: menu.x, top: menu.y }}>{hidden.map(entry => tab(entry, true))}</div>, document.body)}
  </div>;
}
