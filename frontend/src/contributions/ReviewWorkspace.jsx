import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ArrowLeft, Bell, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, ExternalLink, FileText, GitPullRequest, Inbox, Layers, LoaderCircle, Monitor,
  Play, Plus, RefreshCw, Rocket, Search, Settings2, ShieldCheck, Users, X } from 'lucide-react';
import { useStore } from '../store.js';
import { reviewApi } from './api.js';
import ReviewGraph, { Status } from './ReviewGraph.jsx';
import ReviewSetup from './ReviewSetup.jsx';
import TrialInstructions, { trialIsOpen } from './TrialInstructions.jsx';
import SimpleContribution from './SimpleContribution.jsx';
import AdminUsers from './AdminUsers.jsx';
import AdminLibrary from './AdminLibrary.jsx';
import AdminOperations from './AdminOperations.jsx';
import AdminAnalytics from './AdminAnalytics.jsx';
import { adminApi, useAdminData } from './AdminShared.jsx';
import './review.css';

function ago(value) { if (!value) return 'Chưa cập nhật'; const minutes = Math.floor((Date.now() - value) / 60000); return minutes < 1 ? 'Vừa xong' : minutes < 60 ? `${minutes} phút trước` : new Date(value).toLocaleString('vi-VN'); }
const kindName = { idea: 'Ý tưởng', pull_request: 'Pull request', package: 'Gói node / flow' };
function Empty({ title, children }) { return <div className="review-empty"><Inbox size={32} /><h3>{title}</h3><p>{children}</p></div>; }
function RoleDetail({ task, job, role }) {
  if (!task) return <div className="review-role-detail"><strong>{role === 'owner' ? 'Owner quyết định' : role === 'release' ? 'Phát hành có kiểm tra' : 'Nguồn đề xuất'}</strong>
    <p>{role === 'owner' ? 'Báo cáo → candidate đạt kiểm tra → dùng thử → nghiệm thu → duyệt đúng bản.' : role === 'release' ? 'Áp dụng candidate đã duyệt, kiểm tra phiên bản, health và smoke; giữ bản trước để phục hồi.' : `${kindName[job.kind]} · revision ${job.revision}`}</p></div>;
  return <div className="review-role-detail"><div className="review-section-heading"><strong>{task.label}</strong><Status value={task.status} /></div>
    <div className="review-detail-metrics"><div><small>MODEL ĐƯỢC CHỌN</small><span>{task.selection?.model}</span></div><div><small>EFFORT</small><span>{task.selection?.effort}</span></div>
      <div><small>MODEL THỰC DÙNG</small><span>{task.result?.actualModel || 'Chưa có kết quả xác minh'}</span></div>
      <div><small>THỜI GIAN / TOKEN</small><span>{task.result ? `${(task.result.durationMs / 1000).toFixed(1)}s · ${((task.result.usage?.inputTokens || 0) + (task.result.usage?.outputTokens || 0)).toLocaleString()}` : 'Chưa có số liệu'}</span></div></div>
    {task.error && <p className="review-error-text">{task.error}</p>}
    <p>{task.result?.report?.summary || 'Kết quả xuất hiện khi vai trò này hoàn tất.'}</p>
    {!!task.result?.report?.gaps?.length && <p className="review-hint">Chưa xác minh: {task.result.report.gaps.join(' · ')}</p>}
  </div>;
}
function Report({ job }) {
  if (!job.report) return <Empty title="Chưa có báo cáo">Bắt đầu đánh giá để các vai trò phân tích đề xuất này.</Empty>;
  return <><p className="review-report-summary">{job.report.summary}</p><div className="review-evidence-label"><ShieldCheck size={14} />Nhận định AI · bằng chứng chạy thử ở phần Kiểm tra</div>
    <h4>Findings <span>{job.report.findings.length}</span></h4>
    {job.report.findings.length ? job.report.findings.map(finding => <article key={finding.id} className={`review-finding severity-${finding.severity}`}>
      <small>{finding.severity.toUpperCase()} · {finding.role}</small><strong>{finding.title}</strong><p>{finding.detail}</p>
      {finding.file && <code>{finding.file}{finding.line ? `:${finding.line}` : ''}</code>}</article>) : <p className="review-hint">Các vai trò chưa ghi nhận finding. Kết quả này không thay thế kiểm thử.</p>}
    {!!job.report.gaps.length && <><h4>Còn thiếu bằng chứng</h4><ul>{job.report.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></>}
    {!!job.report.suggestedTests.length && <><h4>Ca kiểm thử đề xuất</h4><ul>{job.report.suggestedTests.map((test, i) => <li key={i}>{test}</li>)}</ul></>}
  </>;
}
function ReviewDialog({ dialog, job, config, close, submit, onOpenTrial, busy }) {
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [kind, setKind] = useState('idea'); const [publish, setPublish] = useState(false);
  const [targetId, setTargetId] = useState(config?.releaseTargets?.[0]?.id || ''); const [accepted, setAccepted] = useState(false);
  const [trialResult, setTrialResult] = useState('');
  const labels = { new: 'Gửi đề xuất', feedback: 'Yêu cầu chỉnh sửa', trial: 'Dùng thử và ghi kết quả', test: 'Test thử thay đổi', accept: 'Chấp nhận đóng góp', approve: 'Duyệt bản phát hành', apply: 'Áp dụng bản đã duyệt', rollback: 'Khôi phục bản trước' };
  const isRelease = ['approve', 'apply', 'rollback'].includes(dialog);
  return <div className="review-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <form className={`review-dialog ${['trial', 'test'].includes(dialog) ? 'is-trial' : ''}`} role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" onSubmit={event => { event.preventDefault(); if (dialog === 'test') return; submit({ title, description: body, body,
      kind, publish, notes: body, result: dialog === 'accept' ? 'accepted' : trialResult, targetId, revision: job?.revision, digest: job?.candidate?.digest }); }}>
      <div className="review-section-heading"><h2 id="review-dialog-title">{labels[dialog]}</h2><button type="button" className="review-icon-button" aria-label="Đóng" onClick={close}><X size={19} /></button></div>
      {dialog === 'new' ? <><label>Loại đề xuất<select value={kind} onChange={event => setKind(event.target.value)}><option value="idea">Ý tưởng / thay đổi</option><option value="package">Gói node / flow</option></select></label>
        <label>Tiêu đề<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label></> : <p><strong>{job.title}</strong> · revision {job.revision}</p>}
      {['trial', 'test'].includes(dialog) && <TrialInstructions job={job} onOpen={onOpenTrial} busy={busy} simple={dialog === 'test'} />}
      {dialog === 'accept' && <><p>Ghi nhận bạn đã test và đồng ý với bản thay đổi này. Việc phát hành được thực hiện riêng sau đó.</p><label className="review-check"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} />Tôi đã test thử và thấy đúng yêu cầu</label></>}
      {isRelease && <><label>Nơi phát hành<select required value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Chọn nơi phát hành đã cấu hình</option>
        {config?.releaseTargets?.map(target => <option key={target.id} value={target.id}>{target.name} · {target.platform}</option>)}</select></label>
        <p className="review-hint">Candidate: <code>{job.candidate?.digest || 'Chưa có candidate'}</code></p>
        {!config?.releaseTargets?.length && <p className="review-hint">Owner cần khai báo target và lệnh kiểm tra tin cậy trong cấu hình máy trước.</p>}</>}
      {dialog === 'trial' && <label>Kết quả dùng thử<select required value={trialResult} onChange={event => setTrialResult(event.target.value)}><option value="">Chọn sau khi bạn đã dùng thử</option><option value="accepted">Đạt yêu cầu</option><option value="rejected">Cần chỉnh sửa</option></select></label>}
      {dialog !== 'test' && <label>{dialog === 'new' ? 'Mục tiêu và tiêu chí hoàn tất' : ['trial', 'accept'].includes(dialog) ? 'Bạn đã thử gì và thấy kết quả thế nào?' : 'Ghi chú'}<textarea autoFocus={dialog !== 'new' && dialog !== 'trial'} rows={dialog === 'trial' ? 3 : 5} placeholder={['trial', 'accept'].includes(dialog) ? 'Ví dụ: đã nhập Xin chào, chạy Text thành công; ô nhập và hướng dẫn hiển thị đúng.' : undefined} required maxLength={8000} value={body} onChange={event => setBody(event.target.value)} /></label>}
      {dialog === 'feedback' && job.kind === 'pull_request' && <label className="review-check"><input type="checkbox" checked={publish} onChange={event => setPublish(event.target.checked)} />Đăng phản hồi này vào PR GitHub để contributor nhận được</label>}
      {isRelease && <label className="review-check"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} />Tôi xác nhận thao tác trên target và candidate nêu trên</label>}
      <div className="review-actions"><button type="button" onClick={close}>Đóng</button>{dialog !== 'test' && <button className="review-primary" type="submit" disabled={busy || (dialog === 'trial' && (!trialIsOpen(job) || !trialResult)) || (dialog === 'accept' && (!accepted || !trialIsOpen(job)))}>{dialog === 'trial' ? 'Lưu kết quả dùng thử' : labels[dialog]}</button>}</div>
    </form></div>;
}
export default function ReviewWorkspace() {
  const user = useStore(s => s.currentUser); const openSettings = useStore(s => s.openSettings);
  const [state, setState] = useState(null); const [job, setJob] = useState(null); const [selectedId, setSelectedId] = useState(null);
  const [role, setRole] = useState('assistant'); const [tab, setTab] = useState('report'); const [page, setPage] = useState('inbox');
  const [advanced, setAdvanced] = useState(false);
  const environment = useAdminData(() => user?.role === 'admin' ? adminApi('/admin-console/environment') : Promise.resolve(null), [user?.role]);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [dialog, setDialog] = useState(null); const [doctor, setDoctor] = useState(null);
  const busyRef = useRef(false); const selectionRef = useRef(null); const refreshSequence = useRef(0);
  selectionRef.current = selectedId;
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const next = await reviewApi('/state'); if (sequence !== refreshSequence.current) return;
    setState(next);
    const current = selectionRef.current || next.jobs[0]?.id;
    if (current && next.jobs.some(value => value.id === current)) {
      if (!selectionRef.current) setSelectedId(current);
      const detail = await reviewApi(`/jobs/${current}`);
      if (sequence === refreshSequence.current && (!selectionRef.current || selectionRef.current === current)) setJob(detail);
    } else { setJob(null); setSelectedId(null); }
  }, []);
  useEffect(() => {
    let stopped = false; const load = () => { if (!stopped && !document.hidden) refresh().catch(err => !stopped && setError(err.message)); };
    load(); const timer = setInterval(load, 12000); window.addEventListener('focus', load);
    return () => { stopped = true; ++refreshSequence.current; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [refresh]);
  useEffect(() => { if (!selectedId) return; let active = true; setJob(null);
    reviewApi(`/jobs/${selectedId}`).then(value => active && setJob(value)).catch(err => active && setError(err.message));
    return () => { active = false; }; }, [selectedId]);
  const act = async (path, method = 'POST', body = {}) => {
    if (busyRef.current) return null; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { const result = await reviewApi(path, method, body); await refresh(); setNotice(method === 'GET' ? 'Đã kiểm tra trạng thái máy.' : 'Đã ghi nhận thao tác.'); return result; }
    catch (err) { setError(err.message); return null; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const jobAct = action => act(`/jobs/${job.id}/${action}`, 'POST', { revision: job.revision });
  const openTrial = async () => {
    if (busyRef.current || state.stale || !job.gates?.canPreview) return;
    // Reserve a tab during the click so browsers do not block an asynchronous popup.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setDialog(advanced ? 'trial' : 'test');
    const trial = trialIsOpen(job) ? job.trial : await jobAct('preview');
    if (!trial?.url) { popup?.close(); return; }
    const url = new URL(trial.url);
    if (url.protocol !== 'http:' || !/^preview-[a-f0-9-]+\.localhost$/.test(url.hostname)) { popup?.close(); setError('Địa chỉ dùng thử không hợp lệ.'); return; }
    if (popup) popup.location.replace(url.href);
  };
  const submit = async body => {
    const result = await act(dialog === 'new' ? '/jobs' : `/jobs/${job.id}/${dialog === 'accept' ? 'trial' : dialog}`, 'POST', body);
    if (result) { setDialog(null); if (dialog === 'new') setSelectedId(result.id); }
  };
  const jobs = state?.jobs || []; const isOwner = state?.isOwner;
  const visible = jobs.filter(value => (filter === 'all' || (filter === 'attention' ? ['waiting', 'reviewed', 'changes_requested'].includes(value.status) : value.status === filter)) &&
    `${value.title} ${value.author?.name || ''} ${value.source?.number || ''}`.toLowerCase().includes(search.toLowerCase()));
  const selectedTask = job?.tasks?.find(task => task.id === role);
  const preparing = job?.candidateBuild?.status === 'preparing' && job.candidateBuild.expiresAt > Date.now();
  const canPrepare = job?.kind === 'pull_request' && !!job.report && !job.candidate && !job.lease && !preparing;
  return <div className="review-shell" aria-busy={busy}>
    <aside className="review-nav"><a href="#" className="review-brand" title="Về Space Flow"><Layers size={22} /><span>space<span>flow</span></span></a>
      <small>WORKSPACE</small><button className={page === 'inbox' ? 'active' : ''} onClick={() => setPage('inbox')}><Inbox size={18} />Đóng góp<span className="review-nav-count">{jobs.length}</span></button>
      {isOwner && <><small>QUẢN LÝ</small><button className={page === 'setup' ? 'active' : ''} onClick={() => setPage('setup')}><Monitor size={18} />Máy & cài đặt</button>
        <button className={page === 'library' ? 'active' : ''} onClick={() => setPage('library')}><Layers size={18} />Node / Flow</button><button className={page === 'users' ? 'active' : ''} onClick={() => setPage('users')}><Users size={18} />Người dùng</button>
        <button className={page === 'operations' ? 'active' : ''} onClick={() => setPage('operations')}><ShieldCheck size={18} />Vận hành</button></>}
      {user?.role === 'admin' && <button className={page === 'analytics' ? 'active' : ''} onClick={() => setPage('analytics')}><ClipboardList size={18} />Phân tích dữ liệu</button>}
      <div className="review-nav-bottom"><button onClick={() => openSettings('appearance')}><Settings2 size={18} />Giao diện</button><a href="#"><ArrowLeft size={18} />Về canvas</a>
        <div className="review-profile"><span>{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</span><div><strong>{user?.name || 'Tài khoản của bạn'}</strong><small>{isOwner ? 'Owner · toàn quyền duyệt' : 'Contributor'}</small></div></div></div>
    </aside><main className="review-main"><header className="review-header"><div><span>Space Flow</span><ChevronRight size={13} /><strong>{page === 'analytics' ? 'Phân tích dữ liệu' : isOwner ? 'Control Center' : 'Đề xuất của tôi'}</strong></div>
      <div><span className={`review-connection ${state?.stale ? 'is-offline' : ''}`}><i />{state?.stale ? 'Mất kết nối' : state?.mode === 'github' ? 'Đã nối GitHub' : 'Lưu trên máy'}</span>
        <button className="review-icon-button" aria-label="Làm mới" disabled={busy} onClick={() => refresh().catch(err => setError(err.message))}><RefreshCw size={17} /></button></div></header>
      {(error || notice || state?.stale) && <div className={`review-banner ${error || state?.stale ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{error || (state?.stale ? state.syncError?.message : notice)}</span><button aria-label="Đóng thông báo" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div>}
      {isOwner && <div className="admin-environment"><span>Môi trường: <strong>{environment.data?.name || (environment.error ? 'Chưa xác định' : 'Đang tải…')}</strong> · {window.location.host}</span>
        {environment.data?.isolated && <span>Dữ liệu local riêng; chưa kết nối dữ liệu server chung.</span>}</div>}
      {isOwner && <nav className="admin-mobile-nav" aria-label="Mục quản lý">{[['inbox', 'Đóng góp'], ['library', 'Node / Flow'], ['users', 'Người dùng'], ['operations', 'Vận hành'], ['setup', 'Cài đặt']].map(([value, label]) => <button key={value} className={page === value ? 'active' : ''} onClick={() => setPage(value)}>{label}</button>)}</nav>}
      {user?.role === 'admin' && <nav className="admin-mobile-nav" aria-label="Báo cáo quản lý"><button className={page === 'analytics' ? 'active' : ''} onClick={() => setPage('analytics')}>Phân tích dữ liệu</button></nav>}
      {page === 'analytics' && user?.role === 'admin' ? <AdminAnalytics /> : !state ? <Empty title={error ? 'Chưa tải được hồ sơ' : 'Đang mở workspace'}>{error || 'Đang đọc hàng đợi và quyền truy cập của bạn.'}</Empty> : page === 'library' && isOwner ? <AdminLibrary /> : page === 'users' && isOwner ? <AdminUsers /> : page === 'operations' && isOwner ? <AdminOperations /> : page === 'setup' && isOwner ?
        <ReviewSetup state={state} act={act} doctor={doctor} setDoctor={setDoctor} /> : <>
          <div className="review-page-heading"><div><p className="review-eyebrow">ĐÓNG GÓP CHO SPACE FLOW</p><h1>{isOwner ? 'Xem và duyệt đóng góp' : 'Đóng góp của bạn'}</h1><p>{isOwner ? 'Chọn đóng góp, kiểm tra, test thử và chấp nhận khi bạn thấy đúng yêu cầu.' : 'Gửi ý tưởng, theo dõi tiến độ và nhận phản hồi riêng.'}</p></div>
            <div className="review-actions">{isOwner && <button disabled={busy || state.stale} onClick={() => act('/sync', 'POST', {})}><RefreshCw size={15} />Đồng bộ PR</button>}
              <button className="review-primary" onClick={() => setDialog('new')}><Plus size={17} />Gửi đề xuất</button></div></div>
          <div className="review-stats">{[
            ['Trong hàng đợi', jobs.filter(value => ['submitted', 'queued'].includes(value.status)).length, Inbox],
            ['Đang đánh giá', jobs.filter(value => value.status === 'running').length, GitPullRequest],
            ['Cần bạn xem', jobs.filter(value => ['waiting', 'reviewed', 'changes_requested'].includes(value.status)).length, Bell],
            ['Đã phát hành', jobs.filter(value => value.status === 'released').length, Rocket],
          ].map(([label, count, Icon]) => <div key={label}><span><Icon size={17} />{label}</span><strong>{count}</strong></div>)}</div>
          <div className={`review-workbench ${isOwner ? advanced ? '' : 'is-simple' : 'is-contributor'}`}>
            <section className="review-inbox"><div className="review-panel-title"><h2>Hộp thư đóng góp</h2><span>{visible.length}</span></div><label className="review-search"><Search size={16} /><input aria-label="Tìm đề xuất" placeholder="Tìm tiêu đề, người gửi…" value={search} onChange={event => setSearch(event.target.value)} /></label>
              <div className="review-filters">{[['all', 'Tất cả'], ['attention', 'Cần xem'], ['queued', 'Đang chờ']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
              <div className="review-inbox-list">{visible.length ? visible.map(value => <button key={value.id} className={`review-inbox-item ${selectedId === value.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(value.id); setRole('assistant'); setAdvanced(false); }}>
                <div><small>{kindName[value.kind]}{value.source?.number ? ` #${value.source.number}` : ''}</small><span>{ago(value.updatedAt)}</span></div><strong>{value.title}</strong>
                <p>{value.author?.name || value.author?.githubLogin || value.author?.email}</p><div><Status value={value.status} /><span>r{value.revision}</span></div>
              </button>) : <Empty title="Hộp thư đang trống">{isOwner ? 'Đồng bộ PR từ GitHub hoặc tạo đề xuất đầu tiên.' : 'Bắt đầu bằng một ý tưởng hoặc thay đổi bạn muốn gửi.'}</Empty>}</div>
              {isOwner && <div className="review-inbox-footer"><Monitor size={14} />{state.workers?.filter(machine => machine.online).length || 0} máy đang kết nối</div>}
            </section>
            {!job ? <div className="review-no-selection"><Empty title={selectedId ? 'Đang mở đề xuất' : 'Mọi việc bắt đầu từ một đóng góp'}>Chọn một hồ sơ trong hộp thư để xem luồng xử lý và kết quả.</Empty></div> : isOwner && !advanced ? <SimpleContribution key={job.id} job={job} busy={busy} stale={state.stale}
              onCheck={() => jobAct(job.status === 'waiting' ? 'resume' : 'review')} onTest={() => job.gates?.canPreview ? openTrial() : job.candidate ? setDialog('test') : jobAct('candidate')}
              onAccept={() => setDialog('accept')} onFeedback={() => setDialog('feedback')} onStop={() => jobAct('cancel')} onAdvanced={() => setAdvanced(true)} /> : <>
              {isOwner && <section className="review-flow-panel"><div className="review-panel-title"><div><h2>{job.title}</h2><p>{kindName[job.kind]} · Revision {job.revision} · {ago(job.updatedAt)}</p></div><Status value={job.status} /></div>
                <button className="review-icon-button" onClick={() => setAdvanced(false)}><ArrowLeft size={15} />Về chế độ đơn giản</button>
                <div className="review-next-step"><div><strong>{job.release?.status === 'released' ? 'Đã phát hành và kiểm tra' : job.gates?.canApply ? 'Bước tiếp theo: chọn nơi phát hành' : job.gates?.canPreview ? 'Bước tiếp theo: bạn dùng thử' : 'Đang chuẩn bị trước khi dùng thử'}</strong>
                  <p>{job.gates?.canPreview ? 'Mở bản riêng, làm theo hướng dẫn rồi quay lại ghi kết quả.' : job.gates?.previewReasons?.[0] || 'Hệ thống cần hoàn tất đánh giá và kiểm tra bản thay đổi.'}</p></div>
                  <button onClick={() => setDialog('trial')}><CircleHelp size={16} />Hướng dẫn dùng thử</button></div>
                <div className="review-flow-toolbar"><span><i className={job.lease ? 'review-live-dot' : ''} />{job.lease ? 'Máy đang xử lý' : job.status === 'queued' ? 'Chờ worker nhận việc' : 'Luồng công việc'}</span>
                  <button disabled={busy || state.stale || !!job.lease || ['queued', 'released'].includes(job.status)} onClick={() => jobAct(job.status === 'waiting' ? 'resume' : 'review')}><Play size={14} />{job.status === 'waiting' ? 'Tiếp tục có kiểm soát' : 'Đánh giá'}</button>
                  {['queued', 'running', 'waiting'].includes(job.status) && <button disabled={busy} onClick={() => jobAct('cancel')}>Dừng</button>}</div>
                {job.waitReason && <p className="review-wait-reason"><CircleHelp size={14} />Đang chờ: {job.waitReason}</p>}
                <div className="review-graph"><ReactFlowProvider><ReviewGraph key={job.id} job={job} selectedRole={role} onSelect={setRole} /></ReactFlowProvider></div>
                <RoleDetail task={selectedTask} job={job} role={role} /></section>}
              <section className="review-report-panel"><div className="review-panel-title"><h2>{isOwner ? 'Báo cáo & quyết định' : job.title}</h2><FileText size={17} /></div>
                {isOwner && <div className="review-tabs">{[['report', 'Báo cáo'], ['checks', 'Kiểm tra'], ['source', 'Thay đổi'], ['audit', 'Lịch sử']].map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>}
                <div className="review-report-content">
                  {isOwner && tab === 'report' && <Report job={job} />}
                  {isOwner && tab === 'checks' && <><h4>Candidate hiện tại</h4><p className="review-hint"><code>{job.candidate?.digest || 'Chưa chuẩn bị candidate'}</code></p><Status value={job.candidateBuild?.status || 'pending'} />
                    {job.candidateBuild?.error && <p className="review-error-text">{job.candidateBuild.error}</p>}
                    {job.candidateBuild?.diagnostic && <details><summary>Chi tiết lỗi</summary><pre>{job.candidateBuild.diagnostic}</pre></details>}
                    {(job.checks || []).map(check => <div className="review-check-row" key={check.name}><strong>{check.name}</strong><Status value={check.status} /><p>{check.summary}</p></div>)}
                    <button disabled={busy || state.stale || job.kind !== 'pull_request' || (job.candidateBuild?.status === 'preparing' && job.candidateBuild.expiresAt > Date.now())} onClick={() => jobAct('candidate')}>Chuẩn bị & kiểm tra candidate</button>
                    <h4>Dùng thử</h4>{trialIsOpen(job) && <a className="review-link" href={job.trial.url} target="_blank" rel="noreferrer">Mở môi trường dùng thử <ExternalLink size={14} /></a>}
                    <p className="review-hint">Môi trường riêng, dữ liệu thử; phiên dùng thử có thời hạn.</p>
                    <div className="review-actions"><button disabled={!job.gates?.canPreview || busy || state.stale} onClick={openTrial}>Mở bản dùng thử</button>
                      <button disabled={!trialIsOpen(job) || busy} onClick={() => setDialog('trial')}>Ghi kết quả dùng thử</button></div>
                    <ul className="review-gate-reasons">{job.gates?.previewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                    {job.release && <><h4>Phát hành</h4><Status value={job.release.status} /><p>{job.release.message}</p><div className="review-actions">
                      <button onClick={() => act(`/jobs/${job.id}/reconcile`, 'POST', { revision: job.revision, targetId: job.release.targetId })}>Đối soát</button>
                      <button onClick={() => setDialog('rollback')}>Khôi phục bản trước</button></div></>}
                  </>}
                  {isOwner && tab === 'source' && <><p>{job.description || 'Không có mô tả bổ sung.'}</p>{job.source?.url && <a className="review-link" href={job.source.url} target="_blank" rel="noreferrer">Mở pull request <ExternalLink size={13} /></a>}
                    <h4>File thay đổi</h4>{job.source?.files?.map(file => <div className="review-source-file" key={file.filename}><code>{file.filename}</code><small>+{file.additions} −{file.deletions}</small></div>)}
                    {job.source?.patch && <details><summary>Xem diff</summary><pre>{job.source.patch}</pre></details>}</>}
                  {isOwner && tab === 'audit' && <ol className="review-timeline">{[...(job.events || [])].reverse().map(event => <li key={event.id}><strong>{event.type}</strong><span>{new Date(event.at).toLocaleString('vi-VN')}</span><small>{event.detail?.role || event.detail?.code || event.actor}</small></li>)}</ol>}
                  {!isOwner && <><Status value={job.status} /><p>{job.description}</p>{job.source?.url && <a href={job.source.url} target="_blank" rel="noreferrer">Mở PR của bạn</a>}</>}
                  {!!job.feedback?.length && <><h4>Phản hồi cho contributor</h4>{job.feedback.map(feedback => <article className="review-feedback" key={feedback.id}><p>{feedback.body}</p><small>{ago(feedback.createdAt)} · {feedback.delivery === 'in_app' ? 'Trong ứng dụng' : feedback.delivery}</small></article>)}</>}
                </div>
                {isOwner && <div className="review-decision"><div><ShieldCheck size={15} /><span>Chỉ bạn được duyệt và áp dụng</span></div>
                  <button disabled={busy || state.stale || !!job.lease} onClick={() => setDialog('feedback')}>Yêu cầu chỉnh sửa</button>
                  {job.gates?.canApply ? <button className="review-primary" disabled={busy || state.stale} onClick={() => setDialog(job.approval ? 'apply' : 'approve')}><CheckCircle2 size={15} />{job.approval ? 'Áp dụng bản đã duyệt' : 'Duyệt bản phát hành'}</button> : canPrepare ?
                    <button className="review-primary" disabled={busy || state.stale} onClick={() => { setTab('checks'); jobAct('candidate'); }}><Play size={15} />Chuẩn bị bản dùng thử</button> :
                    <button className="review-primary" disabled={busy || state.stale || !job.gates?.canPreview} onClick={openTrial}><Play size={15} />Dùng thử bản này</button>}
                  {!job.gates?.canApply && <p>{job.gates?.canPreview ? 'Dùng thử trước; ghi kết quả đạt để mở bước phát hành.' : job.gates?.previewReasons?.[0]}</p>}</div>}
              </section></>}
          </div></>}
    </main>{busy && <div className="review-busy"><LoaderCircle size={16} className="review-spin" />Đang xử lý…</div>}
    {dialog && <ReviewDialog key={dialog} dialog={dialog} job={job} config={state?.config} close={() => setDialog(null)} submit={submit} onOpenTrial={openTrial} busy={busy} />}
  </div>;
}
