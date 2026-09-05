import { useEffect, useState } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { useVideoStore } from '../store.js';
import { createDefaultProjectPayload } from '../defaultProject.js';
import { videoWorkspaceRequest } from '../../lib/api.js';

export default function ProjectTimelines({ mode }) {
  const project = useVideoStore(s => s.project), pending = useVideoStore(s => s.pendingCommands);
  const [groups, setGroups] = useState([]), [error, setError] = useState(null);
  const refresh = () => videoWorkspaceRequest('/workspace-groups').then(setGroups).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [project?.id]);
  const group = groups.find(g => g.timelines.some(t => t.id === project?.id));
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
  async function rename(timeline) {
    const name = window.prompt('Tên timeline', timeline.name); if (!name?.trim() || name === timeline.name) return;
    try { await videoWorkspaceRequest(`/${timeline.id}`, { name }, 'PUT'); await refresh();
      if (timeline.id === project.id) useVideoStore.setState({ project: { ...project, name } });
    } catch (e) { setError(e.message); }
  }
  return <div className={`flex items-center gap-1 min-w-0 ${mode === 'timeline' ? 'shrink-0 border-b border-[var(--card-border)] px-2 pt-2' : ''}`}>
    {mode === 'project' ? <><FolderOpen size={14} /><select aria-label="Project đang mở" value={group?.id || ''} className="min-w-0 max-w-56 bg-transparent text-xs font-medium" onChange={e => { const first = groups.find(g => g.id === e.target.value)?.timelines[0]; if (first) open(first.id); }}>
      {!group && <option value="">{project?.name || 'Project'}</option>}{groups.filter(g => g.timelines.length).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select></> : <div role="tablist" aria-label="Timeline trong project" className="flex gap-1 overflow-x-auto min-w-0">
      {(group?.timelines || (project ? [project] : [])).map(t => <button type="button" key={t.id} role="tab" aria-selected={t.id === project?.id} onClick={() => open(t.id)} onDoubleClick={() => rename(t)} title="Nhấp đúp để đổi tên timeline"
        className={`shrink-0 px-3 py-2 text-xs border-b-2 ${t.id === project?.id ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--n600)]'}`}>{t.name}</button>)}
    </div>}
    <button type="button" onClick={create} aria-label={mode === 'project' ? 'Tạo project' : 'Thêm timeline'} title={mode === 'project' ? 'Tạo project' : 'Thêm timeline'} className="p-2 shrink-0 rounded hover:bg-[var(--accent-tint)]"><Plus size={14} /></button>
    {error && <button role="alert" className="text-xs text-[var(--video-error)]" onClick={() => setError(null)}>{error}</button>}
  </div>;
}
