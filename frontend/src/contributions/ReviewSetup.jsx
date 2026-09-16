import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Monitor, Play, Pause, Stethoscope, Github, Upload } from 'lucide-react';
import { Status } from './ReviewGraph.jsx';
export default function ReviewSetup({ state, act, doctor, setDoctor }) {
  const config = state.config || {}; const [form, setForm] = useState(null); const [bindings, setBindings] = useState(''); const [baseline, setBaseline] = useState(null);
  useEffect(() => { setForm({ sourceRepo: config.sourceRepo, controlRepo: config.controlRepo, machineName: config.machineName, policy: config.policy });
    setBindings(Object.entries(config.contributorBindings || {}).map(([login, email]) => `${login}=${email}`).join('\n')); }, [JSON.stringify(config)]);
  if (!form) return null;
  const update = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const policy = (key, value) => setForm(old => ({ ...old, policy: { ...old.policy, [key]: value } }));
  const steps = [
    { title: 'Kho contributor riêng', description: config.sourceRepo, complete: state.mode === 'github' },
    { title: 'Kho control chỉ owner', description: state.mode === 'github' ? config.controlRepo : 'Đang lưu hồ sơ trên máy này', complete: state.mode === 'github' },
    { title: 'CLI đã đăng nhập', description: doctor ? 'Kết quả kiểm tra trên máy hiện tại' : 'Bấm Kiểm tra máy để xác minh', complete: doctor?.cli?.[form.policy?.provider]?.authenticated },
    { title: 'Worker nhận việc', description: config.workerEnabled ? config.machineName : 'Bật khi muốn máy này xử lý hàng đợi', complete: config.workerEnabled },
  ];
  return <div className="review-setup">
    <div className="review-section-heading"><div><p className="review-eyebrow">CÀI ĐẶT & MÁY XỬ LÝ</p><h2>Một hàng đợi, hai máy luân phiên</h2><p>GitHub giữ việc khi cả hai máy tắt. Worker tiếp tục nhận việc khi một máy được bật.</p></div>
      <button onClick={() => act('/doctor', 'GET').then(value => value && setDoctor(value))}><Stethoscope size={16} />Kiểm tra máy</button></div>
    <div className="review-setup-steps">{steps.map((step, index) => <div key={step.title} className={step.complete ? 'is-complete' : ''}>
      {step.complete ? <CheckCircle2 size={22} /> : <Circle size={22} />}<small>BƯỚC {index + 1}</small><strong>{step.title}</strong><p>{step.description}</p></div>)}</div>
    <div className="review-setup-grid"><section className="review-card"><h3><Github size={18} /> Kết nối và chia sẻ source</h3>
      <label>Repository contributor<input value={form.sourceRepo || ''} onChange={event => update('sourceRepo', event.target.value)} /></label>
      <label>Repository control riêng tư<input value={form.controlRepo || ''} onChange={event => update('controlRepo', event.target.value)} /></label>
      <p className="review-hint">Repo control lưu báo cáo, quyền duyệt và lịch sử. Chỉ cấp quyền kho contributor cho người đóng góp.</p>
      <div className="review-actions"><button onClick={() => act('/settings', 'PUT', { sourceRepo: form.sourceRepo, controlRepo: form.controlRepo })}>Lưu repository</button>
        <button className="review-primary" onClick={() => act('/connect', 'POST', {})}>Kết nối kho riêng tư</button></div>
      <hr /><h4>Gói contributor</h4><p className="review-hint">Xuất source cho dev, hướng dẫn và baseline. Lịch sử riêng, dữ liệu vận hành và thông tin đăng nhập được lọc trước khi gửi.</p>
      <div className="review-actions"><button onClick={() => act('/distribution/prepare', 'POST', {}).then(value => value && setBaseline(value))}>Chuẩn bị gói</button>
        <button disabled={!baseline} onClick={() => act('/distribution/publish', 'POST', { baselineId: baseline.id })}><Upload size={14} />Đẩy gói đã chuẩn bị</button></div>
      {baseline && <p className="review-hint">Baseline {baseline.id} · {baseline.fileCount} file · {baseline.status}</p>}
    </section><section className="review-card"><h3><Monitor size={18} /> Máy hiện tại</h3>
      <label>Tên máy<input value={form.machineName || ''} onChange={event => update('machineName', event.target.value)} /></label>
      <p className="review-hint">Owner: {config.ownerEmail || 'Chưa cấu hình SF_REVIEW_OWNER_EMAIL trên máy'}</p>
      <div className="review-actions"><button onClick={() => act('/settings', 'PUT', { machineName: form.machineName })}>Lưu tên</button>
        <button className="review-primary" onClick={() => act(`/worker/${config.workerEnabled ? 'stop' : 'start'}`, 'POST', {})}>
          {config.workerEnabled ? <Pause size={15} /> : <Play size={15} />}{config.workerEnabled ? 'Tắt worker' : 'Bật worker'}</button></div>
      {doctor && <div className="review-doctor">{Object.entries(doctor.cli || {}).map(([name, value]) => <div key={name}><strong>{name}</strong>
        <span>{value.version || 'Chưa cài CLI'}</span><Status value={value.authenticated ? 'passed' : 'waiting'} /></div>)}
        {doctor.sandbox && <p className="review-hint">Sandbox: {doctor.sandbox.ready ? 'Sẵn sàng' : doctor.sandbox.message || 'Chưa cấu hình'}</p>}</div>}
      <button onClick={() => act('/sandbox/setup', 'POST', {})}>Chuẩn bị image sandbox</button>
      <h4>Các máy đã kết nối</h4>{state.workers?.length ? state.workers.map(machine => <div className="review-machine" key={machine.id}>
        <Monitor size={18} /><div><strong>{machine.name}</strong><small>{machine.platform} · {machine.currentJobId ? 'Đang nhận việc' : 'Không có việc đang chạy'}</small></div>
        <Status value={machine.online ? machine.status : 'stopped'} /></div>) : <p className="review-hint">Chưa có worker gửi trạng thái.</p>}
    </section><section className="review-card"><h3>Model theo nhiệm vụ</h3><p className="review-hint">Trợ lí dùng model nhỏ; review và tổng hợp tăng theo độ khó. Claude chỉ dùng Haiku, Sonnet, Opus; không có fallback.</p>
      <label>Provider<select aria-label="Provider" value={form.policy.provider} onChange={event => policy('provider', event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
      <div className="review-policy-map">{(form.policy.provider === 'codex' ? [['Nhẹ / Trợ lí', 'GPT 5.6 Luna'], ['Thông thường', 'GPT 5.6 Terra'], ['Phức tạp', 'GPT 5.6 Sol']] :
        [['Nhẹ / Trợ lí', 'Claude Haiku 4.5'], ['Thông thường', 'Claude Sonnet 5'], ['Phức tạp', 'Claude Opus 5']]).map(([label, model]) => <div key={label}><span>{label}</span><strong>{model}</strong></div>)}</div>
      <div className="review-fields"><label>Số lượt / hồ sơ<input type="number" min="1" max="12" value={form.policy.maxCalls} onChange={event => policy('maxCalls', Number(event.target.value))} /></label>
        <label>Ngân sách token<input type="number" min="4000" max="500000" step="1000" value={form.policy.maxJobTokens} onChange={event => policy('maxJobTokens', Number(event.target.value))} /></label>
        <label>Giây / lượt<input type="number" min="10" max="600" value={form.policy.maxCallMs / 1000} onChange={event => policy('maxCallMs', Number(event.target.value) * 1000)} /></label></div>
      <p className="review-hint">Kiểm tra token trước mỗi lượt; một lượt đang chạy có thể vượt phần token còn lại. CLI dùng quota tài khoản; số USD được báo là ước tính nếu provider có cung cấp.</p>
      <button onClick={() => act('/settings', 'PUT', { policy: { ...form.policy, maxUsd: 0 } })}>Lưu chính sách model</button>
    </section><section className="review-card"><h3>Contributor và quyền xem</h3><label>Ghép GitHub với email đăng nhập<textarea rows={6} value={bindings} placeholder="github-login=email@example.com" onChange={event => setBindings(event.target.value)} /></label>
      <p className="review-hint">Mỗi dòng một người. Contributor chỉ xem đề xuất và phản hồi của mình; chỉ owner xem báo cáo riêng và duyệt phát hành.</p>
      <button onClick={() => {
        const contributorBindings = Object.fromEntries(bindings.split('\n').map(line => line.trim()).filter(Boolean).map(line => line.split('=').map(part => part.trim())));
        act('/settings', 'PUT', { contributorBindings });
      }}>Lưu danh sách</button>
    </section></div>
  </div>;
}
