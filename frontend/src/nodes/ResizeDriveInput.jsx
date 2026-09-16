import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, inputCls, CopyButton } from './resizeUploadShared.jsx';
import { importResizeDriveFolder } from '../lib/api.js';
import { isDriveFolder } from '../lib/resizeDrivePreparation.js';
import ResizeOpenFolderButton from './ResizeOpenFolderButton.jsx';

export default function ResizeDriveInput({ version, onImport, disabled, request }) {
  const [open, setOpen] = useState(!!request);
  const [url, setUrl] = useState(request?.url || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(request?.recovery ? request.result?.message || '' : '');
  const [result, setResult] = useState(request?.result || null);
  const interrupted = useRef(!!request?.result);
  const started = useRef(false);
  const controller = useRef(null);
  const latestResult = useRef(result);
  const saveResult = value => { latestResult.current = value; setResult(value); request?.saveSession(value); };
  const close = () => {
    if (request) { controller.current?.abort(); request.finish(null); }
    else if (!busy) setOpen(false);
  };
  const download = async (checkOnly = false, fresh = false) => {
    setBusy(true); setError(''); setMessage(checkOnly ? 'Đang kiểm tra các file đã tải tay…' : 'Đang kết nối Google Drive…');
    controller.current = new AbortController();
    if (request) request.cancel = () => controller.current?.abort();
    try {
      const imported = await importResizeDriveFolder(version, url.trim(), setMessage, {
        importId: !fresh && (request || result?.status !== 'complete') ? result?.importId : undefined, checkOnly, signal: controller.current.signal,
        onSession: importId => saveResult({ ...result, importId, status: 'interrupted', failed: result?.failed || [] }),
      });
      if (controller.current.signal.aborted) return;
      saveResult(imported);
      const complete = !imported.status || imported.status === 'complete';
      setMessage(complete ? `Đã tải đủ ${imported.count}/${imported.total ?? imported.count} video. ${request ? 'Bấm Xác nhận chạy tiếp để tiếp tục node.' : 'Bấm Dùng thư mục để thêm vào Input.'}` : '');
      if (!complete) { interrupted.current = true; setError(imported.message); if (request?.deferFailure) request.finish(imported); }
      else if (request && (request.deferFailure || !interrupted.current)) request.finish(imported);
    } catch (failure) { if (!controller.current.signal.aborted) {
      interrupted.current = true; setError(failure.message); setMessage('');
      const failed = { ...latestResult.current, status: 'interrupted', message: failure.message };
      if (request) saveResult(failed);
      if (request?.deferFailure) request.finish(failed);
    } }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (request && !request.recovery && !started.current) { started.current = true; void download(request.result?.status === 'complete'); }
  }, []);
  return <>
    {!request && <button type="button" className="text-red-500 text-[11px] text-left" disabled={disabled} onClick={() => setOpen(true)}>Link Google Drive{result?.status === 'partial' ? ` · thiếu ${result.failed.length} video` : ''}</button>}
    {open && createPortal(<Modal title={request ? 'Chuẩn bị Input Drive để chạy node' : 'Input từ Google Drive'} width={640} onClose={close}>
      <div className="flex flex-col gap-3 text-[12px] text-[var(--text,#111827)]" onKeyDown={e => e.stopPropagation()}>
        <p>Thư mục cần chia sẻ “Bất kỳ ai có liên kết” và cho phép tải xuống. Tải video và giữ cấu trúc thư mục trên máy chạy node.</p>
        <label>Link thư mục Google Drive<input aria-label="Link thư mục Google Drive" className={`${inputCls} mt-1`} placeholder="https://drive.google.com/drive/folders/…" value={url} disabled={busy || !!request} onChange={e => { setUrl(e.target.value); setResult(null); setMessage(''); setError(''); }} /></label>
        <p className="text-[var(--sub,#6b7280)]">{request ? 'Node chờ tải đủ Input trước khi xử lý video. Nếu tải lỗi, thử lại hoặc tải tay rồi kiểm tra và xác nhận chạy tiếp.' : 'Lưu link ngay, video sẽ tải khi nhấn chạy node. Có thể tải trước nếu cần kiểm tra hoặc nối nhóm Input. Test cũng tải video.'}</p>
        {request && interrupted.current && <p role="status" className="text-amber-600">Đã tạm dừng chạy node để xử lý tải Drive.</p>}
        {request?.recovery && <p role="status" className="text-red-500">Đã tải xong các link còn lại. Có {request.failedCount} link tải lỗi; dòng dùng Input lỗi được tô đỏ. Sửa lỗi rồi xác nhận chạy tiếp.</p>}
        {message && <p role="status" className="break-words">{message}</p>}
        {error && <p role="alert" className="text-red-500 break-words">{error}</p>}
        {result?.folder && <div className="flex items-center gap-2 break-all"><span>Thư mục tải: {result.folder}</span><ResizeOpenFolderButton path={result.folder} label="Mở thư mục đã tải" /><CopyButton text={result.folder} /></div>}
        {/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?(?:\?[^\s]*)?$/.test(url.trim()) && <a className="text-red-500 underline" href={url.trim()} target="_blank" rel="noreferrer">Mở thư mục Drive để kiểm tra quyền / tải tay</a>}
        {!!result?.failed?.length && <>
          <p>Đã giữ {result.count}/{result.total} video tải được. Với file còn thiếu, mở link tải tay rồi lưu đúng đường dẫn bên dưới trên máy chạy node, sau đó bấm Kiểm tra file tải tay.</p>
          <div className="nowheel max-h-64 overflow-y-auto border border-[var(--card-border,#e5e7eb)] rounded-lg" aria-label="Video tải lỗi">
            {result.failed.map(file => <div key={file.path} className="p-2 border-b border-[var(--card-border,#e5e7eb)] flex flex-col gap-1">
              <strong className="break-words">{file.name}</strong><span>{file.error}</span>
              <a href={file.url} target="_blank" rel="noreferrer" className="text-red-500 underline">Mở video trên Drive / tải tay</a>
              <div className="flex gap-2 items-start"><span className="break-all flex-1">Lưu vào: {file.path}</span><CopyButton text={file.path} /></div>
            </div>)}
          </div>
        </>}
        <div className="flex gap-2 flex-wrap">
          {!request && <button type="button" disabled={busy || !isDriveFolder(url)} className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50" onClick={() => { onImport([url.trim()]); setOpen(false); }}>Lưu link, tải khi chạy</button>}
          <button type="button" disabled={busy || !url.trim()} className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50" onClick={() => download()}>{busy ? 'Đang tải…' : result?.status === 'partial' ? 'Thử lại file lỗi' : result?.status === 'unavailable' ? 'Kiểm tra quyền và thử lại' : result?.status === 'interrupted' ? 'Thử lại lượt tải' : 'Tải video từ Drive'}</button>
          {result?.status === 'partial' && <button type="button" disabled={busy} className="px-3 py-2 rounded-lg bg-[var(--n100,#f3f4f6)] disabled:opacity-50" onClick={() => download(true)}>Kiểm tra file tải tay</button>}
          {request && error && result?.importId && result.status !== 'partial' && <button type="button" disabled={busy} className="px-3 py-2 rounded-lg bg-[var(--n100,#f3f4f6)] disabled:opacity-50" onClick={() => download(false, true)}>Tạo lượt tải mới</button>}
          {result?.folder && (!result.status || result.status === 'complete') && <button type="button" disabled={busy || !!error} className="px-3 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50" onClick={() => { if (request) request.finish(result); else { onImport([result.folder]); setOpen(false); } }}>{request ? 'Xác nhận chạy tiếp' : 'Dùng thư mục'}</button>}
          <button type="button" disabled={busy && !request} className="px-3 py-2 rounded-lg bg-[var(--n100,#f3f4f6)] disabled:opacity-50" onClick={close}>{request ? 'Dừng lượt chạy' : 'Đóng'}</button>
        </div>
      </div>
    </Modal>, document.body)}
  </>;
}
