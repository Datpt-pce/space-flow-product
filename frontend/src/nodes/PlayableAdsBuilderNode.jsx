import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown, Plus, X, Video, Download, Clapperboard, Lock } from 'lucide-react';
import { useStore } from '../store.js';
import { downloadZip } from '../lib/api.js';
import { resolveDropPaths } from '../lib/dropResolve.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const DEFAULT_W = 340;
const MIN_W = 280, MAX_W = 640, MIN_H = 260, MAX_H = 760;

const NETWORKS = ['applovin', 'google', 'mintegral', 'moloco', 'unity'];

const STATE_FLAGS = [
  ['loop', 'Loop'],
  ['pauseBeforeExit', 'Pause before exit'],
  ['exitOnClick', 'Exit on click'],
  ['openOnEnter', 'Open download on enter'],
  ['openOnClick', 'Open download on click'],
];

function newState() {
  return {
    _key: Math.random().toString(36).slice(2, 9),
    start: 0, end: 5, loop: true, pauseBeforeExit: false, exitOnClick: false,
    openOnEnter: false, openOnClick: true,
    cursorOn: false, cursorX: 50, cursorY: 50, cursorScale: 100,
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

function StateCard({ st, index, onChange, onRemove, removable }) {
  const patch = (key, val) => onChange({ ...st, [key]: val });

  return (
    <div className="rounded-xl border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] p-2.5 mb-2 nodrag">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-[var(--sub,#374151)]">State {index + 1}</span>
        {removable && (
          <button
            className="p-1 rounded-md hover:bg-red-50 text-[var(--n400,#9ca3af)] hover:text-red-500 transition-colors"
            title="Xóa state"
            onClick={onRemove}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <label className="flex-1">
          <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-0.5">Start time (s)</span>
          <input
            type="number" step="0.01" min={0}
            className="w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
            value={st.start}
            onChange={e => patch('start', Number(e.target.value))}
          />
        </label>
        <label className="flex-1">
          <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-0.5">End time (s)</span>
          <input
            type="number" step="0.01" min={0}
            className="w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
            value={st.end}
            onChange={e => patch('end', Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        {STATE_FLAGS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!st[key]}
              onChange={e => patch(key, e.target.checked)}
              className="w-3 h-3 accent-violet-500"
            />
            <span className="text-[10px] text-[var(--sub,#4b5563)]">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function PlayableAdsBuilderNode({ id, data, selected, width }) {
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
  const pickFile         = useStore(s => s.pickFile);

  const status    = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  const isActive  = nodeActive[id] !== false;
  const reachable = countReachable(nodes, edges, id);
  const progress  = nodeProgress[id];
  const outFiles  = nodeOutputs[id]?.files_out;

  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);

  const states = cfg('states', null) || [newState()];
  const setStates = (next) => set('states', next);
  const updateState = (idx, next) => {
    const copy = states.slice();
    copy[idx] = next;
    setStates(copy);
  };
  const removeState = (idx) => setStates(states.filter((_, i) => i !== idx));
  const addState = () => setStates([...states, newState()]);

  const networks = cfg('networks', null) || NETWORKS;
  const toggleNetwork = (n) => set('networks',
    networks.includes(n) ? networks.filter(x => x !== n) : [...networks, n]);

  const videoPath = cfg('video_path', '');

  // Nối node List vào port videos_in => title đồng bộ tự động theo tên từng video (execute.js),
  // ô Title/drop-zone thủ công không còn ý nghĩa nên khoá lại tránh gây hiểu nhầm.
  const videosInEdge = edges.find(e => e.target === id && e.targetHandle === 'videos_in');
  const videosInSource = videosInEdge ? nodes.find(n => n.id === videosInEdge.source) : null;
  const videosInCount = Array.isArray(videosInSource?.data?.config?.files)
    ? videosInSource.data.config.files.length
    : null;
  const videosInLocked = !!videosInEdge;

  const handleDropVideo = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (videosInLocked) return;
    const paths = await resolveDropPaths(e);
    if (paths[0]) set('video_path', paths[0]);
  };
  const handleChooseVideo = async () => {
    if (videosInLocked) return;
    const path = await pickFile('media');
    if (path) set('video_path', path);
  };

  const handleDelete = () => { deleteNode(id); };

  const handleDownloadAll = () => {
    const paths = (outFiles || []).map(it => it?.binary?.data?.path).filter(Boolean);
    if (paths.length) downloadZip(paths);
  };

  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
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
            <Link2 size={12} />
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
              ? 'ring-2 ring-violet-500 shadow-lg'
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

        <div className="rounded-2xl bg-[var(--n50,#f9fafb)] p-3 overflow-y-auto flex-1 min-h-0">

          {/* Title / URL */}
          <div className="nodrag mb-2">
            <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-0.5">
              Title (sets &lt;title&gt;){videosInLocked && ' — tự động theo tên video'}
            </span>
            <input
              type="text"
              disabled={videosInLocked}
              className="w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400 disabled:bg-[var(--n100,#f3f4f6)] disabled:text-[var(--n400,#9ca3af)]"
              placeholder={videosInLocked ? 'Tự động theo tên từng video trong List' : 'e.g. OneClick_LearnA1_A20B1C1D1E1F1G3_PLA_EN'}
              value={videosInLocked ? '' : cfg('title', '')}
              onChange={e => set('title', e.target.value)}
            />
          </div>
          <div className="nodrag mb-2">
            <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-0.5">Android Store URL</span>
            <input
              type="text"
              className="w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
              placeholder="https://play.google.com/store/apps/details?id=..."
              value={cfg('linkDownloadAndroid', '')}
              onChange={e => set('linkDownloadAndroid', e.target.value)}
            />
          </div>
          <div className="nodrag mb-2">
            <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-0.5">iOS Store URL</span>
            <input
              type="text"
              className="w-full h-6 px-2 rounded-md border border-[var(--card-border,#e5e7eb)] text-[10px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-violet-400"
              placeholder="https://apps.apple.com/app/id..."
              value={cfg('linkDownloadIos', '')}
              onChange={e => set('linkDownloadIos', e.target.value)}
            />
          </div>

          {/* Video drop-zone / locked banner khi đã nối node List vào videos_in */}
          {videosInLocked ? (
            <div className="nodrag mb-3 rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-center">
              <Lock size={14} className="mx-auto mb-1 text-violet-500" />
              <div className="text-[10px] font-semibold text-violet-700">
                Đã nhận input video từ node List{videosInCount != null ? ` (${videosInCount} video)` : ''}
              </div>
            </div>
          ) : (
            <div
              className="nodrag mb-3 rounded-xl border border-dashed border-[var(--card-border,#e5e7eb)] p-2.5 text-center cursor-pointer hover:border-violet-300 transition-colors"
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={handleDropVideo}
              onClick={handleChooseVideo}
            >
              <Video size={14} className="mx-auto mb-1 text-[var(--n400,#9ca3af)]" />
              <div className="text-[10px] font-semibold text-[var(--sub,#374151)]">
                {videoPath ? 'Drop MP4 để thay đổi hoặc click để chọn' : 'Drop MP4 hoặc click để chọn'}
              </div>
              {videoPath && (
                <div className="mt-1 text-[9px] text-violet-600 truncate">{videoPath.split(/[\\/]/).pop()}</div>
              )}
            </div>
          )}

          {/* States */}
          {states.map((st, i) => (
            <StateCard
              key={st._key || i}
              st={st}
              index={i}
              removable={states.length > 1}
              onChange={(next) => updateState(i, next)}
              onRemove={() => removeState(i)}
            />
          ))}
          <button
            className="nodrag w-full py-1.5 rounded-lg border border-dashed border-violet-200 text-violet-500 text-[10px] font-semibold hover:bg-violet-50 transition-colors mb-3 flex items-center justify-center gap-1"
            onClick={addState}
          >
            <Plus size={11} /> Add state
          </button>

          {/* Networks */}
          <div className="mb-3 nodrag">
            <span className="block text-[9px] text-[var(--n400,#9ca3af)] mb-1">Networks</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {NETWORKS.map(n => (
                <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={networks.includes(n)}
                    onChange={() => toggleNetwork(n)}
                    className="w-3 h-3 accent-violet-500"
                  />
                  <span className="text-[10px] text-[var(--sub,#4b5563)] capitalize">{n}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Export */}
          <button
            className="nodrag w-full py-2 rounded-lg bg-violet-600 text-white text-[11px] font-semibold hover:bg-violet-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            disabled={isRunning}
            onClick={() => runWorkflow(id)}
          >
            <Clapperboard size={12} /> Export Playable
          </button>

          {/* Progress */}
          {(isRunning || progress) && (
            <div className="mt-2.5 nodrag">
              <div className="h-1.5 rounded-full bg-[var(--n200,#e5e7eb)] overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <div className="mt-1 text-[9px] text-[var(--n400,#9ca3af)] truncate">
                {progress?.message || `${progress?.percent ?? 0}%`}
              </div>
            </div>
          )}

          {/* Status + download all */}
          {status === 'error' && (
            <div className="mt-2 text-center">
              <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span>
            </div>
          )}
          {status === 'done' && outFiles?.length > 0 && (
            <button
              className="nodrag w-full mt-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-[var(--sub,#374151)] text-[10px] font-semibold hover:border-violet-300 hover:text-violet-600 transition-colors flex items-center justify-center gap-1.5"
              onClick={handleDownloadAll}
            >
              <Download size={11} /> Tải tất cả ({outFiles.length}) .zip
            </button>
          )}
        </div>

        {/* Input port: videos_in */}
        <Handle
          type="target"
          id="videos_in"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Videos"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>

        {/* Output port: files_out */}
        <Handle
          type="source"
          id="files_out"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Playable HTML"
          style={portStyle('array', 0, 1, 'right')}
        >
          {portGlyph('array')}
        </Handle>
      </div>
    </div>
  );
}
