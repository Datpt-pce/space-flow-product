import { useEffect, useState } from 'react';
import { X, Folder, File as FileIcon, ChevronRight, ChevronUp, ChevronDown, HardDrive, Home, List, LayoutGrid } from 'lucide-react';
import { useStore } from '../store.js';
import { listDir } from '../lib/api.js';

function rootIcon(id) {
  if (id === 'home') return Home;
  if (id?.startsWith('drive-')) return HardDrive;
  return Folder;
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fileType(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : 'File';
}

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'mtime', label: 'Date modified' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
];

export default function FolderBrowserModal() {
  const request = useStore(s => s.folderBrowserRequest);
  const resolveFolderBrowser = useStore(s => s.resolveFolderBrowser);

  const [roots, setRoots] = useState([]);
  const [root, setRoot] = useState(null);
  const [dir, setDir] = useState('');
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [entries, setEntries] = useState([]);
  const [absPath, setAbsPath] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [viewMode, setViewMode] = useState('list');

  const isOpen = !!request;
  const mode = request?.mode;
  const filter = request?.filter;

  const cancel = () => resolveFolderBrowser(null);

  useEffect(() => {
    if (!isOpen) return;
    setRoot(null);
    setDir('');
    setSelectedFile(null);
    setError(null);
    listDir().then(r => setRoots(r.roots || [])).catch(() => setRoots([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !root) return;
    setLoading(true);
    setSelectedFile(null);
    listDir(root, dir, filter)
      .then(r => {
        if (r.error) { setError(r.error); setEntries([]); setBreadcrumb([]); setAbsPath(null); return; }
        setError(null);
        setEntries(r.entries || []);
        setBreadcrumb(r.breadcrumb || []);
        setAbsPath(r.absPath || null);
      })
      .catch(() => setError('Không thể tải danh sách thư mục'))
      .finally(() => setLoading(false));
  }, [isOpen, root, dir, filter]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const openEntry = (entry) => {
    if (entry.type === 'dir') { setDir(entry.dir); return; }
    if (mode === 'file' && entry.matchesFilter) setSelectedFile(entry.name);
  };

  const confirm = () => {
    if (!absPath) return;
    if (mode === 'folder') resolveFolderBrowser(absPath);
    else if (selectedFile) resolveFolderBrowser(`${absPath.replace(/\/+$/, '')}/${selectedFile}`);
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'mtime') cmp = (a.mtime || '').localeCompare(b.mtime || '');
    else if (sortKey === 'type') cmp = (a.type === 'dir' ? '' : fileType(a.name)).localeCompare(b.type === 'dir' ? '' : fileType(b.name));
    else if (sortKey === 'size') cmp = (a.size || 0) - (b.size || 0);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden" style={{ width: 900, height: 600 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {mode === 'file' ? 'Chọn file' : 'Chọn thư mục'}
          </h2>
          <button onClick={cancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <div className="w-[180px] flex-shrink-0 border-r border-gray-100 overflow-y-auto py-3 px-2">
            <p className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Vị trí</p>
            {roots.length === 0 && (
              <p className="px-2 py-2 text-xs text-gray-400">Không có thư mục nào khả dụng để duyệt.</p>
            )}
            {roots.map(r => {
              const Icon = rootIcon(r.id);
              const active = root === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => { setRoot(r.id); setDir(''); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors
                    ${active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <Icon size={15} className={active ? 'text-blue-500 flex-shrink-0' : 'text-gray-400 flex-shrink-0'} />
                  <span className="truncate">{r.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right pane */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar: breadcrumb + view toggle */}
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-100">
              <div className="flex items-center gap-1 text-xs text-gray-500 overflow-x-auto whitespace-nowrap min-w-0">
                {root ? (
                  <>
                    <button className="hover:text-gray-800" onClick={() => setRoot(null)}>Root</button>
                    {breadcrumb.map((b, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <ChevronRight size={12} />
                        <button className="hover:text-gray-800" onClick={() => setDir(b.dir)}>{b.name}</button>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-gray-400">Chọn một vị trí bên trái để bắt đầu duyệt.</span>
                )}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0 rounded-lg border border-gray-200 p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`w-6 h-6 flex items-center justify-center rounded-md ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-700'}`}
                  title="Danh sách"
                >
                  <List size={13} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`w-6 h-6 flex items-center justify-center rounded-md ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-700'}`}
                  title="Lưới"
                >
                  <LayoutGrid size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {!root ? (
                <p className="px-3 py-4 text-sm text-gray-400">
                  {roots.length === 0
                    ? 'Không có thư mục nào khả dụng để duyệt.'
                    : 'Chọn ổ đĩa/thư mục bên trái để bắt đầu duyệt.'}
                </p>
              ) : loading ? (
                <p className="px-3 py-4 text-sm text-gray-400">Đang tải…</p>
              ) : error ? (
                <p className="px-3 py-4 text-sm text-red-500">{error}</p>
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-4 gap-3 p-1">
                  {sortedEntries.length === 0 && (
                    <p className="col-span-4 px-3 py-4 text-sm text-gray-400">Thư mục trống.</p>
                  )}
                  {sortedEntries.map(e => (
                    <button
                      key={e.dir}
                      onClick={() => openEntry(e)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-colors
                        ${selectedFile === e.name ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}
                        ${e.type === 'file' && (mode !== 'file' || !e.matchesFilter) ? 'opacity-40 pointer-events-none' : ''}`}
                    >
                      {e.type === 'dir'
                        ? <Folder size={40} className="text-gray-300 flex-shrink-0" />
                        : <FileIcon size={40} className="text-gray-300 flex-shrink-0" />}
                      <span className="text-xs truncate w-full">{e.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-gray-500 sticky top-0 bg-white">
                      {COLUMNS.map(col => (
                        <th
                          key={col.key}
                          onClick={() => toggleSort(col.key)}
                          className={`text-left font-medium px-3 py-1.5 cursor-pointer select-none hover:text-gray-800
                            ${col.key === 'name' ? 'w-[40%]' : col.key === 'mtime' ? 'w-[25%]' : col.key === 'type' ? 'w-[20%]' : 'w-[15%]'}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-sm text-gray-400">Thư mục trống.</td></tr>
                    )}
                    {sortedEntries.map(e => (
                      <tr
                        key={e.dir}
                        onClick={() => openEntry(e)}
                        className={`cursor-pointer transition-colors
                          ${selectedFile === e.name ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}
                          ${e.type === 'file' && (mode !== 'file' || !e.matchesFilter) ? 'opacity-40 pointer-events-none' : ''}`}
                      >
                        <td className="px-3 py-1.5 flex items-center gap-2 truncate">
                          {e.type === 'dir' ? <Folder size={15} className="text-gray-400 flex-shrink-0" /> : <FileIcon size={15} className="text-gray-400 flex-shrink-0" />}
                          <span className="truncate">{e.name}</span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{formatDate(e.mtime)}</td>
                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{e.type === 'dir' ? 'Thư mục' : fileType(e.name)}</td>
                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{e.type === 'dir' ? '—' : formatSize(e.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={cancel} className="px-3 h-8 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Hủy</button>
          <button
            onClick={confirm}
            disabled={!root || (mode === 'file' && !selectedFile)}
            className="px-3 h-8 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"
          >
            {mode === 'file' ? 'Chọn file này' : 'Chọn thư mục này'}
          </button>
        </div>
      </div>
    </div>
  );
}
