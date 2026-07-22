import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store.js';
import {
  resolveDrop,
  saveResizeUploadApp, deleteResizeUploadApp,
  asanaTasks, asanaInspect,
} from '../lib/api.js';

export const inputCls = "w-full h-7 px-2 rounded-md border border-gray-200 text-[11px] text-gray-700 bg-white focus:outline-none focus:border-red-400";
export const labelCls = "text-[9px] text-gray-400 uppercase tracking-wide mb-1";

export const STATUS_COLORS = { running: '#f59e0b', done: '#22c55e', error: '#ef4444' };
export const PORT_COLOR = '#ef4444';

export const MODES = [
  { value: '8_sizes', label: '8 kích thước' },
  { value: '3_sizes', label: '3 kích thước' },
  { value: '4_sizes_meta', label: '4 size Meta' },
];

export const BG_STYLES = [
  { value: 'color', label: 'Màu nền' },
  { value: 'blur', label: 'Blur' },
  { value: 'scale_fill', label: 'Scale fill' },
  { value: 'none', label: 'Không' },
];

export function countReachable(nodes, edges, startId) {
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const nid = queue.shift();
    if (visited.has(nid)) continue;
    visited.add(nid);
    for (const next of (adj[nid] || [])) queue.push(next);
  }
  return visited.size;
}

export async function resolveDropPaths(e) {
  const text = e.dataTransfer.getData('text/plain');
  if (text) return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const internal = e.dataTransfer.getData('space-flow-file');
  if (internal) return [internal];

  const names = [];
  const dtItems = e.dataTransfer.items;
  if (dtItems && dtItems.length > 0) {
    for (let i = 0; i < dtItems.length; i++) {
      const it = dtItems[i];
      if (it.kind !== 'file') continue;
      const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (entry) names.push(entry.name);
      else {
        const f = it.getAsFile();
        if (f) names.push(f.name);
      }
    }
  } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    Array.from(e.dataTransfer.files).forEach(f => names.push(f.name));
  }
  if (!names.length) return [];
  const { paths } = await resolveDrop(names);
  return paths || [];
}

export function basename(p) {
  return (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
}

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="nodrag flex-shrink-0 px-1.5 py-0.5 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-500 hover:bg-gray-200 transition-colors"
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}

