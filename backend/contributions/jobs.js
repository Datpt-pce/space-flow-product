const crypto = require('crypto');
const { requireValue } = require('./errors');
const { hash, taskPlan } = require('./policy');
const { clone } = require('./records');

const TERMINAL = new Set(['released', 'rejected', 'cancelled']);
function text(value, max, name, optional = false) {
  requireValue(typeof value === 'string' && value.length <= max && (optional || value.trim()), 'INVALID_INPUT', `${name} không hợp lệ.`, 400);
  return value.trim();
}
function event(job, type, actor, detail = {}) {
  requireValue(job.events.length < 600, 'AUDIT_CAPACITY', 'Hồ sơ đã đầy nhật ký. Cần lưu trữ trước khi tiếp tục.', 409);
  job.updatedAt = Date.now();
  job.events.push({ id: crypto.randomUUID(), type, actor, at: job.updatedAt, detail });
  return job;
}
function createJob({ id = crypto.randomUUID(), kind = 'idea', title, description = '', author, source = null }) {
  requireValue(['idea', 'pull_request', 'package'].includes(kind), 'INVALID_KIND', 'Loại đề xuất không hợp lệ.', 400);
  const now = Date.now();
  const job = { id, kind, title: text(title, 200, 'Tiêu đề'), description: text(description, 12000, 'Mô tả', true),
    author, source, revision: 1, fingerprint: hash({ source, title, description }), status: 'submitted',
    tasks: [], events: [], history: [], feedback: [], createdAt: now, updatedAt: now,
    candidate: null, candidateBuild: null, checks: [], report: null, trial: null, approval: null, release: null, lease: null,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null } };
  return event(job, 'submitted', author?.userId || author?.githubLogin || 'contributor');
}
function assertRevision(job, revision) {
  requireValue(job, 'NOT_FOUND', 'Không tìm thấy đề xuất.', 404);
  requireValue(Number.isSafeInteger(revision) && revision === job.revision, 'REVISION_CHANGED', 'Đề xuất đã có revision mới. Hãy tải lại trước khi thao tác.');
}
function replaceRevision(job, { title, description, source }, actor) {
  const fingerprint = hash({ source, title, description });
  if (fingerprint === job.fingerprint) return job;
  requireValue(!['deploying', 'recovering', 'unknown'].includes(job.release?.status), 'RELEASE_IN_FLIGHT', 'Cần đối soát lần phát hành đang chạy trước khi đổi revision.');
  job.history.push({ revision: job.revision, fingerprint: job.fingerprint, status: job.status, headSha: job.source?.headSha,
    report: job.report, candidateDigest: job.candidate?.digest, approval: job.approval, release: job.release, at: Date.now() });
  Object.assign(job, { title: text(title, 200, 'Tiêu đề'), description: text(description || '', 12000, 'Mô tả', true), source,
    fingerprint, revision: job.revision + 1, status: 'submitted', tasks: [], candidate: null, checks: [], report: null,
    trial: null, approval: null, release: null, lease: null, candidateBuild: null, comparisonSnapshot: null, requestedAt: null, waitReason: null,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null } });
  return event(job, 'revision.changed', actor, { revision: job.revision });
}
function queue(job, revision, actor, policy) {
  assertRevision(job, revision);
  requireValue(!TERMINAL.has(job.status) && !job.lease && !['deploying', 'unknown'].includes(job.release?.status), 'JOB_BUSY', 'Đề xuất chưa thể nhận một lần đánh giá mới.');
  if (job.status === 'queued') return job;
  job.tasks = taskPlan(job, policy); job.status = 'queued'; job.requestedAt = Date.now(); job.waitReason = null; job.reviewStartedAt = null;
  job.policy = clone(policy); job.report = null; job.approval = null; job.trial = null;
  job.reviewRunId = crypto.randomUUID();
  job.comparisonSnapshot = null;
  job.usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null };
  return event(job, 'review.queued', actor, { policyVersion: policy.version, reviewRunId: job.reviewRunId });
}
function claim(job, workerId, leaseMs, now = Date.now()) {
  if (!job || !['queued', 'running', 'waiting'].includes(job.status)) return undefined;
  if (job.lease && job.lease.until > now) return undefined;
  // A model request lost with its worker may already have consumed quota. It is not retried
  // automatically by another machine. The owner explicitly resumes after inspecting the gap.
  if (job.tasks.some(task => task.status === 'running')) {
    for (const task of job.tasks) if (task.status === 'running') { task.status = 'unknown'; task.error = 'Máy mất lease khi model đang chạy; kết quả và quota chưa xác định.'; }
    job.status = 'waiting'; job.waitReason = 'UNKNOWN_MODEL_OUTCOME'; job.lease = null;
    return event(job, 'review.unknown', workerId);
  }
  if (job.status === 'waiting' && job.waitReason) return undefined;
  job.lease = { workerId, attemptId: crypto.randomUUID(), until: now + leaseMs, startedAt: now };
  job.status = 'running'; return event(job, 'review.claimed', workerId, { attemptId: job.lease.attemptId });
}
function assertLease(job, attemptId, now = Date.now()) {
  requireValue(job?.lease?.attemptId === attemptId && job.lease.until > now && job.status === 'running',
    'STALE_ATTEMPT', 'Attempt đã hết lease hoặc revision đã đổi. Không nhận kết quả cũ.');
}
function heartbeat(job, attemptId, leaseMs, now = Date.now()) {
  assertLease(job, attemptId, now); job.lease.until = now + leaseMs; job.updatedAt = now; return job;
}
function recordResult(job, attemptId, role, result) {
  assertLease(job, attemptId);
  const task = job.tasks.find(t => t.role === role);
  requireValue(task?.status === 'running', 'TASK_STATE', 'Vai trò không ở trạng thái đang chạy.');
  task.status = 'completed'; task.result = result; task.completedAt = Date.now();
  job.usage.inputTokens += result.usage?.inputTokens || 0;
  job.usage.outputTokens += result.usage?.outputTokens || 0;
  if (Number.isFinite(result.usage?.costUsd)) job.usage.costUsd = (job.usage.costUsd || 0) + result.usage.costUsd;
  return event(job, 'task.completed', job.lease.workerId, { role, model: result.actualModel || null, modelVerified: result.modelVerified });
}
function finishReview(job, attemptId) {
  assertLease(job, attemptId);
  requireValue(job.tasks.every(task => task.status === 'completed'), 'TASKS_INCOMPLETE', 'Nhóm đánh giá chưa hoàn tất.');
  const reports = job.tasks.map(task => task.result?.report).filter(Boolean);
  const findings = []; const keys = new Set();
  for (const [index, report] of reports.entries()) for (const finding of report.findings || []) {
    const key = hash([finding.file, finding.line, finding.title]);
    if (!keys.has(key)) { keys.add(key); findings.push({ ...finding, id: key.slice(0, 24), role: job.tasks[index].role, evidenceType: 'model_assessment' }); }
  }
  const reporter = job.tasks.find(task => task.role === 'reporter')?.result?.report;
  job.report = { summary: reporter?.summary || reports[0]?.summary || '', findings,
    gaps: [...new Set(reports.flatMap(report => report.gaps || []))],
    suggestedTests: [...new Set(reports.flatMap(report => report.suggestedTests || []))],
    revision: job.revision, fingerprint: job.fingerprint, comparisonFingerprint: job.comparisonSnapshot?.fingerprint || null, completedAt: Date.now(),
    modelVerified: job.tasks.every(task => task.result?.modelVerified) };
  job.status = findings.some(finding => ['high', 'critical'].includes(finding.severity)) ? 'changes_requested' : 'reviewed';
  const workerId = job.lease.workerId; job.lease = null; return event(job, 'review.completed', workerId, { findings: findings.length });
}
function gates(job, target = null, now = Date.now()) {
  const reasons = [];
  if (!job.report || job.report.fingerprint !== job.fingerprint) reasons.push('Chưa có báo cáo cho revision hiện tại.');
  if (!job.report?.modelVerified) reasons.push('Chưa xác minh model thực dùng của mọi vai trò.');
  if (job.report?.findings.some(finding => ['high', 'critical'].includes(finding.severity))) reasons.push('Còn finding nghiêm trọng cần xử lý.');
  if (!job.candidate || job.candidate.fingerprint !== job.fingerprint) reasons.push('Chưa có candidate bất biến cho revision này.');
  for (const name of ['build', 'tests', 'security', 'source']) {
    const check = job.checks.find(item => item.name === name && item.digest === job.candidate?.digest);
    if (check?.status !== 'passed') reasons.push(`Kiểm tra ${name} chưa đạt trên candidate.`);
  }
  const previewReasons = [...reasons];
  if (!job.trial || job.trial.digest !== job.candidate?.digest || job.trial.result !== 'accepted') reasons.push('Owner chưa nghiệm thu bản dùng thử này.');
  if (job.trial?.expiresAt <= now) reasons.push('Phiên dùng thử đã hết hạn.');
  if (target && job.candidate?.platform !== target.platform) reasons.push('Candidate chưa có proof đúng nền tảng target.');
  if (job.lease || ['queued', 'running'].includes(job.status)) reasons.push('Đánh giá còn đang chạy.');
  if (['deploying', 'recovering', 'unknown'].includes(job.release?.status)) reasons.push('Lần phát hành trước cần hoàn tất hoặc đối soát.');
  return { canPreview: previewReasons.length === 0, previewReasons, canApply: reasons.length === 0, applyReasons: reasons };
}
module.exports = { TERMINAL, text, event, createJob, assertRevision, replaceRevision, queue, claim, assertLease, heartbeat, recordResult, finishReview, gates };
