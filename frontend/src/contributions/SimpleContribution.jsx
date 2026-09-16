import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, FlaskConical, Play, Settings2 } from 'lucide-react';
import { trialIsOpen } from './TrialInstructions.jsx';

export function contributionStatus(job) {
  if (job.release?.status === 'released') return 'Đã phát hành';
  if (job.status === 'changes_requested' || job.trial?.result === 'rejected') return 'Cần chỉnh sửa';
  if (job.trial?.result === 'accepted' && job.trial.digest === job.candidate?.digest) return 'Đã chấp nhận';
  if (job.candidateBuild?.status === 'preparing' && job.candidateBuild.expiresAt > Date.now()) return 'Đang chuẩn bị bản test';
  if (job.candidateBuild?.status === 'failed') return 'Chuẩn bị bản test chưa thành công';
  return ({ submitted: 'Chưa kiểm tra', queued: 'Đang chờ máy kiểm tra', running: 'Đang kiểm tra', waiting: 'Kiểm tra đang tạm dừng', reviewed: 'Đã có báo cáo', cancelled: 'Đã dừng' })[job.status] || 'Chờ xử lý';
}
export default function SimpleContribution({ job, busy, stale, onCheck, onTest, onAccept, onFeedback, onAdvanced, onStop }) {
  const [reportOpen, setReportOpen] = useState(false);
  const reportRef = useRef(null);
  useEffect(() => { if (reportOpen) reportRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [reportOpen]);
  const preparing = job.candidateBuild?.status === 'preparing' && job.candidateBuild.expiresAt > Date.now();
  const running = !!job.lease || ['queued', 'running'].includes(job.status);
  const accepted = job.trial?.result === 'accepted' && job.trial.digest === job.candidate?.digest;
  const canTest = !!job.report && job.kind === 'pull_request' && !running;
  const next = accepted ? 'Bạn đã chấp nhận bản thay đổi này. Kết quả được lưu trong hồ sơ.' : preparing ? 'Hệ thống đang chuẩn bị bản riêng. Khi xong, bấm Test thử để mở ứng dụng.' : job.gates?.canPreview ? 'Bấm Test thử, làm theo hướng dẫn rồi quay lại Chấp nhận nếu đã đúng yêu cầu.' : job.report ? job.kind === 'pull_request' ? 'Đọc báo cáo rồi bấm Test thử để chuẩn bị bản riêng của ứng dụng.' : 'Đọc báo cáo và gửi phản hồi. Cần có bản thay đổi từ người đóng góp trước khi test thử.' : 'Bấm Kiểm tra. Hệ thống sẽ đọc đóng góp và viết báo cáo cho bạn.';
  return <section className="review-simple"><div className="review-simple-title"><div><p className="review-eyebrow">ĐÓNG GÓP ĐƯỢC CHỌN</p><h2>{job.title}</h2><p>{job.author?.name || job.author?.email} · Bản {job.revision}</p></div><span className={`admin-badge ${accepted ? 'is-ok' : 'is-wait'}`}>{contributionStatus(job)}</span></div>
    <div className="review-simple-actions"><button disabled={busy || stale || running || preparing || (accepted && !job.relations?.reviewChanged) || ['released', 'cancelled'].includes(job.status)} onClick={onCheck}><Play size={17} />Kiểm tra</button>
      <button disabled={!job.report} aria-expanded={reportOpen} onClick={() => setReportOpen(!reportOpen)}><ClipboardList size={17} />Đọc báo cáo</button>
      <button disabled={busy || stale || !canTest || preparing} onClick={onTest}><FlaskConical size={17} />Test thử</button>
      <button className="review-primary" disabled={busy || stale || accepted || !trialIsOpen(job) || !job.gates?.canPreview || running} onClick={onAccept}><CheckCircle2 size={17} />Chấp nhận</button></div>
    <div className="review-simple-next"><strong>Bước tiếp theo</strong><p>{next}</p></div>
    {job.relations && <div className="review-simple-description"><h3>So với các đóng góp khác</h3>
      <p>{job.relations.related.length ? `${job.relations.related.length} yêu cầu cần xem cùng trước khi chấp nhận.` : `Chưa thấy trùng tiêu đề hoặc khu vực sửa trong ${job.relations.comparedCount} yêu cầu đã đối chiếu.`}</p>
      {job.relations.related.map(item => <details className="admin-check" key={item.id}><summary>{item.number ? `#${item.number} · ` : ''}{item.title} — {item.possibleDuplicate ? 'Có thể trùng mục tiêu' : item.overlapCount ? 'Cùng sửa file' : 'Cùng khu vực'}</summary>
        <p>{item.reasons.join('. ')}.</p>{item.overlap.length > 0 && <ul>{item.overlap.map(file => <li key={file}>{file}</li>)}</ul>}
        <p>Nên chọn một yêu cầu nếu cùng mục tiêu; nếu giữ cả hai, test lại sau khi ghép.</p></details>)}
      <p className="review-hint">{job.relations.limitation} Sau mỗi lần ghép thay đổi, cập nhật bản nền và kiểm tra lại các yêu cầu còn lại.</p>
      {job.relations.reviewChanged && <p role="status">Hàng đợi đã thay đổi sau lần kiểm tra này. Bấm Kiểm tra để đánh giá lại ảnh hưởng với các đóng góp mới.</p>}
      {job.relations.truncated && <p role="alert">Chỉ đối chiếu 200 yêu cầu đầu; cần thu hẹp hàng đợi.</p>}</div>}
    {job.waitReason && <div className="review-banner is-error">Kiểm tra đang tạm dừng. Bấm Kiểm tra để tiếp tục; nếu chưa được, xem Chi tiết nâng cao → Máy & cài đặt.</div>}
    {job.candidateBuild?.error && <div className="review-banner is-error" role="alert">{job.candidateBuild.error}</div>}
    {job.description && <div className="review-simple-description"><h3>Người đóng góp muốn thay đổi gì?</h3><p>{job.description}</p></div>}
    {reportOpen && <article className="review-simple-report" ref={reportRef}><h3>Báo cáo kiểm tra</h3><p>{job.report.summary}</p>
      <p className="review-hint">Báo cáo hỗ trợ bạn đánh giá. Hãy test thử thay đổi trước khi chấp nhận.</p>
      {job.report.findings.length ? <><h4>Điểm cần chú ý</h4>{job.report.findings.map(finding => <div className="admin-check" key={finding.id}><strong>{['high', 'critical'].includes(finding.severity) ? 'Cần xử lý · ' : ''}{finding.title}</strong><p>{finding.detail}</p></div>)}</> : <p>Chưa ghi nhận vấn đề trong báo cáo.</p>}
      {!!job.report.gaps?.length && <><h4>Còn cần xác minh</h4><ul>{job.report.gaps.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      <div className="review-actions"><button disabled={busy || stale || running} onClick={onFeedback}>Yêu cầu chỉnh sửa</button></div></article>}
    {!!job.feedback?.length && <div className="review-simple-description"><h3>Phản hồi đã gửi</h3>{job.feedback.map(item => <p key={item.id}>{item.body}</p>)}</div>}
    <div className="review-simple-footer"><button className="review-icon-button" onClick={onAdvanced}><Settings2 size={15} />Chi tiết nâng cao</button>{running && <button disabled={busy} onClick={onStop}>Dừng kiểm tra</button>}</div>
  </section>;
}
