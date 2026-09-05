import { useEffect, useState } from 'react';
import { X, Trash2, FolderOpen } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchWorkflows, updateWorkflow, deleteWorkflowFromLibrary } from '../lib/api.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function WorkflowLibraryModal() {
  const isOpen = useStore(s => s.isWorkflowLibraryOpen);
  const closeWorkflowLibrary = useStore(s => s.closeWorkflowLibrary);
  const saveCurrentToLibrary = useStore(s => s.saveCurrentToLibrary);
  const loadFromLibrary = useStore(s => s.loadFromLibrary);

  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [status, setStatus] = useState('idle'); // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('');

  const load = () => fetchWorkflows().then(setList).catch(() => setList([]));
  useEffect(() => { if (isOpen) load(); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeWorkflowLibrary(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeWorkflowLibrary]);

  if (!isOpen) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveCurrentToLibrary(name.trim(), visibility);
      if (res.error) throw new Error(res.error);
      setName('');
      setStatus('idle');
      load();
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleLoad = async (id) => {
    await loadFromLibrary(id);
    closeWorkflowLibrary();
  };

  const handleToggleVisibility = async (wf) => {
    await updateWorkflow(wf.id, { visibility: wf.visibility === 'team' ? 'private' : 'team' });
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xoá workflow này khỏi thư viện?')) return;
    await deleteWorkflowFromLibrary(id);
    load();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeWorkflowLibrary(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden"
        style={{ width: 560, height: 520 }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 className="text-base font-semibold text-[var(--text,#111827)]">Thư viện Workflow</h2>
          <button
            onClick={closeWorkflowLibrary}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          <form onSubmit={handleSave} className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider">Lưu canvas hiện tại</p>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Tên workflow"
                className="flex-1 h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
              />
              <select
                value={visibility}
                onChange={e => setVisibility(e.target.value)}
                className="h-8 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs"
              >
                <option value="private">Riêng tư</option>
                <option value="team">Chung cả team</option>
              </select>
              <button
                type="submit"
                disabled={status === 'saving' || !name.trim()}
                className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Lưu
              </button>
            </div>
            {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}
          </form>

          <div>
            <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">Đã lưu</p>
            {list.length === 0 ? (
              <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có workflow nào trong thư viện.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {list.map(wf => (
                  <div key={wf.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--sub,#374151)] truncate">{wf.name}</div>
                      <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">
                        {wf.isMine ? 'Của tôi' : wf.ownerName} · {formatDate(wf.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {wf.isMine ? (
                        <button
                          onClick={() => handleToggleVisibility(wf)}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${wf.visibility === 'team' ? 'bg-blue-50 text-blue-500 hover:bg-blue-100' : 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)] hover:bg-[var(--n200,#e5e7eb)]'}`}
                          title="Bấm để đổi phạm vi chia sẻ"
                        >
                          {wf.visibility === 'team' ? 'Chung' : 'Riêng tư'}
                        </button>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500">Chung</span>
                      )}
                      <button
                        onClick={() => handleLoad(wf.id)}
                        className="text-[var(--n400,#9ca3af)] hover:text-blue-500 p-1"
                        title="Load vào canvas"
                      >
                        <FolderOpen size={14} />
                      </button>
                      {wf.isMine && (
                        <button onClick={() => handleDelete(wf.id)} className="text-[var(--n300,#d1d5db)] hover:text-red-500 p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
