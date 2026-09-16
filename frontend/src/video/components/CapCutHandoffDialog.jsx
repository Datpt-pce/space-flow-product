import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { videoCapcutRequest } from '../../lib/api.js';
import { useDialogFocus } from '../useDialogFocus.js';

export default function CapCutHandoffDialog({ job, projectName, onClose }) {
  const [capability, setCapability] = useState(null);
  const [build, setBuild] = useState('');
  const [name, setName] = useState(`${projectName || 'Video'}-r${job.pinned_seq ?? 0}`);
  const [accepted, setAccepted] = useState(false);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(onClose);
  useEffect(() => {
    let active = true;
    videoCapcutRequest('/capability').then((data) => {
      if (!active) return;
      setCapability(data);
      setBuild(data.installed.filter((v) => data.profiles.some((p) => p.appBuild === v && p.certified)).at(-1) || '');
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, []);
  async function run(operation) {
    if (busy) return;
    setBusy(operation); setError('');
    try {
      const result = operation === 'prepare'
        ? await videoCapcutRequest('/prepare', { renderJobId: job.id, build, name: name.trim(), acceptFlattening: accepted })
        : await videoCapcutRequest(`/${prepared.id}/install`, {});
      setPrepared((previous) => ({ ...previous, ...result }));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const control = 'rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-2 text-sm';
  const installed = prepared?.status === 'installed';
  return (
    <div className="fixed inset-0 z-[10000] bg-black/30 flex items-center justify-center p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="capcut-handoff-title" tabIndex={-1}
        className="w-full max-w-lg max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--card)] text-[var(--text)] p-6 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="capcut-handoff-title" className="font-semibold">Chuyển sang CapCut</h2>
          <button aria-label="Đóng CapCut" onClick={onClose} className="p-2 rounded-lg"><X size={16} /></button>
        </div>
        <p className="text-sm text-[var(--n600)]">Bản r{job.pinned_seq ?? 0} sẽ được thêm vào một dự án CapCut mới dưới dạng một video. Bạn có thể tiếp tục cắt, thêm chữ và âm thanh trong CapCut.</p>
        {!prepared && <>
          <label className="flex flex-col gap-1 text-sm">Phiên bản CapCut
            <select value={build} onChange={(e) => setBuild(e.target.value)} className={control} disabled={!!busy}>
              <option value="">Chọn phiên bản đã kiểm chứng</option>
              {capability?.profiles.filter((p) => p.certified && capability.installed.includes(p.appBuild)).map((p) =>
                <option key={p.id} value={p.appBuild}>{p.appBuild}{p.channel === 'beta' ? ' (Beta)' : ''}</option>)}
            </select>
          </label>
          {capability && !build && <p role="status" className="text-sm">Máy chạy tác vụ chưa có phiên bản CapCut tương thích. Bạn vẫn có thể tải MP4 trong cửa sổ Export và nhập vào CapCut.</p>}
          <label className="flex flex-col gap-1 text-sm">Tên dự án CapCut
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={!!busy} className={control} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={!!busy} className="mt-1" />
            <span>Tôi hiểu rằng các lớp video, phụ đề, hiệu ứng và keyframe được gộp vào video; chúng không còn chỉnh sửa riêng trong CapCut.</span>
          </label>
        </>}
        {prepared && <div role="status" className="text-sm flex flex-col gap-2">
          <p>{installed ? 'Đã thêm dự án vào CapCut.' : `Đã chuẩn bị dự án “${prepared.report.projectName}” cho CapCut ${prepared.report.appBuild}.`}</p>
          <p>{installed ? 'Mở CapCut và chọn dự án này ở trang chủ để tiếp tục chỉnh sửa.' : 'Lưu công việc và thoát CapCut trước khi bấm “Thêm vào CapCut”. Dự án hiện có được giữ nguyên.'}</p>
        </div>}
        {error && <p role="alert" className="text-sm text-[var(--video-error)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={control}>{installed ? 'Hoàn tất' : 'Quay lại Export'}</button>
          {!installed && <button onClick={() => run(prepared ? 'install' : 'prepare')}
            disabled={!!busy || (!prepared && (!build || !accepted || !name.trim())) || (prepared && !capability?.canInstall)}
            className="px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-sm disabled:opacity-40 inline-flex items-center gap-2">
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy === 'loading' ? 'Đang kiểm tra…' : busy ? 'Đang xử lý…' : prepared ? 'Thêm vào CapCut' : 'Chuẩn bị dự án'}
          </button>}
        </div>
      </div>
    </div>
  );
}
