import { useState, useEffect } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import {
  Play, Trash2, Copy, Link2, ChevronDown, X, Plus,
  Settings2, Clapperboard, CheckCircle2, Save, Upload,
} from 'lucide-react';
import { useStore } from '../store.js';
import {
  fetchResizeUploadV2LinkCatalog, saveResizeUploadV2LinkCatalog, deleteResizeUploadV2LinkCatalog,
  asanaTestV2, asanaAutoGidV2,
  fetchResizeUploadV2LastSession, saveResizeUploadV2LastSession,
} from '../lib/api.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';
import { CredentialField } from '../components/ConfigFields.jsx';
import {
  inputCls, labelCls, STATUS_COLORS, MODES, BG_STYLES,
  countReachable, resolveDropPaths, basename, CopyButton, Modal,
  AppManagerModal, TaskSelectorModal,
} from './resizeUploadShared.jsx';

const DEFAULT_W = 980;
const MIN_W = 820, MAX_W = 1500, MIN_H = 480, MAX_H = 900;

const MODE_SHORT = { '8_sizes': '8', '4_sizes_meta': '4', '3_sizes': '3' };

function makeRow() {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    selected: true,
    app: '',
    input_folders: [],
    task_urls: '',
    mode: '8_sizes',
    rename_videos: true,
    export_thumbnail: true,
    use_unc: true,
    use_today_date: true,
    custom_date: '',
  };
}

