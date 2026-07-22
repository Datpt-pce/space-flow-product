import { useState, useEffect } from 'react';
import { Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown, Folder, Video, Music, X, Plus, Clapperboard, RotateCw } from 'lucide-react';
import { useStore } from '../store.js';
import { resolveDrop, restartCapcut, fetchSystemStatus } from '../lib/api.js';
import { ResizeControls } from './resizable.jsx';

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const DEFAULT_W = 320;
const MIN_W = 260, MAX_W = 640, MIN_H = 200, MAX_H = 700;

const TRANSITIONS = ['Pull in', 'Zoom far', 'Slide left', 'Slide right', 'Fade', 'Wipe', 'Cross dissolve', 'Spin'];

function newTimeline(n) {
  return {
    _key: Math.random().toString(36).slice(2, 9),
    name: `Timeline ${n}`,
    video_sources: [],
    music_files: [],
    music_volume_db: 0,
    transitions_enabled: false,
    transitions: [],
    text_template: false,
  };
}

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

async function resolveDropPaths(e) {
  const text = e.dataTransfer.getData('text/plain');
  if (text) return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const internal = e.dataTransfer.getData('space-flow-file');
  if (internal) return [internal];

  const names = [];
  const items = [];
  const dtItems = e.dataTransfer.items;
  if (dtItems && dtItems.length > 0) {
    for (let i = 0; i < dtItems.length; i++) {
      const it = dtItems[i];
      if (it.kind !== 'file') continue;
      const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      const f = it.getAsFile ? it.getAsFile() : null;
      const name = entry ? entry.name : f?.name;
      if (!name) continue;
      names.push(name);
      items.push({ name, size: f?.size ?? null, isDir: entry ? entry.isDirectory : false });
    }
  } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    Array.from(e.dataTransfer.files).forEach(f => {
      names.push(f.name);
      items.push({ name: f.name, size: f.size ?? null, isDir: false });
    });
  }

  if (!names.length) return [];
  const { paths } = await resolveDrop(names, items);
  return paths || [];
}

