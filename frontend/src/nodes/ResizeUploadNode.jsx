import { useState, useEffect } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import {
  Play, Trash2, Copy, Link2, ChevronDown, Folder, FolderOpen, X, Plus, Search,
  Settings2, Clapperboard, CheckCircle2, Save, Upload, FileUp,
} from 'lucide-react';
import { useStore } from '../store.js';
import {
  uploadFile,
  fetchResizeUploadSettings, saveResizeUploadSettings,
  fetchResizeUploadApps,
  asanaTest, asanaAutoGid, gcsTest, uncTest,
  loadResizeUploadCredentials, fetchResizeUploadLastSession, saveResizeUploadLastSession,
} from '../lib/api.js';
import { ResizeControls, portPct } from './resizable.jsx';
import {
  inputCls, labelCls, STATUS_COLORS, PORT_COLOR, MODES, BG_STYLES,
  countReachable, resolveDropPaths, basename, CopyButton, Modal,
  AppManagerModal, ChannelManagerModal, TaskSelectorModal, InspectFieldsModal,
} from './resizeUploadShared.jsx';

const DEFAULT_W = 760;
const MIN_W = 580, MAX_W = 1200, MIN_H = 460, MAX_H = 900;

export default function ResizeUploadNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};

  const [runOpen, setRunOpen] = useState(false);
  const [appManagerOpen, setAppManagerOpen] = useState(false);
  const [channelManagerOpen, setChannelManagerOpen] = useState(false);
  const [taskSelectorOpen, setTaskSelectorOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [appSearch, setAppSearch] = useState('');
  const [settings, setSettings] = useState({ asana_pat_main: '', gcs_credentials_global: '', gcs_streams: { Meta: '', Google: '' }, gcs_google_channels_list: [] });
  const [apps, setApps] = useState({});
  const [testMsg, setTestMsg] = useState(null);

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
  const runNms = useStore(s => s.runNms);
  const pickFolder = useStore(s => s.pickFolder);
  const pickFile = useStore(s => s.pickFile);

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);
  const progress = nodeProgress[id];
  const output = nodeOutputs[id];

  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const loadCatalog = () => { fetchResizeUploadApps().then(setApps); };
  useEffect(() => { fetchResizeUploadSettings().then(setSettings); loadCatalog(); }, []);

  // Khôi phục phiên gần nhất khi node vừa được thêm mới (còn trống mặc định)
  useEffect(() => {
    const isEmpty = !(config.input_folders || []).length && !config.output_folder
      && !(config.selected_apps || []).length && !config.task_urls;
    if (!isEmpty) return;
    fetchResizeUploadLastSession().then(saved => {
      if (!saved) return;
      for (const [key, value] of Object.entries(saved)) updateNodeConfig(id, key, value);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (text) => { setTestMsg(text); setTimeout(() => setTestMsg(null), 4000); };

  const patchSettings = (next) => { setSettings(next); saveResizeUploadSettings(next); };

  // ---- Credential & Link ----
  const handleBrowseCredPath = async (key) => { const path = await pickFile(); if (path) set(key, path); };
  const handleUploadCredPath = async (key, file) => {
    if (!file) return;
    const { path } = await uploadFile(file);
    if (path) set(key, path);
  };
  const handleLoadCredentials = async () => {
    const r = await loadResizeUploadCredentials(cfg('cred_config_path', ''), cfg('cred_links_path', ''));
    if (r.settings) setSettings(r.settings);
    if (r.apps) setApps(r.apps);
    flash('✓ Đã nạp Credential & Link');
  };

  // ---- Save phiên làm việc ----
  const handleSaveSession = async () => { await saveResizeUploadLastSession(config); flash('✓ Đã lưu'); };

  // ---- Input folders ----
  const folders = cfg('input_folders', []);
  const addFolders = (paths) => {
    const next = [...folders];
    for (const p of paths) if (!next.includes(p)) next.push(p);
    set('input_folders', next);
  };
  const removeFolder = (i) => set('input_folders', folders.filter((_, idx) => idx !== i));
  const handleAddFolder = async () => { const path = await pickFolder(); if (path) addFolders([path]); };
  const [folderPathInput, setFolderPathInput] = useState('');
  const addFolderManual = () => {
    const v = folderPathInput.trim();
    if (!v) return;
    addFolders([v]);
    setFolderPathInput('');
  };
  const handleBrowseOutput = async () => { const path = await pickFolder(); if (path) set('output_folder', path); };

  // ---- App selection ----
  const selectedApps = cfg('selected_apps', []);
  const toggleApp = (tag) => {
    const next = selectedApps.includes(tag) ? selectedApps.filter(t => t !== tag) : [...selectedApps, tag];
    set('selected_apps', next);
  };
  const allAppTags = Object.keys(apps).sort((a, b) => {
    const pa = apps[a]?.pinned ? 0 : 1, pb = apps[b]?.pinned ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
  const visibleAppTags = allAppTags.filter(t => !appSearch.trim() || t.toLowerCase().includes(appSearch.toLowerCase()));

  // ---- Asana actions ----
  const firstTaskUrl = (cfg('task_urls', '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0]) || '';
  const handleTestAsana = async () => {
    const r = await asanaTest(settings.asana_pat_main || '');
    flash(r.error ? `⚠ ${r.error}` : `✓ ${r.message}`);
  };
  const handleAutoGid = async () => {
    const r = await asanaAutoGid(settings.asana_pat_main || '', firstTaskUrl);
    if (r.error) return flash(`⚠ ${r.error}`);
    set('asana_field_gid', r.field_gid);
    set('asana_option_gid', r.option_gid);
    flash('✓ Đã điền GID');
  };

  // ---- GCS/UNC test ----
  const activeBucket = cfg('use_meta', true) ? (settings.gcs_streams?.Meta || '') : (settings.gcs_streams?.Google || '');
  const handleTestGcs = async () => {
    const r = await gcsTest(activeBucket, settings.gcs_credentials_global || '');
    flash(r.error ? `⚠ ${r.error}` : `✓ ${r.message}`);
  };
  const handleTestUnc = async () => {
    const tag = selectedApps[0];
    const folder = (apps[tag]?.folder || '').trim();
    if (!folder) return flash('⚠ Chọn 1 App có UNC folder trước');
    const r = await uncTest(folder);
    flash(r.error ? `⚠ ${r.error}` : `✓ ${r.message}`);
  };

  const bgStyle = cfg('bg_style', 'color');
  const nodeW = width || DEFAULT_W;
  const outLinks = { unc: output?.unc_links || [], gcs: output?.gcs_links || [] };

  return (
    <div className="flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          <div className="relative">
            <button className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors" onClick={() => setRunOpen(o => !o)}>
              <Play size={12} className="text-gray-700" />
              <ChevronDown size={9} className="text-gray-400" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-[9999] min-w-[180px]">
                <button className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors" onClick={() => { runWorkflow(id); setRunOpen(false); }}>
                  <span className="text-[11px] font-medium text-gray-800">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{reachable} nodes</span>
                </button>
                <button className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors" onClick={() => { runWorkflow(null); setRunOpen(false); }}>
                  <span className="text-[11px] text-gray-600">All workflow</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Open config" onClick={() => selectNode(id)}><Link2 size={12} /></button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Duplicate" onClick={() => duplicateNode(id)}><Copy size={12} /></button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" title="Delete" onClick={() => deleteNode(id)}><Trash2 size={12} /></button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate">
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning ? 'ring-2 ring-amber-400 shadow-lg animate-pulse' : selected ? 'ring-2 ring-red-500 shadow-lg' : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && (
          <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10" style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }} />
        )}

        <div className="rounded-2xl bg-gray-50 p-3 overflow-y-auto flex-1 min-h-0 nodrag">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>

            {/* ===== Cột 1: Input/Output, Resize, Nền ===== */}
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className={labelCls}>1) Input & Output</div>
                <div
                  className="rounded-lg border border-dashed border-gray-200 p-1.5 mb-1.5 max-h-[90px] overflow-y-auto"
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={async e => { e.preventDefault(); e.stopPropagation(); const paths = await resolveDropPaths(e); if (paths.length) addFolders(paths); }}
                >
                  {folders.length === 0 && <div className="text-[9px] text-gray-400 text-center py-2">Kéo thả thư mục vào đây</div>}
                  {folders.map((p, i) => (
                    <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-gray-50">
                      <Folder size={9} className="text-gray-400 flex-shrink-0" />
                      <span className="text-[9px] text-gray-600 truncate flex-1" title={p}>{basename(p)}</span>
                      <button onClick={() => removeFolder(i)} className="flex-shrink-0 text-gray-300 hover:text-red-500"><X size={9} /></button>
                    </div>
                  ))}
                </div>
                <button className="w-full py-1 rounded-md bg-red-50 text-red-600 text-[9px] font-semibold hover:bg-red-100 transition-colors mb-1.5" onClick={handleAddFolder}>
                  <Plus size={9} className="inline mr-1" />Thêm thư mục
                </button>
                <div className="flex items-center gap-1 mb-2">
                  <input
                    type="text"
                    className="flex-1 h-6 px-1.5 rounded-md border border-gray-200 text-[9px] text-gray-700 bg-white focus:outline-none focus:border-red-400"
                    placeholder="Dán đường dẫn thư mục..."
                    value={folderPathInput}
                    onChange={e => setFolderPathInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addFolderManual(); }}
                  />
                  <button className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors" onClick={addFolderManual}>
                    <Plus size={9} />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <input
                    type="text" className={inputCls} placeholder="Output folder"
                    value={cfg('output_folder', '')} onChange={e => set('output_folder', e.target.value)}
                    onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                  />
                  <button className="flex-shrink-0 px-2 h-7 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={handleBrowseOutput}>…</button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className={labelCls}>Credential & Link</div>
                <div className="flex flex-col gap-1 mb-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-gray-600 truncate flex-1" title={cfg('cred_config_path', '')}>{basename(cfg('cred_config_path', '')) || 'config222.json'}</span>
                    <button className="flex-shrink-0 p-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500" title="Đổi đường dẫn (browse, chỉ dùng khi chạy dev Windows)" onClick={() => handleBrowseCredPath('cred_config_path')}><FolderOpen size={10} /></button>
                    <label className="flex-shrink-0 p-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 cursor-pointer" title="Upload file (dùng được cả trên bản product/Docker)">
                      <FileUp size={10} />
                      <input type="file" accept=".json" className="hidden" onChange={e => handleUploadCredPath('cred_config_path', e.target.files[0])} />
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-gray-600 truncate flex-1" title={cfg('cred_links_path', '')}>{basename(cfg('cred_links_path', '')) || 'custom_links.json'}</span>
                    <button className="flex-shrink-0 p-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500" title="Đổi đường dẫn (browse, chỉ dùng khi chạy dev Windows)" onClick={() => handleBrowseCredPath('cred_links_path')}><FolderOpen size={10} /></button>
                    <label className="flex-shrink-0 p-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-500 cursor-pointer" title="Upload file (dùng được cả trên bản product/Docker)">
                      <FileUp size={10} />
                      <input type="file" accept=".json" className="hidden" onChange={e => handleUploadCredPath('cred_links_path', e.target.files[0])} />
                    </label>
                  </div>
                </div>
                <button className="w-full py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200 transition-colors" onClick={handleLoadCredentials}>Load</button>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className={labelCls}>2) Resize</div>
                <div className="flex flex-col gap-1 mb-2">
                  {MODES.map(m => (
                    <label key={m.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" checked={cfg('mode', '8_sizes') === m.value} onChange={() => set('mode', m.value)} className="w-3 h-3 accent-red-500" />
                      <span className="text-[10px] text-gray-600">{m.label}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                  <input type="checkbox" checked={cfg('rename_videos', true)} onChange={e => set('rename_videos', e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[10px] text-gray-600">Đổi tên (Theme_CodeApp_Language)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={cfg('export_thumbnail', true)} onChange={e => set('export_thumbnail', e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[10px] text-gray-600">Xuất thumbnail JPG</span>
                </label>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className={labelCls}>3) Nền</div>
                <select className={inputCls} value={bgStyle} onChange={e => set('bg_style', e.target.value)}>
                  {BG_STYLES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                {bgStyle === 'color' && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-gray-400">Màu:</span>
                    <input type="color" className="nodrag w-7 h-6 rounded border border-gray-200" value={cfg('color_color', '#FEFBE7')} onChange={e => set('color_color', e.target.value)} />
                    <span className="text-[9px] text-gray-400">{cfg('color_color', '#FEFBE7')}</span>
                  </div>
                )}
                {bgStyle === 'blur' && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-gray-400">Độ mờ:</span>
                    <input type="number" className="w-16 h-6 px-1.5 rounded-md border border-gray-200 text-[10px]" value={cfg('blur_value', 30)} onChange={e => set('blur_value', Number(e.target.value) || 0)} />
                  </div>
                )}
              </div>
            </div>

            {/* ===== Cột 2: Asana, GCS, Chọn App ===== */}
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={cfg('use_asana', true)} onChange={e => set('use_asana', e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[10px] font-semibold text-gray-700">4) Asana</span>
                </label>
                {cfg('use_asana', true) && (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      className="w-full h-12 px-2 py-1 rounded-md border border-gray-200 text-[9px] text-gray-700 bg-white focus:outline-none focus:border-red-400 resize-none"
                      placeholder="Task URLs (mỗi dòng 1 task)"
                      value={cfg('task_urls', '')} onChange={e => set('task_urls', e.target.value)}
                      onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                    />
                    <div className="flex gap-1">
                      <button className="flex-1 py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={() => setTaskSelectorOpen(true)}>Chọn Task…</button>
                      <button className="flex-1 py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={() => setInspectOpen(true)}>Xem Fields</button>
                    </div>
                    <div className="flex gap-1">
                      <input type="text" className={inputCls} placeholder="Progress GID" value={cfg('asana_field_gid', '')} onChange={e => set('asana_field_gid', e.target.value)} onMouseDown={e => e.stopPropagation()} />
                      <input type="text" className={inputCls} placeholder="Done Option GID" value={cfg('asana_option_gid', '')} onChange={e => set('asana_option_gid', e.target.value)} onMouseDown={e => e.stopPropagation()} />
                    </div>
                    <button className="py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={handleAutoGid}>Tự động tìm GID</button>
                    <div className="flex gap-1 items-center">
                      <input
                        type="password" className={inputCls} placeholder="Asana PAT"
                        value={settings.asana_pat_main || ''} onChange={e => patchSettings({ ...settings, asana_pat_main: e.target.value })}
                        onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      />
                      <button className="flex-shrink-0 px-2 h-7 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={handleTestAsana}>Test</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={cfg('use_gcs', false)} onChange={e => set('use_gcs', e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[10px] font-semibold text-gray-700">5) GCS (Meta + Google)</span>
                </label>
                {cfg('use_gcs', false) && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={cfg('use_meta', true)} onChange={e => set('use_meta', e.target.checked)} className="w-3 h-3 accent-red-500" />
                        <span className="text-[9px] text-gray-600">Meta</span>
                      </label>
                      <input
                        type="text" className={inputCls} placeholder="Bucket Meta"
                        value={settings.gcs_streams?.Meta || ''} onChange={e => patchSettings({ ...settings, gcs_streams: { ...settings.gcs_streams, Meta: e.target.value } })}
                        onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={cfg('use_google', false)} onChange={e => set('use_google', e.target.checked)} className="w-3 h-3 accent-red-500" />
                        <span className="text-[9px] text-gray-600">Google</span>
                      </label>
                      <input
                        type="text" className={inputCls} placeholder="Bucket Google"
                        value={settings.gcs_streams?.Google || ''} onChange={e => patchSettings({ ...settings, gcs_streams: { ...settings.gcs_streams, Google: e.target.value } })}
                        onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      />
                    </div>
                    {cfg('use_google', false) && (
                      <div className="flex items-center gap-1">
                        <select className={inputCls} value={cfg('gcs_google_parent_folder', 'Application Tools T1')} onChange={e => set('gcs_google_parent_folder', e.target.value)}>
                          {(settings.gcs_google_channels_list || []).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button className="flex-shrink-0 px-2 h-7 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={() => setChannelManagerOpen(true)}>
                          <Settings2 size={10} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <input
                        type="text" className={inputCls} placeholder="Đường dẫn credentials JSON"
                        value={settings.gcs_credentials_global || ''} onChange={e => patchSettings({ ...settings, gcs_credentials_global: e.target.value })}
                        onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      />
                      <button className="flex-shrink-0 px-2 h-7 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={handleTestGcs}>Test</button>
                    </div>
                  </div>
                )}
                <div className="flex gap-1 mt-2">
                  <button
                    className="nodrag flex-1 py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                    disabled={isRunning}
                    onClick={() => runNms(id, 'upload_only')}
                  >
                    <Upload size={9} /> Upload NMS
                  </button>
                  <button
                    className="nodrag flex-1 py-1 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                    disabled={isRunning}
                    onClick={() => runNms(id, 'resize_upload')}
                  >
                    <Clapperboard size={9} /> Resize & Upload NMS
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-2.5">
                <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                  <input type="checkbox" checked={cfg('use_unc', true)} onChange={e => set('use_unc', e.target.checked)} className="w-3 h-3 accent-red-500" />
                  <span className="text-[10px] font-semibold text-gray-700">6) Chọn App</span>
                  <button className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={handleTestUnc}>Test UNC</button>
                </label>
                <div className="flex items-center gap-1 mb-1.5">
                  <Search size={10} className="text-gray-300 flex-shrink-0" />
                  <input type="text" className={inputCls} placeholder="Tìm app…" value={appSearch} onChange={e => setAppSearch(e.target.value)} onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} />
                  <button className="flex-shrink-0 px-1.5 h-7 rounded-md bg-gray-100 text-[9px] font-semibold text-gray-600 hover:bg-gray-200" onClick={() => setAppManagerOpen(true)}>Quản lý…</button>
                </div>
                {selectedApps.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {selectedApps.map(tag => (
                      <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-50 border border-red-100 text-[9px] text-red-700">
                        {tag}
                        <button onClick={() => toggleApp(tag)} className="text-red-300 hover:text-red-600"><X size={9} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="max-h-[90px] overflow-y-auto rounded-lg border border-gray-100">
                  {visibleAppTags.map(tag => (
                    <label key={tag} className="flex items-center gap-1.5 px-1.5 py-0.5 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selectedApps.includes(tag)} onChange={() => toggleApp(tag)} className="w-3 h-3 accent-red-500" />
                      <span className="text-[9px] text-gray-600 truncate">{apps[tag]?.pinned ? '⭐ ' : ''}{tag}</span>
                    </label>
                  ))}
                  {visibleAppTags.length === 0 && <div className="text-[9px] text-gray-400 text-center py-2">Không có app</div>}
                </div>
              </div>
            </div>

            {/* ===== Cột 3: Kết quả Links ===== */}
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="rounded-xl border border-gray-200 bg-white p-2.5 flex-1 min-h-0">
                <div className={labelCls}>7) Kết quả Links</div>
                {outLinks.unc.length === 0 && outLinks.gcs.length === 0 && (
                  <div className="text-[9px] text-gray-400 text-center py-4">Chưa có kết quả</div>
                )}
                {outLinks.unc.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[9px] text-gray-400 mb-1">📁 UNC nội bộ</div>
                    {outLinks.unc.map((l, i) => (
                      <div key={i} className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] text-gray-600 truncate flex-1" title={l}>{basename(l)}</span>
                        <CopyButton text={l} />
                      </div>
                    ))}
                  </div>
                )}
                {outLinks.gcs.length > 0 && (
                  <div>
                    <div className="text-[9px] text-gray-400 mb-1">📦 GCS</div>
                    {outLinks.gcs.map((l, i) => (
                      <div key={i} className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] text-gray-600 truncate flex-1" title={l}>{l.split('?')[0].split('/').pop()}</span>
                        <CopyButton text={l} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Run button + Save + progress + status */}
          <div className="flex gap-1.5 mt-3">
            <button
              className="nodrag flex-1 py-2 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              disabled={isRunning}
              onClick={() => runWorkflow(id)}
            >
              <Clapperboard size={12} /> RENDER & UPLOAD
            </button>
            <button
              className="nodrag flex-shrink-0 w-9 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center justify-center disabled:opacity-50"
              disabled={isRunning}
              title="Lưu phiên làm việc"
              onClick={handleSaveSession}
            >
              <Save size={13} />
            </button>
          </div>

          {(isRunning || progress) && (
            <div className="mt-2.5">
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full bg-red-500 transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="mt-1 text-[9px] text-gray-400 truncate">{progress?.message || `${progress?.percent ?? 0}%`}</div>
            </div>
          )}

          {testMsg && <div className="mt-2 text-[9px] text-center text-gray-500">{testMsg}</div>}

          {status === 'error' && (
            <div className="mt-2 text-center"><span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span></div>
          )}
          {status === 'done' && (
            <div className="mt-2 text-center"><span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200 inline-flex items-center gap-1"><CheckCircle2 size={10} />Hoàn tất</span></div>
          )}
        </div>

        <Handle
          type="target" id="folders_in" position={Position.Left} className="port-handle port-handle--input" data-label="Folders"
          style={{ background: PORT_COLOR, top: portPct(0, 1), left: -7, width: 14, height: 14, borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transform: 'translateY(-50%)' }}
        />
        <Handle
          type="source" id="unc_links" position={Position.Right} className="port-handle port-handle--output" data-label="UNC Links"
          style={{ background: PORT_COLOR, top: portPct(0, 3), right: -7, width: 14, height: 14, borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transform: 'translateY(-50%)' }}
        />
        <Handle
          type="source" id="gcs_links" position={Position.Right} className="port-handle port-handle--output" data-label="GCS Links"
          style={{ background: PORT_COLOR, top: portPct(1, 3), right: -7, width: 14, height: 14, borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transform: 'translateY(-50%)' }}
        />
        <Handle
          type="source" id="files_out" position={Position.Right} className="port-handle port-handle--output" data-label="Files"
          style={{ background: PORT_COLOR, top: portPct(2, 3), right: -7, width: 14, height: 14, borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transform: 'translateY(-50%)' }}
        />
      </div>

      {appManagerOpen && (
        <AppManagerModal apps={apps} onClose={() => { setAppManagerOpen(false); loadCatalog(); }} onReload={loadCatalog} />
      )}
      {channelManagerOpen && (
        <ChannelManagerModal settings={settings} onSave={patchSettings} onClose={() => setChannelManagerOpen(false)} />
      )}
      {taskSelectorOpen && (
        <TaskSelectorModal pat={settings.asana_pat_main || ''} onInsert={(urls) => {
          const current = cfg('task_urls', '').trim();
          set('task_urls', current ? `${current}\n${urls.join('\n')}` : urls.join('\n'));
        }} onClose={() => setTaskSelectorOpen(false)} />
      )}
      {inspectOpen && (
        <InspectFieldsModal pat={settings.asana_pat_main || ''} taskUrl={firstTaskUrl} onClose={() => setInspectOpen(false)} />
      )}
    </div>
  );
}

