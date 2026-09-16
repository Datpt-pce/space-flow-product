// Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5): "chọn render preset,
// danh sách job (progress bar, cancel, retry, log giới hạn dung lượng)".
//
// Phase 16 (§0): a REAL preset dropdown now exists — `EXPORT_PRESETS` below is a hardcoded label
// list, duplicated (not fetched) from backend/video/renderPresets.js's own RENDER_PRESETS ids,
// same "small static table, kept in sync by eye" precedent this codebase already accepts for
// CURVES_PRESETS/BLEND_MODES elsewhere in EffectsPanel.jsx — a 3-entry list doesn't justify a
// network round-trip. `renderJobs` (Phase 4) already lists every job with its own status
// including 'queued' — Phase 16's render QUEUE (backend/routes/video-render.js) needs NO changes
// here at all: a job queued behind another render for this SAME owner just stays visibly 'queued'
// (STATUS_LABEL below, unchanged) until its turn comes, exactly like the pre-Phase-16 "queued for
// an instant before starting" state already rendered.
import { useEffect, useState } from 'react';
import { X, Download, Loader2, XCircle, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useVideoStore } from '../store.js';
import { useDialogFocus } from '../useDialogFocus.js';
import CapCutHandoffDialog from './CapCutHandoffDialog.jsx';

