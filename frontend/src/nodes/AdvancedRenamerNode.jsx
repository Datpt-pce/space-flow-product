import { useState } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  Play, Trash2, Copy, Settings2, ChevronDown, Plus, X,
  GripVertical, AlertTriangle, Folder, File as FileIcon,
} from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls } from './resizable.jsx';

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const DEFAULT_ROW_H = 340;
const DEFAULT_W = 640;
const MIN_W = 480, MAX_W = 960, MIN_H = 260, MAX_H = 720;

const INPUT_CLS = 'nodrag w-full h-5 px-1.5 rounded border border-[var(--card-border,#e5e7eb)] text-[9px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-teal-400';

const METHOD_DEFAULTS = {
  Add:         { text: '', index: 0, backwards: false, apply_to: 'Name' },
  Swap:        { separator: '', occurrence: '1st', apply_to: 'Name' },
  ListReplace: { table_data: [['', '']], apply_to: 'Name' },
  FolderName:  { separator: '' },
};

function countReachable(nodes, edges, startId) {
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const next of (adj[nodeId] || [])) queue.push(next);
  }
  return visited.size;
}

function ListReplaceTable({ tableData, onChange }) {
  const rows = tableData.length ? tableData : [['', '']];
  const updateRow = (idx, col, val) => {
    const next = rows.map(r => [...r]);
    next[idx][col] = val;
    onChange(next);
  };
  const addRow = () => onChange([...rows, ['', '']]);
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  return (
    <div className="space-y-0.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-0.5">
          <input className={INPUT_CLS} placeholder="Find" value={row[0] || ''} onChange={e => updateRow(i, 0, e.target.value)} />
          <input className={INPUT_CLS} placeholder="Replace" value={row[1] || ''} onChange={e => updateRow(i, 1, e.target.value)} />
          <button className="flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-400" onClick={() => removeRow(i)}>
            <X size={9} />
          </button>
        </div>
      ))}
      <button className="flex items-center gap-0.5 text-[9px] text-[var(--n400,#9ca3af)] hover:text-teal-500" onClick={addRow}>
        <Plus size={8} /> row
      </button>
    </div>
  );
}

