import { useEffect, useRef, useState } from 'react';
import { videoAutomationRequest as requestAutomation } from '../../lib/api.js';
import { useVideoStore } from '../store.js';
import { useDialogFocus } from '../useDialogFocus.js';

const button = 'rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent)]';
const field = 'rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm bg-[var(--card)] min-w-0';
const value = v => v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
export default function AutomationDialog({ project, sourceVersion, onClose, onOpen }) {
  const ref = useDialogFocus(onClose);
  const retryKeys = useRef(new Map());
  async function videoAutomationRequest(route, body) {
    if (!body || route.endsWith('/preview')) return requestAutomation(route, body);
    const { idempotencyKey: ignored, ...input } = body;
    const signature = JSON.stringify([route, input]);
    if (!retryKeys.current.has(signature)) retryKeys.current.set(signature, crypto.randomUUID());
    const result = await requestAutomation(route, { ...input, idempotencyKey: retryKeys.current.get(signature) });
    retryKeys.current.delete(signature);
    return result;
  }
  const assets = useVideoStore(s => s.assets);
  const pending = useVideoStore(s => s.pendingCommands.length > 0 || s.staleVersionDetected || s.saveStatus === 'error');
  const [recipes, setRecipes] = useState([]), [recipeId, setRecipeId] = useState('');
  const [ctx, setContext] = useState(null), [tab, setTab] = useState('templates');
  const [templateName, setTemplateName] = useState(sourceVersion ? `Mẫu ${sourceVersion.name}`.slice(0, 120) : '');
  const [name, setName] = useState(''), [assignments, setAssignments] = useState({});
  const [paths, setPaths] = useState([]), [targets, setTargets] = useState([]), [impact, setImpact] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [promoteClip, setPromoteClip] = useState('');
  const [lastOperation, setLastOperation] = useState(null);
  const template = recipes.find(r => r.id === recipeId);
  const reload = async () => {
    const [list, context] = await Promise.all([videoAutomationRequest('recipes'), videoAutomationRequest(`context/${project.id}`)]);
    setRecipes(list); setContext(context);
    return context;
  };
  useEffect(() => {
    let disposed = false;
    Promise.all([videoAutomationRequest('recipes'), videoAutomationRequest(`context/${project.id}`)]).then(([list, context]) => {
      if (!disposed) { setRecipes(list); setContext(context); if (context.compiled) setTab('origin'); }
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [project.id]);
  async function act(fn) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function pick(set, values, v) { set(values.includes(v) ? values.filter(x => x !== v) : [...values, v]); setImpact(null); }
  async function openResult(result) {
    await useVideoStore.getState().openProject(result.projectId, name);
    window.history.replaceState(null, '', `/video?projectId=${encodeURIComponent(result.projectId)}`);
    onOpen();
  }
  return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Mẫu, biến thể và nguồn gốc" className="w-[850px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl bg-[var(--card)] text-[var(--text)] p-5 space-y-4">
      <div className="sticky top-0 z-10 bg-[var(--card)] flex justify-between gap-3 py-2"><h2 className="font-semibold">Mẫu, biến thể và nguồn gốc</h2><button type="button" className={button} onClick={onClose}>Đóng mẫu và biến thể</button></div>
      <div className="flex gap-2" role="group" aria-label="Nội dung tự động hóa"><button type="button" className={button} aria-pressed={tab === 'templates'} onClick={() => setTab('templates')}>Tạo từ mẫu</button><button type="button" className={button} aria-pressed={tab === 'origin'} onClick={() => setTab('origin')}>Nguồn gốc và chỉnh sửa</button></div>
      {error && <p role="alert" className="text-sm text-[var(--video-error)]">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {lastOperation && <button className={button} disabled={busy || pending} onClick={() => act(async () => {
        await videoAutomationRequest('undo', { operationId: lastOperation, idempotencyKey: crypto.randomUUID() });
        await useVideoStore.getState().openProject(project.id); await reload(); setLastOperation(null); setPaths([]); setImpact(null); setNotice('Đã hoàn tác thao tác vừa thực hiện.');
      })}>Hoàn tác thao tác vừa thực hiện</button>}
      {pending && <p role="status" className="text-sm">Lưu và đồng bộ timeline trước khi thực hiện thao tác.</p>}
      {tab === 'templates' ? <>
        {sourceVersion ? <div className="space-y-2 border-b border-[var(--card-border)] pb-4">
          <p className="text-xs">Tạo mẫu độc lập từ “{sourceVersion.name}” · r{sourceVersion.seq}. Các biến thể giữ nguyên thời lượng và bố cục; media quá ngắn sẽ bị từ chối.</p>
          <div className="flex flex-wrap gap-2"><input aria-label="Tên mẫu" className={`${field} flex-1`} maxLength={120} value={templateName} onChange={e => setTemplateName(e.target.value)} /><button className={button} disabled={busy || pending || !templateName.trim()} onClick={() => act(async () => {
            const created = await videoAutomationRequest('recipes', { projectId: project.id, versionId: sourceVersion.id, name: templateName, parentId: ctx?.recipeVersionId });
            await reload(); setRecipeId(created.id); setAssignments({}); setNotice('Đã lưu phiên bản mẫu độc lập.');
          })}>{ctx?.compiled ? 'Lưu phiên bản mẫu mới' : 'Lưu thành mẫu'}</button></div>
        </div> : <p className="text-xs text-[var(--n600)]">Để tạo mẫu mới, quay lại và chọn một bản lưu đã đặt tên.</p>}
        <label className="flex flex-col gap-1 text-xs">Mẫu đã lưu<select aria-label="Mẫu đã lưu" className={field} value={recipeId} onChange={e => { setRecipeId(e.target.value); setAssignments({}); }}><option value="">Chọn mẫu</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {template && <>
          <div className="space-y-3">{template.payload.slots.map(slot => {
            const clip = template.payload.document.tracks.find(t => t.id === slot.trackId).clips.find(c => c.id === slot.clipId);
            return <label key={slot.clipId} className="flex flex-col gap-1 text-xs">{slot.label}
              {slot.trackType === 'caption' ? <textarea aria-label={`Nội dung ${slot.label}`} className={field} value={assignments[slot.clipId]?.text ?? clip.text ?? ''} onChange={e => setAssignments(a => ({ ...a, [slot.clipId]: { ...a[slot.clipId], text: e.target.value } }))} />
                : clip.assetId ? <select aria-label={`Media ${slot.label}`} className={field} value={assignments[slot.clipId]?.assetId ?? ''} onChange={e => setAssignments(a => { const next = { ...a }; if (e.target.value) next[slot.clipId] = { assetId: e.target.value }; else delete next[slot.clipId]; return next; })}>
                  <option value="">Giữ media đã ghim</option>{assets.filter(a => a.status === 'ok' && (slot.trackType === 'audio' ? a.kind === 'audio' : ['image', 'video'].includes(a.kind))).map(a => <option key={a.id} value={a.id}>{a.name || a.sourcePath?.split(/[/\\]/).pop() || a.id}</option>)}
                </select> : <span>Giữ đồ họa của mẫu</span>}
            </label>;
          })}</div>
          <div className="flex flex-wrap gap-2"><input aria-label="Tên biến thể" placeholder="Tên timeline mới" className={`${field} flex-1`} maxLength={120} value={name} onChange={e => setName(e.target.value)} /><button className={button} disabled={busy || pending || !name.trim()} onClick={() => act(async () => {
            const result = await videoAutomationRequest('variants', { recipeId, name, assignments: Object.entries(assignments).map(([clipId, a]) => ({ clipId, ...a })), idempotencyKey: crypto.randomUUID() });
            await openResult(result);
          })}>Tạo và mở biến thể</button></div>
        </>}
      </> : !ctx ? <p role="status">Đang đọc nguồn gốc…</p> : !ctx.compiled ? <p className="text-sm">Timeline được dựng thủ công. Tạo biến thể từ mẫu để có liên kết component và lịch sử chỉnh sửa so với bản tự động.</p> : <>
        <p className="text-sm">Mẫu: <strong>{ctx.recipeName}</strong> · Biến thể: <strong>{ctx.creativeName}</strong> · r{ctx.seq}</p>
        <button className={button} onClick={() => act(async () => { await navigator.clipboard.writeText(ctx.creativeVersionId); setNotice('Đã sao chép mã. Dán vào node Composition Compiler để dùng bản tự động trong workflow.'); })}>Sao chép mã biến thể cho workflow</button>
        <p className="text-xs text-[var(--n600)]">Thay đổi tại đây chỉ ảnh hưởng timeline này. Chọn các trường và timeline đích để xem tác động trước khi áp dụng hàng loạt.</p>
        <div aria-label="Chỉnh sửa so với bản tự động" className="space-y-2 max-h-48 overflow-auto">{ctx.ledger.length ? ctx.ledger.map(change => <label key={change.path} className="flex items-start gap-2 text-xs break-all">
          <input type="checkbox" aria-label={`Áp dụng ${change.path}`} checked={paths.includes(change.path)} onChange={() => pick(setPaths, paths, change.path)} />
          <span>{change.origin?.role || 'Bố cục'} · {change.path.split('/').slice(-2).join('/')}<br />{value(change.before)} → {value(change.after)}<br /><span className="text-[var(--n600)]">{change.preservesMedia ? 'Giữ media nguồn' : 'Media liên quan cần kiểm tra lại'}</span></span>
        </label>) : <p className="text-sm">Không có chỉnh sửa ngoài bản tự động.</p>}</div>
        {ctx.ledger.length > 0 && <>
          <button className={button} disabled={busy || pending} onClick={() => setConfirmReset(true)}>Khôi phục bản tự động</button>
          {confirmReset && <div className="border rounded p-3 space-y-2"><p className="text-xs">Khôi phục toàn bộ {ctx.ledger.length} thay đổi trên timeline này về bản tự động. Lịch sử cũ vẫn được giữ.</p><div className="flex gap-2"><button className={button} disabled={busy || pending} onClick={() => act(async () => {
            const resetResult = await videoAutomationRequest('reset', { projectId: project.id, baseRevision: ctx.seq, idempotencyKey: crypto.randomUUID() }); setLastOperation(resetResult.operationId);
            await useVideoStore.getState().openProject(project.id); await reload(); setPaths([]); setImpact(null); setConfirmReset(false); setNotice('Đã khôi phục bản tự động; lịch sử phiên bản vẫn được giữ.');
          })}>Xác nhận khôi phục</button><button className={button} disabled={busy} onClick={() => setConfirmReset(false)}>Giữ chỉnh sửa</button></div></div>}
        </>}
        {!!ctx.siblings.length && <div className="space-y-2 border-t border-[var(--card-border)] pt-3"><h3 className="text-sm font-semibold">Timeline cùng mẫu</h3>
          {ctx.siblings.map(s => <label key={s.id} className="flex gap-2 text-xs"><input type="checkbox" aria-label={`Timeline đích ${s.name}`} checked={targets.includes(s.id)} onChange={() => pick(setTargets, targets, s.id)} />{s.name}</label>)}
          <button className={button} disabled={busy || pending || !paths.length || !targets.length} onClick={() => act(async () => setImpact(await videoAutomationRequest('siblings/preview', { projectId: project.id, paths, targetIds: targets })))}>Xem tác động</button>
          {impact && <div aria-label="Tác động lên timeline" className="text-xs space-y-2">{impact.targets.map(t => <p key={t.projectId}>{t.name} · r{t.seq}: {t.conflicts.length ? `Xung đột: ${t.conflicts.join(', ')}` : `${t.edits.length} trường sẽ thay đổi`}</p>)}
            <button className={button} disabled={busy || pending || !impact.canApply} onClick={() => act(async () => {
              const applyResult = await videoAutomationRequest('siblings/apply', { projectId: project.id, paths, targetIds: targets, impactHash: impact.impactHash, idempotencyKey: crypto.randomUUID() }); setLastOperation(applyResult.operationId);
              setImpact(null); await reload(); setNotice('Đã áp dụng toàn bộ timeline đã chọn. Các bản duyệt cũ cần được kiểm tra lại.');
            })}>Áp dụng cho các timeline đã chọn</button>
          </div>}
        </div>}
        <div className="border-t border-[var(--card-border)] pt-3 space-y-2"><h3 className="text-sm font-semibold">Lưu chỉnh sửa thành component mới</h3><p className="text-xs text-[var(--n600)]">Tạo component và biến thể mới, mở trên timeline mới. Các clip còn lại lấy từ bản tự động.</p>
          <select aria-label="Component cần lưu" className={`${field} w-full`} value={promoteClip} onChange={e => setPromoteClip(e.target.value)}><option value="">Chọn clip đã chỉnh</option>{ctx.plan.segments.filter(s => ctx.ledger.some(c => c.origin?.elementId === s.elementId)).map(s => <option key={s.elementId} value={s.elementId}>{s.role}</option>)}</select>
          <div className="flex flex-wrap gap-2"><input aria-label="Tên component và biến thể mới" placeholder="Tên phiên bản mới" maxLength={120} className={`${field} flex-1`} value={name} onChange={e => setName(e.target.value)} /><button className={button} disabled={busy || pending || !name.trim() || !promoteClip} onClick={() => act(async () => openResult(await videoAutomationRequest('components/promote', { projectId: project.id, clipId: promoteClip, baseRevision: ctx.seq, name, idempotencyKey: crypto.randomUUID() }))) }>Lưu component và mở biến thể</button></div>
        </div>
      </>}
    </section>
  </div>;
}