const EXPORT_PRESETS = [
  { id: 'original', label: 'Gốc (theo project)' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p (nhẹ hơn)' },
];

const STATUS_LABEL = {
  queued: 'Đang chờ…',
  running: 'Đang render…',
  done: 'Hoàn tất',
  error: 'Lỗi',
  cancelled: 'Đã huỷ',
};

const STATUS_ICON = {
  queued: Loader2,
  running: Loader2,
  done: CheckCircle2,
  error: AlertCircle,
  cancelled: XCircle,
};

const STATUS_CLASS = {
  queued: 'text-[var(--n600,#4b5563)]',
  running: 'text-[var(--video-info)]',
  done: 'text-[var(--video-success)]',
  error: 'text-[var(--video-error)]',
  cancelled: 'text-[var(--n600,#4b5563)]',
};

export default function ExportPanel() {
  const isOpen = useVideoStore((s) => s.isExportPanelOpen);
  const closeExportPanel = useVideoStore((s) => s.closeExportPanel);
  const renderJobs = useVideoStore((s) => s.renderJobs);
  const exportError = useVideoStore((s) => s.exportError);
  const clearExportError = useVideoStore((s) => s.clearExportError);
  const loadRenderJobs = useVideoStore((s) => s.loadRenderJobs);
  const startExport = useVideoStore((s) => s.startExport);
  const cancelExport = useVideoStore((s) => s.cancelExport);
  const retryExport = useVideoStore((s) => s.retryExport);
  const projectState = useVideoStore((s) => s.projectState);
  const project = useVideoStore((s) => s.project);
  const pendingCommands = useVideoStore((s) => s.pendingCommands);
  const saveStatus = useVideoStore((s) => s.saveStatus);
  const staleVersionDetected = useVideoStore((s) => s.staleVersionDetected);
  const isExportSubmitting = useVideoStore((s) => s.isExportSubmitting);
  const capabilitySnapshot = useVideoStore((s) => s.capabilitySnapshot);
  const loadCapabilitySnapshot = useVideoStore((s) => s.loadCapabilitySnapshot);
  const [presetId, setPresetId] = useState('original');
  const [capcutJob, setCapcutJob] = useState(null);
  const dialogRef = useDialogFocus(closeExportPanel, isOpen && !capcutJob);

  useEffect(() => {
    if (!isOpen) return;
    loadRenderJobs();
    loadCapabilitySnapshot();
  }, [isOpen, project?.id, loadRenderJobs, loadCapabilitySnapshot]);

  if (!isOpen) return null;
  if (capcutJob) return <CapCutHandoffDialog job={capcutJob} projectName={project?.name} onClose={() => setCapcutJob(null)} />;

  const hasVideoClips = projectState?.tracks?.some((t) => t.type !== 'audio' && t.visible !== false && t.clips.length > 0);
  const unsaved = pendingCommands.length > 0 || saveStatus === 'error' || staleVersionDetected;
  // 08-C C6: only a DEFINITIVE ok:false blocks export (a missing/incomplete ffmpeg on the machine
  // that will actually run the render job) — capabilitySnapshot staying null (check unreachable,
  // e.g. a transient hiccup) must never block an export that might still succeed.
  const capabilityBlocked = capabilitySnapshot ? !capabilitySnapshot.ok : false;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeExportPanel(); }}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="export-panel-title" className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden" style={{ width: 480, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(560px, calc(100dvh - 32px))' }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h2 id="export-panel-title" className="text-base font-semibold text-[var(--text,#111827)]">Export</h2>
          <button onClick={closeExportPanel} aria-label="Đóng export" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n600,#4b5563)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--n600,#4b5563)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          <div className="rounded-xl border border-[var(--card-border,#e5e7eb)] p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[var(--text,#111827)]">MP4 — H.264 / AAC</p>
                <p className="text-[11px] text-[var(--n600,#4b5563)]">Độ phân giải theo preset đã chọn, fps theo project</p>
              </div>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                title="Preset xuất video"
                aria-label="Preset xuất video"
                className="h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
              >
                {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <button
              onClick={() => startExport(presetId)}
              disabled={!hasVideoClips || capabilityBlocked || unsaved || isExportSubmitting}
              className="self-end px-3 h-8 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] disabled:opacity-40 hover:bg-[var(--n800,#1f2937)] inline-flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1"
            >
              {isExportSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {isExportSubmitting ? 'Đang gửi…' : 'Bắt đầu export'}
            </button>
          </div>
          {!hasVideoClips && <p className="text-[11px] text-[var(--n600,#4b5563)]">Timeline chưa có nội dung hình ảnh đang hiển thị để export.</p>}
          {unsaved && <p role="status" className="text-xs text-[var(--n600,#4b5563)]">Đang chờ lưu và đồng bộ thay đổi. Đóng Export để xử lý nếu có lỗi lưu hoặc xung đột.</p>}

          {/* 08-C C6: proactive capability warning — catches a machine missing ffmpeg/an encoder
              BEFORE the user waits for a render job that would fail anyway (ADR 0031). */}
          {capabilityBlocked && (
            <div className="px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-xs flex flex-col gap-1">
              <span className="font-medium">Máy chạy render hiện chưa đủ điều kiện export:</span>
              <ul className="list-disc list-inside">
                {capabilitySnapshot.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {exportError && (
            <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs flex items-center justify-between gap-2">
              <span>{exportError}</span>
              <button onClick={clearExportError} className="shrink-0 font-medium hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded">Đóng</button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {renderJobs.length === 0 && (
              <p className="text-xs text-[var(--n600,#4b5563)] py-4 text-center">Chưa có lần export nào.</p>
            )}
            {renderJobs.map((job) => {
              const Icon = STATUS_ICON[job.status] || Loader2;
              const spinning = job.status === 'queued' || job.status === 'running';
              return (
                <div key={job.id} data-render-job-id={job.id} className="rounded-xl border border-[var(--card-border,#e5e7eb)] p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_CLASS[job.status] || ''}`}>
                      <Icon size={13} className={spinning ? 'animate-spin' : ''} />
                      {STATUS_LABEL[job.status] || job.status}
                    </span>
                    <div className="flex items-center gap-2">
                      {spinning && (
                        <button onClick={() => cancelExport(job.id)} className="text-[11px] font-medium text-[var(--video-error)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded">Huỷ</button>
                      )}
                      {(job.status === 'error' || job.status === 'cancelled') && (
                        <button onClick={() => retryExport(job.id)} disabled={unsaved || isExportSubmitting} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--video-info)] hover:underline disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded">
                          <RotateCcw size={11} /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] text-[var(--n600,#4b5563)]">{job.preset_id || 'original'}{job.pinned_seq != null ? ` · Bản r${job.pinned_seq}` : ''}</span>
                  {job.status === 'done' && (
                    <button onClick={() => setCapcutJob(job)} className="self-start text-xs font-medium text-[var(--accent)] underline rounded">Chuyển sang CapCut</button>
                  )}
                  {job.status === 'done' && (
                    <a href={`/api/video-render/${project.id}/render/${job.id}/download`} download className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent,#7C5CFA)] underline rounded focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)]">
                      <Download size={14} /> Tải video MP4
                    </a>
                  )}
                  {spinning && (
                    <div className="h-1.5 rounded-full bg-[var(--n100,#f3f4f6)] overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(job.progress_pct || 0)}%` }} />
                    </div>
                  )}
                  {job.error_message && <p className="text-[11px] text-[var(--video-error)]">{job.error_message}</p>}
                  {job.log && (
                    <pre className="text-[10px] text-[var(--n600,#4b5563)] bg-[var(--n50,#f9fafb)] rounded-md p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">{job.log}</pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