function MethodParams({ method, onChange, showApplyTo }) {
  const p = method.params || {};
  return (
    <div className="space-y-1">
      {method.type === 'Add' && (
        <>
          <input className={INPUT_CLS} placeholder="Text thêm vào" value={p.text || ''} onChange={e => onChange('text', e.target.value)} />
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={0} max={255} className={INPUT_CLS} style={{ width: 52 }}
              value={p.index ?? 0}
              onChange={e => onChange('index', parseInt(e.target.value, 10) || 0)}
            />
            <label className="flex items-center gap-0.5 text-[9px] text-[var(--n500,#6b7280)] cursor-pointer select-none">
              <input type="checkbox" checked={!!p.backwards} onChange={e => onChange('backwards', e.target.checked)} /> Backwards
            </label>
          </div>
        </>
      )}
      {method.type === 'Swap' && (
        <>
          <input className={INPUT_CLS} placeholder="Separator" value={p.separator || ''} onChange={e => onChange('separator', e.target.value)} />
          <select className={INPUT_CLS} value={p.occurrence || '1st'} onChange={e => onChange('occurrence', e.target.value)}>
            {['1st', '2nd', '3rd', 'Last', 'All (Reverse)'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </>
      )}
      {method.type === 'ListReplace' && (
        <ListReplaceTable tableData={p.table_data || []} onChange={v => onChange('table_data', v)} />
      )}
      {method.type === 'FolderName' && (
        <input className={INPUT_CLS} placeholder="Separator (mặc định rỗng)" value={p.separator || ''} onChange={e => onChange('separator', e.target.value)} />
      )}
      {showApplyTo && method.type !== 'FolderName' && (
        <select className={INPUT_CLS} value={p.apply_to || 'Name'} onChange={e => onChange('apply_to', e.target.value)}>
          <option value="Name">Name</option>
          <option value="Extension">Extension</option>
          <option value="Name and extension">Name and extension</option>
        </select>
      )}
    </div>
  );
}

function MethodList({ title, methods, setMethods, addOptions, showApplyTo }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const updateParam = (idx, key, val) => {
    setMethods(methods.map((m, i) => i === idx ? { ...m, params: { ...m.params, [key]: val } } : m));
  };
  const deleteMethod = (idx) => setMethods(methods.filter((_, i) => i !== idx));
  const addMethod = (type) => {
    setMethods([...methods, { type, active: true, params: { ...(METHOD_DEFAULTS[type] || {}) } }]);
    setMenuOpen(false);
  };

  const onRowDragStart = (e, idx) => { e.stopPropagation(); setDragIdx(idx); };
  const onRowDragOver  = (e, idx) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); };
  const onRowDrop = (e, idx) => {
    e.stopPropagation();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...methods];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setMethods(next);
    setDragIdx(null); setDragOverIdx(null);
  };
  const onRowDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  return (
    <div className="mb-2 nodrag">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide">{title}</span>
        <div className="relative">
          <button
            className="p-0.5 rounded text-[var(--n400,#9ca3af)] hover:text-teal-500"
            onClick={() => setMenuOpen(o => !o)}
            onMouseDown={e => e.stopPropagation()}
          >
            <Plus size={11} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-[var(--card,#fff)] rounded-lg shadow-lg border border-[var(--card-border,#e5e7eb)] py-1 z-[9999] min-w-[110px]">
              {addOptions.map(opt => (
                <button
                  key={opt}
                  className="w-full px-2.5 py-1 text-left hover:bg-[var(--n50,#f9fafb)] text-[10px] text-[var(--sub,#374151)]"
                  onClick={() => addMethod(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {methods.length === 0 && (
        <div className="text-[9px] text-[var(--n300,#d1d5db)] italic px-1 py-1">Chưa có rule</div>
      )}

      <div className="space-y-1">
        {methods.map((m, i) => (
          <div
            key={i}
            draggable
            onDragStart={e => onRowDragStart(e, i)}
            onDragOver={e => onRowDragOver(e, i)}
            onDrop={e => onRowDrop(e, i)}
            onDragEnd={onRowDragEnd}
            className={`rounded-lg border px-1.5 py-1 bg-[var(--card,#fff)] transition-colors ${
              dragOverIdx === i && dragIdx !== i ? 'border-teal-300 bg-teal-50' : 'border-[var(--card-border,#e5e7eb)]'
            } ${dragIdx === i ? 'opacity-40' : ''}`}
          >
            <div className="flex items-center gap-1 mb-1">
              <GripVertical size={9} className="text-[var(--n300,#d1d5db)] cursor-grab flex-shrink-0" onMouseDown={e => e.stopPropagation()} />
              <span className="text-[10px] font-medium text-[var(--sub,#374151)] flex-1 truncate">{i + 1}. {m.type}</span>
              <button className="flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-400" onClick={() => deleteMethod(i)} onMouseDown={e => e.stopPropagation()}>
                <X size={10} />
              </button>
            </div>
            <div onMouseDown={e => e.stopPropagation()}>
              <MethodParams method={m} onChange={(key, val) => updateParam(i, key, val)} showApplyTo={showApplyTo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdvancedRenamerNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const [runOpen, setRunOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodeOutputs      = useStore(s => s.nodeOutputs);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive       = useStore(s => s.nodeActive);

  const status    = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive  = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);

  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const droppedItems  = cfg('dropped_items', []);
  const fileMethods   = cfg('file_methods', []);
  const folderMethods = cfg('folder_methods', []);
  const applyChanges  = cfg('apply_changes', false);
  const mapping = nodeOutputs[id]?.mapping || [];

  const handleDelete = () => { deleteNode(id); };

  const removeDropped = (idx) => set('dropped_items', droppedItems.filter((_, i) => i !== idx));

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const collected = [];
    const dtItems = e.dataTransfer.items;
    if (dtItems && dtItems.length > 0) {
      for (let i = 0; i < dtItems.length; i++) {
        const it = dtItems[i];
        if (it.kind !== 'file') continue;
        const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
        if (entry) {
          collected.push({ name: entry.name, is_dir: entry.isDirectory });
        } else {
          const f = it.getAsFile();
          if (f) collected.push({ name: f.name, is_dir: false });
        }
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(f => collected.push({ name: f.name, is_dir: false }));
    }

    if (collected.length > 0) {
      const existingNames = new Set(droppedItems.map(d => d.name));
      set('dropped_items', [...droppedItems, ...collected.filter(c => !existingNames.has(c.name))]);
    }
  };

  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Bottom} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
              onClick={() => setRunOpen(o => !o)}
            >
              <Play size={12} className="text-[var(--sub,#374151)]" />
              <ChevronDown size={9} className="text-[var(--n400,#9ca3af)]" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-[var(--card,#fff)] rounded-xl shadow-xl border border-[var(--card-border,#e5e7eb)] py-1 z-[9999] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(id); setRunOpen(false); }}
                >
                  <span className="text-[11px] font-medium text-[var(--n800,#1f2937)]">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{reachable} nodes</span>
                </button>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(null); setRunOpen(false); }}
                >
                  <span className="text-[11px] text-[var(--sub,#4b5563)]">All workflow</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Open config" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Duplicate" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-blue-500 shadow-lg'
              : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        <div className="flex rounded-2xl overflow-hidden flex-1 min-h-0" style={{ flexBasis: DEFAULT_ROW_H }}>

          {/* Cột Input */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2" style={{ width: 190, borderRight: '1px solid #e5e7eb' }}>
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1">Input</div>
            <input
              className="nodrag w-full h-6 px-2 mb-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-teal-400"
              placeholder="Thư mục cha (D:/Projects)"
              value={cfg('base_path', '')}
              onChange={e => set('base_path', e.target.value)}
            />
            <div
              className={`nodrag flex-1 rounded-lg border border-dashed flex flex-col overflow-hidden transition-colors ${
                isDragOver ? 'border-teal-400 bg-teal-50' : 'border-[var(--n300,#d1d5db)] bg-[var(--card,#fff)]'
              }`}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {droppedItems.length === 0 ? (
                <div className="flex-1 flex items-center justify-center px-2">
                  <span className="text-[9px] text-[var(--n300,#d1d5db)] text-center leading-relaxed">Kéo folder/file vào đây</span>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto py-1">
                  {droppedItems.map((it, i) => {
                    const Icon = it.is_dir ? Folder : FileIcon;
                    return (
                      <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[var(--n50,#f9fafb)] group">
                        <Icon size={10} className="text-[var(--n400,#9ca3af)] flex-shrink-0" />
                        <span className="text-[9px] text-[var(--sub,#4b5563)] truncate flex-1">{it.name}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-400"
                          onClick={() => removeDropped(i)}
                        >
                          <X size={9} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {droppedItems.length > 0 && (
              <div className="text-[9px] text-[var(--n400,#9ca3af)] mt-1">{droppedItems.length} mục đã chọn</div>
            )}
          </div>

          {/* Cột Setting */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2 overflow-y-auto" style={{ width: 230, borderRight: '1px solid #e5e7eb' }}>
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1">Setting</div>
            <MethodList
              title="File Methods"
              methods={fileMethods}
              setMethods={v => set('file_methods', v)}
              addOptions={['Add', 'Swap', 'ListReplace']}
              showApplyTo
            />
            <MethodList
              title="Folder Methods"
              methods={folderMethods}
              setMethods={v => set('folder_methods', v)}
              addOptions={['FolderName']}
              showApplyTo={false}
            />
            <div className="mt-auto pt-2 border-t border-[var(--card-border,#f3f4f6)] nodrag">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="nodrag w-3.5 h-3.5 rounded accent-red-500"
                  checked={applyChanges}
                  onChange={e => set('apply_changes', e.target.checked)}
                />
                <span className="text-[10px] text-[var(--sub,#4b5563)] font-medium flex items-center gap-1">
                  Thực thi đổi tên thật
                  {applyChanges && <AlertTriangle size={10} className="text-amber-500" />}
                </span>
              </label>
            </div>
          </div>

          {/* Cột Preview */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2 flex-1 overflow-hidden">
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1">
              Preview {mapping.length > 0 && `(${mapping.length})`}
            </div>
            <div className="nodrag flex-1 overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)]">
              {mapping.length === 0 ? (
                <div className="h-full flex items-center justify-center px-2">
                  <span className="text-[9px] text-[var(--n300,#d1d5db)] text-center leading-relaxed">Chạy node để xem preview</span>
                </div>
              ) : (
                <table className="w-full text-[9px]">
                  <thead className="sticky top-0 bg-[var(--n50,#f9fafb)]">
                    <tr>
                      <th className="text-left px-1.5 py-1 font-medium text-[var(--n400,#9ca3af)]">Loại</th>
                      <th className="text-left px-1.5 py-1 font-medium text-[var(--n400,#9ca3af)]">Tên mới</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m, i) => (
                      <tr key={i} className="border-t border-[var(--card-border,#f3f4f6)]">
                        <td className="px-1.5 py-0.5 text-[var(--n400,#9ca3af)]">{m.is_dir ? '📁' : '📄'}</td>
                        <td
                          className={`px-1.5 py-0.5 truncate ${m.changed ? 'text-teal-600 font-medium' : 'text-[var(--n500,#6b7280)]'}`}
                          title={m.new_path}
                        >
                          {m.new_path.replace(/\\/g, '/').split('/').pop()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {status === 'running' && (
          <div className="absolute top-2 inset-x-0 flex justify-center z-20">
            <span className="text-[10px] text-amber-500 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse">Đang xử lý...</span>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute top-2 inset-x-0 flex justify-center z-20">
            <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span>
          </div>
        )}
        {status === 'done' && (
          <div className="absolute top-2 inset-x-0 flex justify-center z-20">
            <span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              ✓ {mapping.filter(m => m.applied).length} đã đổi tên
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