function TimelineCard({ timeline, onChange, onRemove }) {
  const pickFolder = useStore(s => s.pickFolder);
  const [transOpen, setTransOpen] = useState(false);
  const [videoPathInput, setVideoPathInput] = useState('');
  const [musicPathInput, setMusicPathInput] = useState('');

  const patch = (key, val) => onChange({ ...timeline, [key]: val });

  const addVideo = async () => {
    const path = await pickFolder();
    if (path) patch('video_sources', [...timeline.video_sources, path]);
  };
  const addMusic = async () => {
    const path = await pickFolder();
    if (path) patch('music_files', [...timeline.music_files, path]);
  };
  const addVideoManual = () => {
    const v = videoPathInput.trim();
    if (!v) return;
    patch('video_sources', [...timeline.video_sources, v]);
    setVideoPathInput('');
  };
  const addMusicManual = () => {
    const v = musicPathInput.trim();
    if (!v) return;
    patch('music_files', [...timeline.music_files, v]);
    setMusicPathInput('');
  };
  const removeVideo = (i) => patch('video_sources', timeline.video_sources.filter((_, idx) => idx !== i));
  const removeMusic = (i) => patch('music_files', timeline.music_files.filter((_, idx) => idx !== i));

  const toggleTransition = (name) => {
    const cur = timeline.transitions || [];
    const next = cur.includes(name) ? cur.filter(t => t !== name) : [...cur, name];
    patch('transitions', next);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5 mb-2 nodrag">
      <div className="flex items-center gap-1.5 mb-2">
        <input
          className="flex-1 h-6 px-2 rounded-md border border-gray-200 text-[11px] font-semibold text-gray-700 bg-white focus:outline-none focus:border-violet-400"
          value={timeline.name}
          onChange={e => patch('name', e.target.value)}
        />
        <button
          className="flex-shrink-0 p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          title="Xóa timeline"
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      </div>

      {/* Video drop-zone */}
      <div
        className="flex items-center gap-1.5 mb-1.5"
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={async e => { e.preventDefault(); e.stopPropagation(); const paths = await resolveDropPaths(e); if (paths.length) patch('video_sources', [...timeline.video_sources, ...paths]); }}
      >
        <span className="text-[9px] text-gray-400 flex-1 truncate">Kéo thả video vào đây</span>
        <button className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-600 text-[9px] font-semibold hover:bg-violet-100 transition-colors" onClick={addVideo}>
          <Plus size={9} /> Thêm
        </button>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <input
          type="text"
          className="flex-1 h-5 px-1.5 rounded-md border border-gray-200 text-[9px] text-gray-700 bg-white focus:outline-none focus:border-violet-400"
          placeholder="Dán đường dẫn video..."
          value={videoPathInput}
          onChange={e => setVideoPathInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addVideoManual(); }}
        />
        <button className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors" onClick={addVideoManual}>
          <Plus size={9} />
        </button>
      </div>
      {timeline.video_sources.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {timeline.video_sources.map((p, i) => (
            <span key={i} className="flex items-center gap-1 max-w-[130px] px-1.5 py-0.5 rounded-md bg-sky-50 border border-sky-100 text-[9px] text-sky-700">
              <Video size={9} className="flex-shrink-0" />
              <span className="truncate">{p.split(/[\\/]/).pop()}</span>
              <button onClick={() => removeVideo(i)} className="flex-shrink-0 text-sky-400 hover:text-red-500"><X size={9} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Music drop-zone */}
      <div
        className="flex items-center gap-1.5 mb-1.5"
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={async e => { e.preventDefault(); e.stopPropagation(); const paths = await resolveDropPaths(e); if (paths.length) patch('music_files', [...timeline.music_files, ...paths]); }}
      >
        <span className="text-[9px] text-gray-400 flex-1 truncate">Kéo thả file nhạc vào đây</span>
        <button className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-600 text-[9px] font-semibold hover:bg-violet-100 transition-colors" onClick={addMusic}>
          <Plus size={9} /> Thêm
        </button>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <input
          type="text"
          className="flex-1 h-5 px-1.5 rounded-md border border-gray-200 text-[9px] text-gray-700 bg-white focus:outline-none focus:border-violet-400"
          placeholder="Dán đường dẫn nhạc..."
          value={musicPathInput}
          onChange={e => setMusicPathInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addMusicManual(); }}
        />
        <button className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors" onClick={addMusicManual}>
          <Plus size={9} />
        </button>
      </div>
      {timeline.music_files.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {timeline.music_files.map((p, i) => (
            <span key={i} className="flex items-center gap-1 max-w-[130px] px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-100 text-[9px] text-amber-700">
              <Music size={9} className="flex-shrink-0" />
              <span className="truncate">{p.split(/[\\/]/).pop()}</span>
              <button onClick={() => removeMusic(i)} className="flex-shrink-0 text-amber-400 hover:text-red-500"><X size={9} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Volume slider */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-gray-400">Music</span>
          <span className="text-[9px] font-semibold text-violet-600">{timeline.music_volume_db} dB</span>
        </div>
        <input
          type="range" min={-36} max={36} step={1}
          value={timeline.music_volume_db}
          onChange={e => patch('music_volume_db', Number(e.target.value))}
          className="w-full accent-violet-500 h-1"
        />
        <div className="flex justify-between text-[8px] text-gray-300">
          <span>-36 dB</span>
          <span>+36 dB</span>
        </div>
      </div>

      {/* Transition + Text-template */}
      <div className="flex items-center gap-3 pt-1.5 border-t border-gray-100">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={timeline.transitions_enabled}
            onChange={e => patch('transitions_enabled', e.target.checked)}
            className="w-3 h-3 accent-violet-500"
          />
          <span className="text-[10px] text-gray-600">Transition</span>
        </label>
        {timeline.transitions_enabled && (
          <div className="relative">
            <button
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-gray-200 text-[9px] text-gray-600 hover:border-violet-300 transition-colors"
              onClick={() => setTransOpen(o => !o)}
            >
              {timeline.transitions.length ? `${timeline.transitions.length} đã chọn` : 'Chọn...'}
              <ChevronDown size={9} />
            </button>
            {transOpen && (
              <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[9999] min-w-[130px] max-h-[160px] overflow-y-auto">
                {TRANSITIONS.map(name => (
                  <label key={name} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={timeline.transitions.includes(name)}
                      onChange={() => toggleTransition(name)}
                      className="w-3 h-3 accent-violet-500"
                    />
                    <span className="text-[9px] text-gray-700">{name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={timeline.text_template}
            onChange={e => patch('text_template', e.target.checked)}
            className="w-3 h-3 accent-violet-500"
          />
          <span className="text-[10px] text-gray-600">Text-template</span>
        </label>
      </div>
    </div>
  );
}

export default function CapcutGenerateNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const [runOpen, setRunOpen] = useState(false);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodeProgress     = useStore(s => s.nodeProgress);
  const nodeOutputs      = useStore(s => s.nodeOutputs);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive       = useStore(s => s.nodeActive);
  const pickFolder       = useStore(s => s.pickFolder);

  const status    = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive  = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);
  const progress  = nodeProgress[id];
  const outPath   = nodeOutputs[id]?.project_path;

  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const timelines = cfg('timelines', null) || [newTimeline(1)];
  const setTimelines = (next) => set('timelines', next);
  const updateTimeline = (idx, next) => {
    const copy = timelines.slice();
    copy[idx] = next;
    setTimelines(copy);
  };
  const removeTimeline = (idx) => setTimelines(timelines.filter((_, i) => i !== idx));
  const addTimeline = () => setTimelines([...timelines, newTimeline(timelines.length + 1)]);

  const handleBrowseCapcutDir = async () => {
    const path = await pickFolder();
    if (path) set('capcut_dir', path);
  };

  const handleDelete = () => { deleteNode(id); };

  const [restarting, setRestarting] = useState(false);
  const [capcutRestartAvailable, setCapcutRestartAvailable] = useState(true);
  useEffect(() => {
    fetchSystemStatus().then(res => setCapcutRestartAvailable(res.available !== false)).catch(() => {});
  }, []);
  const handleRestartCapcut = async () => {
    setRestarting(true);
    try {
      const result = await restartCapcut();
      if (result?.error) alert(result.error);
    } finally {
      setRestarting(false);
    }
  };

  const nodeW = width || DEFAULT_W;

  return (
    <div className="flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
              onClick={() => setRunOpen(o => !o)}
            >
              <Play size={12} className="text-gray-700" />
              <ChevronDown size={9} className="text-gray-400" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-[9999] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(id); setRunOpen(false); }}
                >
                  <span className="text-[11px] font-medium text-gray-800">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{reachable} nodes</span>
                </button>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(null); setRunOpen(false); }}
                >
                  <span className="text-[11px] text-gray-600">All workflow</span>
                  <span className="ml-auto text-[10px] text-gray-400">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Open config" onClick={() => selectNode(id)}>
            <Link2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" title="Duplicate" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="flex items-center justify-between mb-1 pl-0.5" style={{ maxWidth: '100%' }}>
        <div className="text-[11px] text-gray-400 font-medium select-none truncate">
          {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
        </div>
        <button
          className="nodrag flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white border border-gray-200 text-[9px] font-semibold text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors disabled:opacity-50"
          title={capcutRestartAvailable ? 'Kill CapCut đang mở (nếu có) và mở phiên mới' : 'Không khả dụng trong môi trường product (Docker) — chỉ chạy được trên Windows dev native'}
          disabled={restarting || !capcutRestartAvailable}
          onClick={handleRestartCapcut}
        >
          <RotateCw size={9} className={restarting ? 'animate-spin' : ''} /> Capcut
        </button>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-violet-500 shadow-lg'
              : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        <div className="rounded-2xl bg-gray-50 p-3 overflow-y-auto flex-1 min-h-0">

          {/* Thiết lập */}
          <div className="flex items-center gap-1.5 mb-3 nodrag">
            <Folder size={11} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              className="flex-1 h-6 px-2 rounded-md border border-gray-200 text-[10px] text-gray-700 bg-white focus:outline-none focus:border-violet-400"
              placeholder="CapCut dir (trống = auto)"
              value={cfg('capcut_dir', '')}
              onChange={e => set('capcut_dir', e.target.value)}
            />
            <button className="flex-shrink-0 px-2 h-6 rounded-md bg-violet-50 text-violet-600 text-[9px] font-semibold hover:bg-violet-100 transition-colors" onClick={handleBrowseCapcutDir}>
              Chọn
            </button>
          </div>

          {/* Timelines */}
          {timelines.map((t, i) => (
            <TimelineCard
              key={t._key || i}
              timeline={t}
              onChange={(next) => updateTimeline(i, next)}
              onRemove={() => removeTimeline(i)}
            />
          ))}

          <button
            className="nodrag w-full py-1.5 rounded-lg border border-dashed border-violet-200 text-violet-500 text-[10px] font-semibold hover:bg-violet-50 transition-colors mb-3"
            onClick={addTimeline}
          >
            + Thêm Timeline
          </button>

          {/* Tạo Project */}
          <button
            className="nodrag w-full py-2 rounded-lg bg-violet-600 text-white text-[11px] font-semibold hover:bg-violet-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            disabled={isRunning}
            onClick={() => runWorkflow(id)}
          >
            <Clapperboard size={12} /> Tạo Project
          </button>

          {/* Progress */}
          {(isRunning || progress) && (
            <div className="mt-2.5 nodrag">
              <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="mt-1 text-[9px] text-gray-400 truncate">
                {progress?.message || `${progress?.percent ?? 0}%`}
              </div>
            </div>
          )}

          {/* Status */}
          {status === 'error' && (
            <div className="mt-2 text-center">
              <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span>
            </div>
          )}
          {status === 'done' && outPath && (
            <div className="mt-2 text-center">
              <span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">✓ Đã tạo project</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
