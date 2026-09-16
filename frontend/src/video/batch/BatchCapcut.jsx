import { useEffect, useRef, useState } from 'react';
import { batchRequest } from './batchApi.js';
import { useVideoStore } from '../store.js';
import { useDialogFocus } from '../useDialogFocus.js';

export default function BatchCapcut({ project, onClose }) {
  const [name, setName] = useState(`${project.name.slice(0, 65)}-BCL-${Date.now()}`);
  const [busy, setBusy] = useState('Đang tải project…'), [error, setError] = useState('');
  const [prepared, setPrepared] = useState(null);
  const requestKey = useRef(crypto.randomUUID());
  const dialogRef = useDialogFocus(() => { if (!busy) onClose(); });
  useEffect(() => {
    let active = true;
    batchRequest(`/${project.id}/capcut`).then(packages => {
      if (!active) return;
      setPrepared(packages[0] || null);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [project.id]);
  async function prepare() {
    setBusy('Đang kiểm tra công thức…'); setError('');
    try {
      const state = useVideoStore.getState;
      await state().batchSave();
      await state().batchPreflight();
      const current = state().batchProject, pre = state().batchPreview;
      if (pre.issues.length) throw new Error(pre.issues[0].message);
      setBusy(`Đang đóng gói ${pre.totalCount} timeline và media…`);
      const record = await batchRequest(`/${current.id}/capcut`, { expectedRevision:current.revision, inputHash:pre.inputHash, name:name.trim(), requestKey:requestKey.current });
      setPrepared(record);
      setBusy('Đang ghi vào thư mục draft CapCut…');
      setPrepared(await batchRequest(`/${current.id}/capcut/${record.id}/install`, {}));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  async function install() {
    setBusy('Đang thêm project vào CapCut…'); setError('');
    try { setPrepared(await batchRequest(`/${project.id}/capcut/${prepared.id}/install`, {})); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }
  return <div className="batch-dialog-backdrop"><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Convert to CapCut project" className="batch-dialog batch-capcut-dialog">
    <div className="batch-section-heading"><h2>Convert to CapCut project</h2><button disabled={!!busy} onClick={onClose}>Đóng hộp thoại</button></div>
    <p>Mỗi biến thể BCL thành một timeline trong cùng project CapCut. Giữ riêng clip video, ảnh và audio để tiếp tục chỉnh sửa.</p>
    {!prepared && <>
      <label>Tên project CapCut<input aria-label="Tên project CapCut" maxLength={100} disabled={!!busy} value={name} onChange={e => { setName(e.target.value); requestKey.current = crypto.randomUUID(); }}/></label>
      <p>Ghi project mới vào thư mục draft CapCut trên máy agent. Có thể giữ CapCut mở; từ editor quay về Home để thấy project mới.</p>
      <p className="batch-muted">Dùng công thức đang mở và thời lượng đã chọn. Transition, shape và các hiệu ứng chưa hỗ trợ sẽ được báo trước khi tạo project.</p>
    </>}
    {prepared && <div role="status"><strong>{prepared.report.projectName}</strong><p>{prepared.report.timelineCount} timeline · {prepared.status === 'installed' ? 'Đã thêm vào CapCut' : 'Đã đóng gói media và project'}</p>
      {prepared.status === 'installed' ? <p>Chọn project này ở Home của CapCut. Nếu chưa thấy, mở một project rồi quay về Home để làm mới danh sách.</p> : <p>Draft đã tạo; chưa ghi xong vào thư mục CapCut. Kiểm tra lỗi rồi thử ghi lại.</p>}
      {prepared.path && <p className="batch-path">{prepared.path}</p>}
    </div>}
    {busy && <div role="status"><progress aria-label="Tiến trình chuyển CapCut"/><p>{busy}</p></div>}
    {error && <p role="alert" className="batch-error">{error}</p>}
    <div className="batch-toolbar">
      {prepared && <button disabled={!!busy} onClick={() => { setPrepared(null); setError(''); requestKey.current = crypto.randomUUID(); setName(`${project.name.slice(0, 65)}-BCL-${Date.now()}`); }}>Tạo project khác</button>}
      <span className="batch-spacer"/>
      {!prepared ? <button className="batch-primary" disabled={!!busy || !name.trim()} onClick={prepare}>Chuyển công thức sang CapCut</button>
        : prepared.status !== 'installed' && <button className="batch-primary" disabled={!!busy} onClick={install}>Thử ghi lại draft</button>}
    </div>
  </section></div>;
}
