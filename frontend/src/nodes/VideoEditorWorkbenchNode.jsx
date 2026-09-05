// 08-E E1/E2/E3 minimal slice (specs/.../08-v2/08-e-editor-node-and-workbench.md): the node only
// ever holds `config.projectId` (a stable ref) — never the mutable timeline document itself, per
// "Node JSON chỉ giữ canonical refs và rebuildable summary" (§2). The projection card below is
// re-fetched from the 08-B endpoint on mount/projectId change, never cached into node config.
import { useEffect, useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Settings2, Clapperboard, ExternalLink, Loader2 } from 'lucide-react';
import { useStore } from '../store.js';
import { createVideoProject, fetchTimelineCollection, videoVersionRequest } from '../lib/api.js';
import { createDefaultProjectPayload } from '../video/defaultProject.js';
import { portGlyph, portStyle } from './portStyle.jsx';

// 08-E E6 minimal (specs/.../08-v2/08-e-editor-node-and-workbench.md): render state label for the
// node card — reuses backend/routes/video-projects.js's renderState (video_render_jobs, no named-
// version/review concept invented). renderState is undefined for a project created before this
// field existed (no migration needed, just render nothing).
function renderStateLabel(renderState) {
  if (!renderState) return null;
  if (!renderState.lastJobId) return 'Chưa render';
  if (renderState.lastJobStatus === 'running' || renderState.lastJobStatus === 'queued') return 'Đang render…';
  if (renderState.lastJobStatus === 'error') return 'Render lỗi';
  if (renderState.isStale) return 'Cần render lại';
  return 'Đã render';
}

function renderStateColor(renderState) {
  if (!renderState?.lastJobId) return 'var(--n400,#9ca3af)';
  if (renderState.lastJobStatus === 'error') return '#ef4444';
  if (renderState.lastJobStatus === 'running' || renderState.lastJobStatus === 'queued') return '#3b82f6';
  if (renderState.isStale) return '#f59e0b';
  return '#10b981';
}

export default function VideoEditorWorkbenchNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const projectId = config.projectId || '';

  const [summary, setSummary] = useState(null); // { name, latestSeq, renderState } | null
  const [summaryError, setSummaryError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [versions, setVersions] = useState([]);

  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive = useStore(s => s.nodeActive);

  const isActive = nodeActive[id] !== false;
  const NODE_W = width || 200;

  useEffect(() => {
    if (!projectId) { setSummary(null); return; }
    let cancelled = false;
    fetchTimelineCollection(projectId)
      .then(({ timeline, version, renderState }) => {
        if (cancelled) return;
        setSummary({ name: timeline.name, latestSeq: version.id.split(':').pop(), renderState });
        setSummaryError(null);
      })
      .catch(err => { if (!cancelled) setSummaryError(err.message); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) { setVersions([]); return undefined; }
    let disposed = false;
    const refresh = () => videoVersionRequest(projectId).then(v => { if (!disposed) setVersions(v); }).catch(e => { if (!disposed) setSummaryError(e.message); });
    refresh();
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener('focus', refresh); };
  }, [projectId]);

  // "Mở Editor" tự tạo project rỗng khi node chưa bind gì (first open) — cùng payload mặc định
  // loadOrCreateProject() dùng — rồi lưu id ĐÓ vào config để những lần mở sau deep-link lại đúng
  // project cũ, không tạo mới mỗi lần bấm.
  const handleOpenEditor = async () => {
    setOpening(true);
    try {
      let openId = projectId;
      if (!openId) {
        const created = await createVideoProject(manifest.name || 'Untitled Project', createDefaultProjectPayload());
        openId = created.id;
        updateNodeConfig(id, 'projectId', openId);
      }
      window.open(`/video?projectId=${openId}`, '_blank');
    } catch (err) {
      setSummaryError(err.message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="relative flex flex-col" style={{ width: NODE_W, opacity: isActive ? 1 : 0.4 }}>
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
            onClick={() => runWorkflow(id)}
          >
            <Play size={12} className="text-[var(--sub,#374151)]" />
          </button>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" onClick={() => deleteNode(id)}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl p-3 flex flex-col gap-2 transition-shadow ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
      >
        <div className="flex items-center gap-2 text-[var(--n500,#6b7280)]">
          <Clapperboard size={16} />
          <span className="text-xs truncate">{summary?.name || (projectId ? 'Đang tải…' : 'Chưa gắn timeline')}</span>
        </div>
        {summary && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--n400,#9ca3af)]">v{summary.latestSeq}</span>
            <span className="text-[10px]" style={{ color: renderStateColor(summary.renderState) }}>
              {renderStateLabel(summary.renderState)}
            </span>
          </div>
        )}
        {summaryError && (
          <span className="text-[10px] text-red-500 truncate" title={summaryError}>{summaryError}</span>
        )}
        <button
          type="button"
          onClick={handleOpenEditor}
          disabled={opening}
          className="nodrag flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg bg-[var(--accent,#7C5CFA)] text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {opening ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
          Mở Editor
        </button>

        {projectId && <label className="nodrag text-xs text-[var(--n600)]">Bản ghim để chạy
          <select aria-label="Bản ghim để chạy" value={config.versionId || ''} onFocus={() => videoVersionRequest(projectId).then(setVersions).catch(e => setSummaryError(e.message))} onChange={e => updateNodeConfig(id, 'versionId', e.target.value)} className="w-full mt-1 border rounded px-1 py-2 bg-[var(--card)]">
            <option value="">Chọn bản lưu trong Editor</option>
            {versions.map(v => <option key={v.id} value={v.id}>{v.name} · r{v.seq}{v.staleDependencies ? ' · Media đã đổi' : ''}</option>)}
          </select>
        </label>}
        <Handle type="target" id="timeline_collection" position={Position.Left} className="port-handle" data-label="Timeline đã ghim" style={portStyle('any', 0, 1, 'left')}>{portGlyph('any')}</Handle>
        <Handle
          type="source"
          id="timeline_collection"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Timeline Collection"
          style={portStyle('any', 0, 1, 'right')}
        >
          {portGlyph('any')}
        </Handle>
      </div>
    </div>
  );
}
