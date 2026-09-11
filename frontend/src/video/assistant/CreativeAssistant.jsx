import { useEffect, useState } from 'react';
import { useVideoStore } from '../store';
import { useStore } from '../../store';
import { ROLES, BINDINGS, validateDraft } from '@shared/creative-assistant';
import { assistantRequest } from './assistantSlice';
import { apiFetch } from '../../lib/transport';
import { startRenderJob, streamRenderJob, retryRenderJob } from '../../lib/api';
import './creativeAssistant.css';

const names = { hook: 'Hook · mở đầu', body: 'Body · nội dung', outro: 'Outro · lời mời', logo: 'Logo', music: 'Nhạc nền', sfx: 'Hiệu ứng âm thanh' };
const seconds = ms => (ms / 1000).toFixed(2) + 's';
function download(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'creative-assistant.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function CreativeAssistant() {
  const owner = useStore(s => s.currentUser.id);
  const store = useVideoStore();
  const { assistantDraft: draft, assistantPlan: plan, assistantResult: result, assistantBusy: busy, assistantError: error, assistantNote: note, assets } = store;
  const [model, setModel] = useState('qwen2.5:3b');
  const [render, setRender] = useState(null);
  const simulated = ROLES.some(role => draft.bindings[role]?.speech?.origin?.startsWith('simulation:'));
  useEffect(() => { store.assistantLoad(owner); store.fetchAssets(); }, [owner]); // Owner-scoped drafts live in the existing Video store.
  useEffect(() => {
    if (!result?.jobId) return;
    return streamRenderJob(result.projectId, result.jobId, setRender);
  }, [result?.projectId, result?.jobId]);
  const edit = change => store.assistantEdit({ ...draft, ...change });
  const run = (label, task) => store.assistantRun(label, task);
  const bind = (role, asset) => {
    const bindings = { ...draft.bindings };
    if (asset) bindings[role] = { assetId: asset.id, contentHash: asset.contentHash };
    else delete bindings[role];
    edit({ bindings });
  };
  const fileInput = (label, action, accept) => <label className="ca-file">{label}<input type="file" accept={accept} disabled={!!busy} onChange={e => {
    const file = e.target.files[0]; e.target.value = ''; if (file) run(label, () => action(file));
  }} /></label>;
  return <main className="ca-page" data-analytics-feature="assistant">
    <header className="ca-header"><div><a href="/video">← Video workspace</a><p className="ca-eyebrow">FROM IDEA TO EDIT</p><h1>Creative Assistant</h1><p>Chốt lời muốn nói. Tìm đúng đoạn nguồn. Dựng một video hoàn chỉnh.</p></div>
      <button className="ca-primary" disabled={!!busy} onClick={() => run('Đang tạo tình huống mẫu…', async () => {
        const demo = await assistantRequest('demo', {}); store.assistantEdit(demo.draft); useVideoStore.setState({ assistantNote: demo.explanation }); await store.fetchAssets();
      })}>Thử bài mẫu Luma</button></header>
    <div className="ca-toolbar"><span>Bản nháp lưu trên trình duyệt của bạn</span><button onClick={() => download(draft)}>Tải bản nháp JSON</button>
      {fileInput('Mở bản nháp JSON', async f => store.assistantEdit(validateDraft(JSON.parse(await f.text()))), '.json')}</div>
    {busy && <p role="status" className="ca-notice">{busy}</p>}{error && <p role="alert" className="ca-error">{error}</p>}{(note || simulated) && <p className="ca-notice">{note || 'Bản mẫu dùng đồ họa và giọng tổng hợp. Mốc từ đang được mô phỏng theo câu; bấm Đọc lời AI để thay bằng nhận dạng thực từ audio.'}</p>}
    <div className="ca-columns"><section className="ca-card"><p className="ca-step">01 / Ý TƯỞNG & KỊCH BẢN</p><h2>Bạn muốn kể điều gì?</h2>
      <fieldset disabled={!!busy}><label>Tên video<input value={draft.name} onChange={e => edit({ name: e.target.value })} /></label>
        <label>Ý tưởng thô<textarea rows={3} value={draft.idea} placeholder="Một video cà phê buổi sáng, nhẹ nhàng, có lời mời ở cuối…" onChange={e => edit({ idea: e.target.value })} /></label>
        <div className="ca-row"><label>Ngôn ngữ<select value={draft.language} onChange={e => edit({ language: e.target.value })}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
          <label>Model Ollama<input value={model} onChange={e => setModel(e.target.value)} /></label></div>
        <button onClick={() => run('Đang viết kịch bản qua Ollama…', async () => {
          const script = await assistantRequest('normalize', { idea: draft.idea, language: draft.language, model });
          edit({ overlayText: script.overlayText, script: Object.fromEntries(ROLES.map(role => [role, { ...draft.script[role], lines: script[role] }])) });
        })}>Viết khung bằng AI local</button><p className="ca-help">Có thể điền trực tiếp bên dưới. Mỗi dòng là một câu cần giữ trong video; hãy rà trước khi dựng.</p>
        {ROLES.map(role => <label key={role}>{names[role]}<textarea rows={3} value={draft.script[role].lines.join('\n')} onChange={e => edit({ script: { ...draft.script, [role]: { ...draft.script[role], lines: e.target.value.split('\n') } } })} /></label>)}
        <label>Text overlay ở hook<input value={draft.overlayText} onChange={e => edit({ overlayText: e.target.value })} /></label>
        <div className="ca-row"><label>Hook dự kiến (giây)<input type="number" min=".1" step=".1" value={(draft.script.hook.targetDurationMs || 0) / 1000} onChange={e => edit({ script: { ...draft.script, hook: { ...draft.script.hook, targetDurationMs: Number(e.target.value) * 1000 } } })} /></label>
          <label>Thời lượng<select value={draft.settings.timing} onChange={e => edit({ settings: { ...draft.settings, timing: e.target.value } })}><option value="flexible">Theo lời thực tế</option><option value="fixed-hook">Giữ đúng hook dự kiến</option></select></label></div>
      </fieldset></section>
      <section className="ca-card"><p className="ca-step">02 / TÀI NGUYÊN & LỜI THỰC TẾ</p><h2>Mỗi phần có một nguồn rõ ràng</h2>
        <p className="ca-help">Hook là video đã gen. Body và outro dùng nguyên đoạn có sẵn. Chọn theo vai trò; bản đầu chưa tự xếp hạng thư viện.</p>
        <fieldset disabled={!!busy}>{BINDINGS.map(role => {
          const binding = draft.bindings[role], kind = ROLES.includes(role) ? 'video' : role === 'logo' ? 'image' : 'audio';
          return <div className="ca-asset" key={role}><label>{names[role]}<select value={binding?.assetId || ''} onChange={e => bind(role, assets.find(a => a.id === e.target.value))}>
            <option value="">Chọn tài nguyên {kind}</option>{assets.filter(a => a.kind === kind).map(a => <option key={a.id} value={a.id}>{a.name || a.sourcePath?.split(/[\\/]/).at(-1) || a.id}</option>)}
          </select></label><div className="ca-actions">{fileInput('Tải ' + role, async file => {
            const body = new FormData(); body.append('file', file); const res = await apiFetch('/api/video-assets/upload', { method: 'POST', body }); const a = await res.json(); if (!res.ok) throw new Error(a.error); await store.fetchAssets(); bind(role, a);
          }, kind + '/*')}
          {ROLES.includes(role) && <><button disabled={!binding} onClick={() => run('Đang đọc lời ' + role + '… Lần đầu có thể cần tải model.', async () => {
            const speech = await assistantRequest('analyze', { ...binding, language: draft.language }); edit({ bindings: { ...draft.bindings, [role]: { ...binding, speech } } });
          })}>Đọc lời AI</button>{binding && fileInput('Nhập transcript ' + role, async f => {
            const speech = JSON.parse(await f.text()); if (speech.sourceHash !== binding.contentHash) throw new Error('Transcript phải có sourceHash khớp tài nguyên.');
            edit({ bindings: { ...draft.bindings, [role]: { ...binding, speech } } });
          }, '.json')}</>}</div>
          {ROLES.includes(role) && <p className="ca-help">{binding?.speech ? `${binding.speech.cues?.length || 0} đoạn lời · ${binding.speech.origin?.startsWith('simulation:') ? 'Mốc mẫu, chưa nhận dạng AI' : binding.speech.origin?.startsWith('asr:') ? 'Đã nhận dạng từ audio' : 'Transcript do bạn nhập'}` : 'Cần transcript có timestamp cấp từ để cắt và làm subtitle.'}</p>}</div>;
        })}</fieldset>
        <p className="ca-help">Logo xuyên suốt · subtitle theo lời · chuyển cảnh 0,3s · SFX mở đầu · nhạc nền nhẹ xuyên suốt.</p>
      </section></div>
    <section className="ca-card ca-output"><div className="ca-output-heading"><div><p className="ca-step">03 / PHƯƠNG ÁN DỰNG</p><h2>Thấy điểm cắt trước khi xuất</h2></div><button className="ca-primary" disabled={!!busy} onClick={() => run('Đang đối chiếu lời và lập timeline…', async () => {
      const next = await assistantRequest('preflight', { draft }); useVideoStore.setState({ assistantPlan: next, assistantResult: null });
    })}>Lập phương án dựng</button></div>
      {!plan && <p className="ca-help">Phương án sẽ hiển thị thời lượng hook thực dùng và các đoạn nguồn được giữ.</p>}
      {plan && <><div className={plan.canCreate ? 'ca-notice' : 'ca-error'}>{plan.canCreate ? `Sẵn sàng dựng · ${seconds(plan.durationMs)} · hook bỏ ${seconds(plan.removedHookMs)}` : plan.issues.join('\n')}</div>
        {plan.notices.map(n => <p className="ca-help" key={n}>{n}</p>)}
        {!!plan.mappings.length && <div className="ca-table"><table><thead><tr><th>Phần</th><th>Giữ từ nguồn</th><th>Đặt trên timeline</th></tr></thead><tbody>{plan.mappings.map(m => <tr key={m.clipId}><td>{m.clipId}</td><td>{seconds(m.sourceInMs)} → {seconds(m.sourceOutMs)}</td><td>{seconds(m.timelineInMs)} → {seconds(m.timelineOutMs)}</td></tr>)}</tbody></table></div>}
        <button className="ca-primary" disabled={!!busy || !plan.canCreate || !!result} onClick={() => run('Đang tạo timeline…', async () => {
          const created = await assistantRequest('materialize', { draft, inputHash: plan.inputHash, idempotencyKey: 'ca-' + plan.inputHash }); useVideoStore.setState({ assistantResult: created });
        })}>Tạo timeline chỉnh sửa được</button></>}
      {result && <div className="ca-result"><a href={'/video?projectId=' + result.projectId}>Mở timeline trong Video Editor ↗</a><button disabled={!!busy || (!!result.jobId && !['error', 'cancelled'].includes(render?.status))} onClick={() => run('Đang gửi lệnh xuất MP4…', async () => {
        const jobId = result.jobId ? await retryRenderJob(result.jobId) : await startRenderJob(result.projectId, 'original', { versionId: result.versionId, baseRevision: 0, idempotencyKey: 'ca-render-' + result.versionId }); useVideoStore.setState({ assistantResult: { ...result, jobId } }); setRender(null);
      })}>{['error', 'cancelled'].includes(render?.status) ? 'Thử xuất lại' : 'Xuất MP4'}</button>{result.jobId && <span role="status">{render?.status === 'done' ? 'Đã xuất video' : render?.error_message || `Render ${render?.progress_pct || 0}%`}</span>}
        {render?.status === 'done' && <a href={`/api/video-render/${result.projectId}/render/${result.jobId}/download`}>Tải video MP4</a>}</div>}
    </section>
  </main>;
}