export default function ResizeUploadV2Node({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};

  const [runOpen, setRunOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appManagerOpen, setAppManagerOpen] = useState(false);
  const [taskSelectorRowId, setTaskSelectorRowId] = useState(null);
  const [catalogs, setCatalogs] = useState({ public: {}, mine: null });
  const [editScope, setEditScope] = useState('public');
  const [testMsg, setTestMsg] = useState(null);
  const [rowFolderInputs, setRowFolderInputs] = useState({});
  const apps = catalogs.mine || catalogs.public; // hiệu lực dùng thực (private override nếu có, else chung)
  const isAdmin = useStore(s => s.currentUser?.role === 'admin');

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const nodeProgress = useStore(s => s.nodeProgress);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive = useStore(s => s.nodeActive);
  const runNmsV2 = useStore(s => s.runNmsV2);
  const pickFolder = useStore(s => s.pickFolder);

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);
  const progress = nodeProgress[id];
  const output = nodeOutputs[id];

  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const loadCatalog = () => {
    fetchResizeUploadV2LinkCatalog().then(r => {
      setCatalogs(r);
      // Non-admin không sửa được bản "Chung" (backend 403) — mặc định về "Riêng của tôi"
      // để tránh sửa xong bấm Lưu mới biết bị chặn.
      setEditScope(r.mine ? 'private' : (isAdmin ? 'public' : 'private'));
    });
  };
  useEffect(() => { loadCatalog(); }, []);

  // Khôi phục phiên gần nhất khi node vừa được thêm mới (còn trống mặc định)
  useEffect(() => {
    if ((config.rows || []).length) return;
    fetchResizeUploadV2LastSession().then(saved => {
      if (!saved) return;
      for (const [key, value] of Object.entries(saved)) updateNodeConfig(id, key, value);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (text) => { setTestMsg(text); setTimeout(() => setTestMsg(null), 4000); };

  // ---- App/Link catalog: sửa bản chung (admin) hoặc bản riêng của tôi ----
  const editingCatalog = (editScope === 'private' ? catalogs.mine : catalogs.public) || {};
  const applyAppEdit = (current, { tag, original_tag, folder, thumbnail_folder, pinned }) => {
    const next = { ...current };
    if (original_tag && original_tag !== tag) delete next[original_tag];
    next[tag] = { folder, thumbnail_folder, pinned };
    return next;
  };
  const handleSaveAppEntry = async (payload) => {
    const r = await saveResizeUploadV2LinkCatalog(editScope, applyAppEdit(editingCatalog, payload));
    if (r.error) return flash(`⚠ ${r.error}`);
    loadCatalog();
  };
  const handleDeleteAppEntry = async (tag) => {
    const next = { ...editingCatalog };
    delete next[tag];
    const r = await saveResizeUploadV2LinkCatalog(editScope, next);
    if (r.error) return flash(`⚠ ${r.error}`);
    loadCatalog();
  };
  const handleRevertToPublicCatalog = async () => {
    await deleteResizeUploadV2LinkCatalog();
    loadCatalog();
  };
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const handleImportCatalog = async () => {
    let parsed;
    try { parsed = JSON.parse(importText); } catch { return flash('⚠ JSON không hợp lệ'); }
    const r = await saveResizeUploadV2LinkCatalog(editScope, parsed);
    if (r.error) return flash(`⚠ ${r.error}`);
    setImportOpen(false); setImportText('');
    loadCatalog();
    flash('✓ Đã nhập catalog');
  };

  // ---- Rows (bảng job) ----
  const rows = cfg('rows', []);
  const setRows = (next) => set('rows', next);
  const updateRow = (rowId, key, val) => setRows(rows.map(r => (r.id === rowId ? { ...r, [key]: val } : r)));
  const addRow = () => setRows([...rows, makeRow()]);
  const removeRow = (rowId) => setRows(rows.filter(r => r.id !== rowId));
  const toggleAllRows = (checked) => setRows(rows.map(r => ({ ...r, selected: checked })));
  const allSelected = rows.length > 0 && rows.every(r => r.selected);
  const selectedCount = rows.filter(r => r.selected).length;

  const addRowFolders = (rowId, paths) => {
    const row = rows.find(r => r.id === rowId);
    const next = [...(row?.input_folders || [])];
    for (const p of paths) if (!next.includes(p)) next.push(p);
    updateRow(rowId, 'input_folders', next);
  };
  const removeRowFolder = (rowId, idx) => {
    const row = rows.find(r => r.id === rowId);
    updateRow(rowId, 'input_folders', (row?.input_folders || []).filter((_, i) => i !== idx));
  };
  const handleAddRowFolder = async (rowId) => { const path = await pickFolder(); if (path) addRowFolders(rowId, [path]); };
  const addRowFolderManual = (rowId) => {
    const v = (rowFolderInputs[rowId] || '').trim();
    if (!v) return;
    addRowFolders(rowId, [v]);
    setRowFolderInputs({ ...rowFolderInputs, [rowId]: '' });
  };

  // Map url -> số thứ tự dòng (1-based) đã dùng link đó, loại trừ dòng excludeRowId
  const computeUsedUrls = (excludeRowId) => {
    const map = {};
    rows.forEach((r, i) => {
      if (r.id === excludeRowId) return;
      (r.task_urls || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        .forEach(u => { if (!(u in map)) map[u] = i + 1; });
    });
    return map;
  };

  const handleTaskUrlsBlur = (rowId) => {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    const usedMap = computeUsedUrls(rowId);
    const lines = (row.task_urls || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const dupes = lines.filter(u => usedMap[u]);
    if (!dupes.length) return;
    const kept = lines.filter(u => !usedMap[u]);
    updateRow(rowId, 'task_urls', kept.join('\n'));
    flash(`⚠ Đã dùng ở dòng ${usedMap[dupes[0]]}: ${dupes[0]}${dupes.length > 1 ? ` (+${dupes.length - 1} link khác)` : ''}`);
  };

  const allAppTags = Object.keys(apps).sort((a, b) => {
    const pa = apps[a]?.pinned ? 0 : 1, pb = apps[b]?.pinned ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  // ---- Settings chung (Credential, Nền, Asana) ----
  const handleBrowseOutput = async () => { const path = await pickFolder(); if (path) set('output_folder', path); };
  const handleSaveSession = async () => { await saveResizeUploadV2LastSession(config); flash('✓ Đã lưu'); };

  const firstTaskUrl = (() => {
    for (const r of rows) {
      const u = (r.task_urls || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (u) return u;
    }
    return '';
  })();
  const handleTestAsana = async () => {
    const r = await asanaTestV2(cfg('asana_credential_name', ''));
    flash(r.error ? `⚠ ${r.error}` : `✓ ${r.message}`);
  };
  const handleAutoGid = async () => {
    const r = await asanaAutoGidV2(cfg('asana_credential_name', ''), firstTaskUrl);
    if (r.error) return flash(`⚠ ${r.error}`);
    set('asana_field_gid', r.field_gid);
    set('asana_option_gid', r.option_gid);
    flash('✓ Đã điền GID');
  };
  const bgStyle = cfg('bg_style', 'color');
  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <div className="relative">
            <button className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors" onClick={() => setRunOpen(o => !o)}>
              <Play size={12} className="text-[var(--sub,#374151)]" />
              <ChevronDown size={9} className="text-[var(--n400,#9ca3af)]" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-[var(--card,#fff)] rounded-xl shadow-xl border border-[var(--card-border,#e5e7eb)] py-1 z-[9999] min-w-[180px]">
                <button className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors" onClick={() => { runWorkflow(id); setRunOpen(false); }}>
                  <span className="text-[11px] font-medium text-[var(--n800,#1f2937)]">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{reachable} nodes</span>
                </button>
                <button className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors" onClick={() => { runWorkflow(null); setRunOpen(false); }}>
                  <span className="text-[11px] text-[var(--sub,#4b5563)]">All workflow</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Open config" onClick={() => selectNode(id)}><Link2 size={12} /></button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Duplicate" onClick={() => duplicateNode(id)}><Copy size={12} /></button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" title="Delete" onClick={() => deleteNode(id)}><Trash2 size={12} /></button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning ? 'ring-2 ring-amber-400 shadow-lg animate-pulse' : selected ? 'ring-2 ring-red-500 shadow-lg' : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && (
          <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10" style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }} />
        )}

        <div className="rounded-2xl bg-[var(--n50,#f9fafb)] p-3 flex-1 min-h-0 flex flex-col nodrag">
          <div className="flex flex-col flex-1 min-h-0" style={{ minHeight: 220 }}>

            {/* ===== Bảng input (job theo từng dòng) ===== */}
            <div className="rounded-xl border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] p-2 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1.5 flex-shrink-0">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={allSelected} onChange={e => toggleAllRows(e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[9px] text-[var(--n500,#6b7280)]">Chọn tất cả ({selectedCount}/{rows.length})</span>
                </label>
                <button className="nodrag flex-shrink-0 px-2 py-1 rounded-md bg-red-50 text-red-600 text-[9px] font-semibold hover:bg-red-100" onClick={addRow}>
                  <Plus size={9} className="inline mr-1" />Thêm dòng
                </button>
              </div>

              <div className="overflow-auto flex-1 min-h-0 rounded-lg border border-[var(--card-border,#f3f4f6)]">
                <table className="w-full text-[9px] border-collapse">
                  <thead className="sticky top-0 bg-[var(--n50,#f9fafb)] z-10">
                    <tr>
                      <th className="p-1 w-6">#</th>
                      <th className="p-1 w-6"></th>
                      <th className="p-1 text-left">App</th>
                      <th className="p-1 text-left">Input</th>
                      <th className="p-1 text-left">Asana</th>
                      <th className="p-1">Resize</th>
                      <th className="p-1">Rename</th>
                      <th className="p-1">Thumb</th>
                      <th className="p-1">Google Drive</th>
                      <th className="p-1">Datetime</th>
                      <th className="p-1 text-left">Kết quả</th>
                      <th className="p-1 text-left">Links</th>
                      <th className="p-1 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const rowResult = output?.rows?.[row.id];
                      const rowLinks = rowResult ? (rowResult.unc_links || []) : [];
                      return (
                        <tr key={row.id} className="border-t border-[var(--card-border,#f3f4f6)] hover:bg-[var(--n50,#f9fafb)] align-top">
                          <td className="p-1 text-center text-[var(--n400,#9ca3af)]">{idx + 1}</td>
                          <td className="p-1 text-center">
                            <input type="checkbox" checked={!!row.selected} onChange={e => updateRow(row.id, 'selected', e.target.checked)} className="w-3 h-3 accent-red-500" />
                          </td>
                          <td className="p-1">
                            <select
                              className="w-32 h-6 px-1 rounded border border-[var(--card-border,#e5e7eb)] text-[9px] bg-[var(--card,#fff)]"
                              value={row.app} onChange={e => updateRow(row.id, 'app', e.target.value)}
                              onMouseDown={e => e.stopPropagation()}
                            >
                              <option value="">-- chọn --</option>
                              {allAppTags.map(tag => (
                                <option key={tag} value={tag}>{apps[tag]?.pinned ? '⭐ ' : ''}{tag}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-1">
                            <div
                              className="w-44 min-h-[24px] max-h-14 overflow-y-auto rounded border border-dashed border-[var(--card-border,#e5e7eb)] p-1"
                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                              onDrop={async e => { e.preventDefault(); e.stopPropagation(); const paths = await resolveDropPaths(e); if (paths.length) addRowFolders(row.id, paths); }}
                            >
                              {(row.input_folders || []).map((p, i) => (
                                <div key={i} className="flex items-center gap-0.5">
                                  <span className="text-[8px] text-[var(--sub,#4b5563)] truncate flex-1" title={p}>{basename(p)}</span>
                                  <button onClick={() => removeRowFolder(row.id, i)} className="flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-500"><X size={8} /></button>
                                </div>
                              ))}
                              <button className="text-[8px] text-red-500 hover:text-red-600" onClick={() => handleAddRowFolder(row.id)}>+ thêm</button>
                              <input
                                type="text"
                                className="w-full h-4 px-0.5 mt-0.5 rounded border border-[var(--card-border,#e5e7eb)] text-[8px] bg-[var(--card,#fff)] focus:outline-none focus:border-red-400"
                                placeholder="Dán đường dẫn..."
                                value={rowFolderInputs[row.id] || ''}
                                onChange={e => setRowFolderInputs({ ...rowFolderInputs, [row.id]: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') addRowFolderManual(row.id); }}
                                onMouseDown={e => e.stopPropagation()}
                              />
                            </div>
                          </td>
                          <td className="p-1">
                            <div className="flex flex-col gap-0.5 w-28">
                              <textarea
                                className="w-full h-10 px-1 py-0.5 rounded border border-[var(--card-border,#e5e7eb)] text-[8px] resize-none"
                                placeholder="Task URLs"
                                value={row.task_urls}
                                onChange={e => updateRow(row.id, 'task_urls', e.target.value)}
                                onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                                onBlur={() => handleTaskUrlsBlur(row.id)}
                              />
                              <button className="text-[8px] text-[var(--n400,#9ca3af)] hover:text-red-500 text-left" onClick={() => setTaskSelectorRowId(row.id)}>+ chọn từ Asana</button>
                            </div>
                          </td>
                          <td className="p-1">
                            <select
                              className="w-10 h-6 px-0.5 rounded border border-[var(--card-border,#e5e7eb)] text-[9px] bg-[var(--card,#fff)]"
                              value={row.mode} onChange={e => updateRow(row.id, 'mode', e.target.value)}
                              onMouseDown={e => e.stopPropagation()}
                            >
                              {MODES.map(m => <option key={m.value} value={m.value}>{MODE_SHORT[m.value]}</option>)}
                            </select>
                          </td>
                          <td className="p-1 text-center">
                            <input type="checkbox" checked={!!row.rename_videos} onChange={e => updateRow(row.id, 'rename_videos', e.target.checked)} className="w-3 h-3 accent-red-500" />
                          </td>
                          <td className="p-1 text-center">
                            <input type="checkbox" checked={!!row.export_thumbnail} onChange={e => updateRow(row.id, 'export_thumbnail', e.target.checked)} className="w-3 h-3 accent-red-500" />
                          </td>
                          <td className="p-1 text-center">
                            <input type="checkbox" checked={!!row.use_unc} onChange={e => updateRow(row.id, 'use_unc', e.target.checked)} className="w-3 h-3 accent-red-500" />
                          </td>
                          <td className="p-1 text-center">
                            <input type="checkbox" checked={row.use_today_date !== false} onChange={e => updateRow(row.id, 'use_today_date', e.target.checked)} className="w-3 h-3 accent-red-500" />
                            {row.use_today_date === false && (
                              <input
                                type="text" placeholder="YYMMDD"
                                className="w-14 h-4 mt-0.5 px-0.5 rounded border border-[var(--card-border,#e5e7eb)] text-[8px] bg-[var(--card,#fff)]"
                                value={row.custom_date || ''} onChange={e => updateRow(row.id, 'custom_date', e.target.value)}
                                onMouseDown={e => e.stopPropagation()}
                              />
                            )}
                          </td>
                          <td className="p-1">
                            {!rowResult && <span className="text-[var(--n300,#d1d5db)]">{isRunning ? '⏳' : '—'}</span>}
                            {rowResult?.status === 'done' && <span className="text-green-600">✓ Xong</span>}
                            {rowResult?.status === 'error' && <span className="text-red-500" title={rowResult.error || ''}>✗ Lỗi</span>}
                          </td>
                          <td className="p-1">
                            <div className="w-28 max-h-14 overflow-y-auto flex flex-col gap-0.5">
                              {rowLinks.length === 0 && <span className="text-[var(--n300,#d1d5db)]">—</span>}
                              {rowLinks.map((l, i) => (
                                <div key={i} className="flex items-center gap-0.5">
                                  <span className="text-[8px] text-[var(--sub,#4b5563)] truncate flex-1" title={l}>{basename(l.split('?')[0])}</span>
                                  <CopyButton text={l} />
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-1 text-center">
                            <button onClick={() => removeRow(row.id)} className="text-[var(--n300,#d1d5db)] hover:text-red-500"><X size={11} /></button>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={13} className="text-center text-[var(--n400,#9ca3af)] py-4">Chưa có dòng nào. Bấm &quot;Thêm dòng&quot; để bắt đầu.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Run button + NMS + Save + Settings */}
          <div className="flex gap-1.5 mt-3 flex-shrink-0">
            <button
              className="nodrag flex-1 py-2 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              disabled={isRunning}
              onClick={() => runWorkflow(id)}
            >
              <Clapperboard size={12} /> RENDER & UPLOAD
            </button>
            <button
              className="nodrag flex-shrink-0 px-2.5 rounded-lg bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)] text-[9px] font-medium hover:bg-[var(--n200,#e5e7eb)] transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              disabled={isRunning}
              onClick={() => runNmsV2(id, 'upload_only')}
            >
              <Upload size={9} /> Upload
            </button>
            <button
              className="nodrag flex-shrink-0 w-9 rounded-lg bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)] transition-colors flex items-center justify-center disabled:opacity-50"
              disabled={isRunning}
              title="Lưu phiên làm việc"
              onClick={handleSaveSession}
            >
              <Save size={13} />
            </button>
            <button
              className="nodrag flex-shrink-0 w-9 rounded-lg bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)] transition-colors flex items-center justify-center"
              title="Cài đặt chung"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={13} />
            </button>
          </div>

          {(isRunning || progress) && (
            <div className="mt-2.5 flex-shrink-0">
              <div className="h-1.5 rounded-full bg-[var(--n200,#e5e7eb)] overflow-hidden">
                <div className="h-full bg-red-500 transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="mt-1 text-[9px] text-[var(--n400,#9ca3af)] truncate">{progress?.message || `${progress?.percent ?? 0}%`}</div>
            </div>
          )}

          {testMsg && <div className="mt-2 text-[9px] text-center text-[var(--n500,#6b7280)] flex-shrink-0">{testMsg}</div>}

          {status === 'error' && (
            <div className="mt-2 text-center flex-shrink-0"><span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span></div>
          )}
          {status === 'done' && (
            <div className="mt-2 text-center flex-shrink-0"><span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200 inline-flex items-center gap-1"><CheckCircle2 size={10} />Hoàn tất</span></div>
          )}
        </div>

        <Handle
          type="target" id="folders_in" position={Position.Left} className="port-handle port-handle--input" data-label="Folders"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>
        <Handle
          type="source" id="unc_links" position={Position.Right} className="port-handle port-handle--output" data-label="UNC Links"
          style={portStyle('array', 0, 2, 'right')}
        >
          {portGlyph('array')}
        </Handle>
        <Handle
          type="source" id="files_out" position={Position.Right} className="port-handle port-handle--output" data-label="Files"
          style={portStyle('array', 1, 2, 'right')}
        >
          {portGlyph('array')}
        </Handle>
      </div>

      {settingsOpen && (
        <Modal title="Cài đặt chung" width={420} onClose={() => setSettingsOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <div className={labelCls}>Output Folder</div>
              <div className="flex items-center gap-1">
                <input
                  type="text" className={inputCls} placeholder="Output folder"
                  value={cfg('output_folder', '')} onChange={e => set('output_folder', e.target.value)}
                />
                <button className="flex-shrink-0 px-2 h-7 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={handleBrowseOutput}>…</button>
              </div>
            </div>

            <div>
              <div className={labelCls}>Nền</div>
              <select className={inputCls} value={bgStyle} onChange={e => set('bg_style', e.target.value)}>
                {BG_STYLES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
              {bgStyle === 'color' && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] text-[var(--n400,#9ca3af)]">Màu:</span>
                  <input type="color" className="nodrag w-7 h-6 rounded border border-[var(--card-border,#e5e7eb)]" value={cfg('color_color', '#FEFBE7')} onChange={e => set('color_color', e.target.value)} />
                  <span className="text-[9px] text-[var(--n400,#9ca3af)]">{cfg('color_color', '#FEFBE7')}</span>
                </div>
              )}
              {bgStyle === 'blur' && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] text-[var(--n400,#9ca3af)]">Độ mờ:</span>
                  <input type="number" className="w-16 h-6 px-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px]" value={cfg('blur_value', 30)} onChange={e => set('blur_value', Number(e.target.value) || 0)} />
                </div>
              )}
            </div>

            <div>
              <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                <input type="checkbox" checked={cfg('use_asana', true)} onChange={e => set('use_asana', e.target.checked)} className="w-3 h-3 accent-red-500" />
                <span className="text-[10px] font-semibold text-[var(--sub,#374151)]">Asana</span>
              </label>
              <div className="flex gap-1">
                <input type="text" className={inputCls} placeholder="Progress GID" value={cfg('asana_field_gid', '')} onChange={e => set('asana_field_gid', e.target.value)} />
                <input type="text" className={inputCls} placeholder="Done Option GID" value={cfg('asana_option_gid', '')} onChange={e => set('asana_option_gid', e.target.value)} />
              </div>
              <button className="w-full mt-1 py-1 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={handleAutoGid}>Tự động tìm GID</button>
              <div className="flex items-end gap-1 mt-1">
                <div className="flex-1">
                  <CredentialField
                    field={{ id: 'asana_credential_name', label: 'Asana PAT', type: 'credential' }}
                    value={cfg('asana_credential_name', '')}
                    onChange={v => set('asana_credential_name', v)}
                  />
                </div>
                <button className="flex-shrink-0 px-2 h-7 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={handleTestAsana}>Test</button>
              </div>
            </div>

            <div>
              <div className={labelCls}>App / Link Catalog</div>
              <div className="flex items-center gap-1 mb-1.5">
                {isAdmin && (
                  <button
                    className={`flex-1 py-1 rounded-md text-[9px] font-semibold transition-colors ${editScope === 'public' ? 'bg-red-50 text-red-600' : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'}`}
                    onClick={() => setEditScope('public')}
                  >Chung</button>
                )}
                <button
                  className={`flex-1 py-1 rounded-md text-[9px] font-semibold transition-colors ${editScope === 'private' ? 'bg-red-50 text-red-600' : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'}`}
                  onClick={() => setEditScope('private')}
                >Riêng của tôi</button>
              </div>
              <button className="w-full py-1 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={() => setAppManagerOpen(true)}>
                Quản lý App ({editScope === 'public' ? 'Chung' : 'Riêng'})…
              </button>
              <button className="w-full mt-1 py-1 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={() => setImportOpen(o => !o)}>
                Nhập JSON (dán nội dung custom_links.json cũ)…
              </button>
              {importOpen && (
                <div className="flex flex-col gap-1 mt-1">
                  <textarea
                    className="w-full h-20 px-1.5 py-1 rounded-md border border-[var(--card-border,#e5e7eb)] text-[9px] font-mono resize-none"
                    placeholder='{"TenApp": {"folder": "...", "thumbnail_folder": "", "pinned": false}}'
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                    onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                  />
                  <div className="flex gap-1">
                    <button className="flex-1 py-1 rounded-md bg-red-600 text-white text-[9px] font-semibold hover:bg-red-700" onClick={handleImportCatalog}>Nhập vào bản {editScope === 'public' ? 'Chung' : 'Riêng'}</button>
                    <button className="flex-1 py-1 rounded-md bg-[var(--n100,#f3f4f6)] text-[9px] font-semibold text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]" onClick={() => { setImportOpen(false); setImportText(''); }}>Huỷ</button>
                  </div>
                </div>
              )}
              {catalogs.mine && (
                <button className="w-full mt-1 py-1 rounded-md bg-red-50 text-[9px] font-semibold text-red-600 hover:bg-red-100" onClick={handleRevertToPublicCatalog}>
                  Xoá bản riêng, dùng lại bản chung
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {appManagerOpen && (
        <AppManagerModal
          apps={editingCatalog}
          onClose={() => { setAppManagerOpen(false); loadCatalog(); }}
          onReload={loadCatalog}
          onSaveApp={handleSaveAppEntry}
          onDeleteApp={handleDeleteAppEntry}
          title={`Quản lý App (${editScope === 'public' ? 'Chung' : 'Riêng của tôi'})`}
        />
      )}
      {taskSelectorRowId && (
        <TaskSelectorModal
          credentialName={cfg('asana_credential_name', '')}
          usedUrls={computeUsedUrls(taskSelectorRowId)}
          onInsert={(urls) => {
            const row = rows.find(r => r.id === taskSelectorRowId);
            const current = (row?.task_urls || '').trim();
            updateRow(taskSelectorRowId, 'task_urls', current ? `${current}\n${urls.join('\n')}` : urls.join('\n'));
          }}
          onClose={() => setTaskSelectorRowId(null)}
        />
      )}
    </div>
  );
}