export function Modal({ title, onClose, width = 480, children }) {
  return (
    <div className="nodrag fixed inset-0 z-[10000] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-[80vh] flex flex-col"
        style={{ width }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-[12px] font-semibold text-gray-700">{title}</span>
          <button className="p-1 rounded-md hover:bg-gray-100 text-gray-400" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}

export function AppManagerModal({ apps, onClose, onReload }) {
  const pickFolder = useStore(s => s.pickFolder);
  const [selectedTag, setSelectedTag] = useState(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [thumbFolder, setThumbFolder] = useState('');
  const [pinned, setPinned] = useState(false);
  const tags = Object.keys(apps).sort();

  const select = (tag) => {
    setSelectedTag(tag);
    const d = apps[tag] || {};
    setName(tag); setFolder(d.folder || ''); setThumbFolder(d.thumbnail_folder || ''); setPinned(!!d.pinned);
  };

  const save = async () => {
    if (!name.trim()) return;
    await saveResizeUploadApp({ tag: name.trim(), original_tag: selectedTag, folder, thumbnail_folder: thumbFolder, pinned });
    onReload();
    setSelectedTag(name.trim());
  };
  const remove = async () => {
    if (!selectedTag) return;
    await deleteResizeUploadApp(selectedTag);
    setSelectedTag(null); setName(''); setFolder(''); setThumbFolder(''); setPinned(false);
    onReload();
  };
  const duplicate = async () => {
    if (!selectedTag) return;
    let newTag = `${selectedTag} Copy`, i = 2;
    while (apps[newTag]) { newTag = `${selectedTag} Copy ${i}`; i++; }
    await saveResizeUploadApp({ tag: newTag, folder: apps[selectedTag].folder, thumbnail_folder: apps[selectedTag].thumbnail_folder, pinned: apps[selectedTag].pinned });
    onReload();
  };
  const handlePickFolder = async (setter) => { const path = await pickFolder(); if (path) setter(path); };

  return (
    <Modal title="Quản lý App (UNC)" width={620} onClose={onClose}>
      <div className="flex gap-3">
        <div className="w-40 flex-shrink-0 border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
          {tags.map(t => (
            <div key={t} onClick={() => select(t)} className={`px-2 py-1 text-[10px] cursor-pointer truncate ${selectedTag === t ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50 text-gray-600'}`}>
              {apps[t]?.pinned ? '⭐ ' : ''}{t}
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <input className={inputCls} placeholder="Tên App" value={name} onChange={e => setName(e.target.value)} />
          <div className="flex gap-1">
            <input className={inputCls} placeholder="UNC folder" value={folder} onChange={e => setFolder(e.target.value)} />
            <button className="px-2 h-7 rounded-md bg-gray-100 text-[9px]" onClick={() => handlePickFolder(setFolder)}>…</button>
          </div>
          <div className="flex gap-1">
            <input className={inputCls} placeholder="Thumbnail folder" value={thumbFolder} onChange={e => setThumbFolder(e.target.value)} />
            <button className="px-2 h-7 rounded-md bg-gray-100 text-[9px]" onClick={() => handlePickFolder(setThumbFolder)}>…</button>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} className="w-3 h-3 accent-red-500" />
            <span className="text-[10px] text-gray-600">⭐ Ghim App</span>
          </label>
          <div className="flex gap-1 mt-1">
            <button className="flex-1 py-1.5 rounded-md bg-red-600 text-white text-[10px] font-semibold hover:bg-red-700" onClick={save}>Lưu</button>
            <button className="flex-1 py-1.5 rounded-md bg-gray-100 text-[10px] font-semibold text-gray-600 hover:bg-gray-200" onClick={duplicate}>Nhân bản</button>
            <button className="flex-1 py-1.5 rounded-md bg-red-50 text-[10px] font-semibold text-red-600 hover:bg-red-100" onClick={remove}>Xoá</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ChannelManagerModal({ settings, onSave, onClose }) {
  const [channels, setChannels] = useState(settings.gcs_google_channels_list || []);
  const [val, setVal] = useState('');
  const add = () => {
    const v = val.trim();
    if (!v || channels.includes(v)) return;
    const next = [...channels, v];
    setChannels(next); setVal('');
    onSave({ ...settings, gcs_google_channels_list: next });
  };
  const remove = (c) => {
    const next = channels.filter(x => x !== c);
    setChannels(next);
    onSave({ ...settings, gcs_google_channels_list: next });
  };
  return (
    <Modal title="Quản lý Kênh (GCS Google Parent)" width={360} onClose={onClose}>
      <div className="border border-gray-100 rounded-lg max-h-48 overflow-y-auto mb-2">
        {channels.map(c => (
          <div key={c} className="flex items-center justify-between px-2 py-1 hover:bg-gray-50">
            <span className="text-[10px] text-gray-600">{c}</span>
            <button onClick={() => remove(c)} className="text-gray-300 hover:text-red-500"><X size={11} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        <input className={inputCls} placeholder="Tên kênh mới" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="px-2 h-7 rounded-md bg-red-50 text-red-600 text-[9px] font-semibold hover:bg-red-100" onClick={add}>Thêm</button>
      </div>
    </Modal>
  );
}

export function TaskSelectorModal({ pat, onInsert, onClose, usedUrls = {} }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (!pat) { setLoading(false); return; }
    asanaTasks(pat).then(r => { setTasks(r.tasks || []); setLoading(false); });
  }, [pat]);

  const toggle = (url) => {
    if (usedUrls[url]) return;
    const next = new Set(selected);
    next.has(url) ? next.delete(url) : next.add(url);
    setSelected(next);
  };
  const confirm = () => { onInsert([...selected]); onClose(); };

  return (
    <Modal title="Chọn Task từ Asana (7 ngày gần nhất, chưa xong)" width={500} onClose={onClose}>
      {!pat && <div className="text-[10px] text-gray-400">Nhập Asana PAT trước.</div>}
      {pat && loading && <div className="text-[10px] text-gray-400">Đang tải...</div>}
      {pat && !loading && tasks.length === 0 && <div className="text-[10px] text-gray-400">Không tìm thấy task nào.</div>}
      <div className="max-h-72 overflow-y-auto">
        {tasks.map((t, i) => {
          const usedRow = usedUrls[t.permalink_url];
          return (
            <label key={i} className={`flex items-center gap-2 px-1 py-1 ${usedRow ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}>
              <input type="checkbox" disabled={!!usedRow} checked={selected.has(t.permalink_url)} onChange={() => toggle(t.permalink_url)} className="w-3 h-3 accent-red-500" />
              <span className="text-[10px] text-gray-600 truncate">[{t.project}] {t.name}</span>
              {usedRow && <span className="text-[9px] text-amber-500 ml-auto flex-shrink-0">Đã dùng ở dòng {usedRow}</span>}
            </label>
          );
        })}
      </div>
      {tasks.length > 0 && (
        <button className="w-full mt-2 py-1.5 rounded-md bg-red-600 text-white text-[10px] font-semibold hover:bg-red-700" onClick={confirm}>Chọn ({selected.size})</button>
      )}
    </Modal>
  );
}

export function InspectFieldsModal({ pat, taskUrl, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pat || !taskUrl) { setError('Nhập PAT và ít nhất một Task URL.'); return; }
    asanaInspect(pat, taskUrl).then(r => (r.error ? setError(r.error) : setData(r)));
  }, [pat, taskUrl]);

  return (
    <Modal title="Custom Fields của Task" width={560} onClose={onClose}>
      {error && <div className="text-[10px] text-red-500">{error}</div>}
      {data && (
        <div className="text-[10px] text-gray-600 font-mono whitespace-pre-wrap">
          <div className="font-semibold mb-1">--- FIELD TRÊN TASK ---</div>
          {data.fields_on_task.map((f, i) => (
            <div key={i} className="mb-1">{f.name} (GID: {f.gid}){f.value_name ? ` = ${f.value_name} (option: ${f.option_gid})` : ''}</div>
          ))}
          <div className="font-semibold mt-2 mb-1">--- FIELD TRONG PROJECT ---</div>
          {data.project_fields.map((f, i) => (
            <div key={i} className="mb-1">
              {f.name} (GID: {f.gid})
              {f.options.map((o, j) => <div key={j} className="pl-3 text-gray-400">- {o.name} (GID: {o.gid})</div>)}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
