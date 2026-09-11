const crypto = require('crypto');
const { SqliteRecordStore, GitHubRecordStore, clone } = require('./records');
const { GitHubClient } = require('./github');
const { ReviewConfig } = require('./config');
const policy = require('./policy');
const jobs = require('./jobs');
const { requireValue, fail } = require('./errors');
const { relationContext } = require('./relations');

function summary(job) {
  return { id: job.id, kind: job.kind, title: job.title, author: job.author, revision: job.revision, status: job.status,
    source: job.source ? { repository: job.source.repository, number: job.source.number, url: job.source.url, headSha: job.source.headSha } : null,
    updatedAt: job.updatedAt, createdAt: job.createdAt, waitReason: job.waitReason || null,
    tasks: job.tasks.map(({ id, label, status }) => ({ id, label, status })),
    findingCount: job.report?.findings.length || 0, hasReport: !!job.report, hasCandidate: !!job.candidate,
    releaseStatus: job.release?.status || null };
}
class ContributionService {
  constructor({ db, config = new ReviewConfig(), github = new GitHubClient(), localStore } = {}) {
    this.config = config; this.github = github;
    this.local = localStore || new SqliteRecordStore(db);
    this.remote = null; this.snapshot = null;
  }
  owner(user) { return policy.ownerMatches(user, this.config.read().ownerEmail); }
  requireOwner(user) { policy.requireOwner(user, this.config.read().ownerEmail); }
  store() {
    const config = this.config.read();
    if (config.storageMode === 'local') return this.local;
    if (!this.remote || this.remote.repository !== config.controlRepo) this.remote = new GitHubRecordStore(this.github, config.controlRepo);
    return this.remote;
  }
  async effective() {
    const local = this.config.initialize();
    if (local.storageMode === 'local') return local;
    const shared = await this.store().get('settings', 'global');
    requireValue(shared && shared.ownerEmail?.toLowerCase() === local.ownerEmail?.toLowerCase(), 'CONTROL_OWNER',
      'Cấu hình owner trên máy chưa khớp kho control.');
    return { ...local, sourceRepo: shared.sourceRepo, policy: policy.validatePolicy(shared.policy), contributorBindings: shared.contributorBindings || {} };
  }
  async state(user) {
    const owner = this.owner(user);
    const config = this.config.read();
    let list; let workers = []; let stale = false; let syncError = null; let effectiveConfig;
    try {
      list = await this.store().list('jobs');
      if (owner) { workers = await this.store().list('workers'); effectiveConfig = await this.effective(); }
      this.snapshot = { jobs: list, workers, effectiveConfig, at: Date.now() };
    } catch (error) {
      if (!owner || !this.snapshot) throw error;
      list = this.snapshot.jobs; workers = this.snapshot.workers; effectiveConfig = this.snapshot.effectiveConfig; stale = true;
      syncError = { code: error.code || 'SYNC_FAILED', message: 'Mất kết nối nguồn trạng thái. Dữ liệu cũ chỉ để xem; thao tác cần đồng bộ lại.' };
    }
    list = list.filter(job => policy.canRead(job, user, config.ownerEmail));
    return { isOwner: owner, ownerConfigured: !!config.ownerEmail, mode: config.storageMode, stale, syncError,
      syncedAt: this.snapshot?.at || null, jobs: list.map(job => owner ? summary(job) : summary({ ...job, tasks: [], report: null, candidate: null })),
      ...(owner ? { config: { ...this.config.public(), ...(effectiveConfig ? { sourceRepo: effectiveConfig.sourceRepo, policy: effectiveConfig.policy, contributorBindings: effectiveConfig.contributorBindings } : {}) }, workers: workers.map(worker => ({ ...worker,
        online: worker.status !== 'stopped' && Date.now() - worker.lastSeenAt < 150000 })) } : {}) };
  }
  async detail(user, id) {
    const job = await this.store().get('jobs', id);
    requireValue(job, 'NOT_FOUND', 'Không tìm thấy đề xuất.', 404);
    const result = policy.publicJob(job, user, this.config.read().ownerEmail);
    if (this.owner(user)) {
      const current = await this.effective();
      const gates = jobs.gates(job);
      if (job.policy && job.policy.version !== current.policy.version) {
        gates.canApply = false; gates.canPreview = false;
        gates.applyReasons.push('Model policy đã đổi. Cần đánh giá lại.'); gates.previewReasons.push('Model policy đã đổi. Cần đánh giá lại.');
      }
      return { ...result, gates, relations: relationContext(job, await this.store().list('jobs')) };
    }
    return result;
  }
  async updateSettings(user, input) {
    this.requireOwner(user);
    const prior = this.config.initialize();
    this.config.prepare(input);
    const currentStore = this.store();
    const records = await currentStore.list('jobs');
    requireValue(!records.some(job => job.lease || ['deploying', 'recovering', 'unknown'].includes(job.release?.status)),
      'CONFIG_BUSY', 'Dừng hoặc đối soát các việc đang chạy trước khi đổi cấu hình.');
    if (input.storageMode && input.storageMode !== prior.storageMode)
      requireValue(records.length === 0, 'STORE_MIGRATION_REQUIRED', 'Nguồn hiện tại có hồ sơ. Dùng thao tác kết nối và chuyển hồ sơ để đổi nguồn.');
    if (input.storageMode === 'github' || prior.storageMode === 'github') {
      const repo = input.controlRepo || prior.controlRepo;
      const remote = new GitHubRecordStore(this.github, repo); await remote.assertPrivate();
      const old = await remote.get('settings', 'global');
      requireValue(old?.ownerEmail?.toLowerCase() === prior.ownerEmail.toLowerCase(), 'CONTROL_OWNER', 'Kho control chưa được khởi tạo cho owner này.');
      await remote.mutate('settings', 'global', value => ({ ...value,
        sourceRepo: input.sourceRepo || value.sourceRepo, policy: input.policy ? policy.validatePolicy({ ...input.policy, version: value.policy.version + 1 }) : value.policy,
        contributorBindings: input.contributorBindings || value.contributorBindings, updatedAt: Date.now() }));
    }
    this.config.update(input); this.snapshot = null;
    return this.config.public();
  }
  async connect(user) {
    this.requireOwner(user);
    const config = this.config.initialize();
    const source = await this.github.repository(config.sourceRepo, true);
    requireValue(source.private, 'SOURCE_PRIVATE', 'Repo contributor phải Private trước khi kết nối theo phương án hiện tại.', 403);
    requireValue(source.permissions?.push, 'SOURCE_ACCESS', 'Tài khoản GitHub trên máy chưa có quyền ghi repo contributor.', 403);
    await this.github.createControl(config.controlRepo);
    const remote = new GitHubRecordStore(this.github, config.controlRepo);
    await remote.assertPrivate();
    await remote.mutate('settings', 'global', old => {
      if (old) {
        requireValue(old.ownerEmail?.toLowerCase() === config.ownerEmail.toLowerCase() && old.sourceRepo === config.sourceRepo,
          'CONTROL_OWNER', 'Kho control đã thuộc owner hoặc source khác.');
        return undefined;
      }
      return { ownerEmail: config.ownerEmail, sourceRepo: config.sourceRepo, policy: config.policy,
        contributorBindings: config.contributorBindings, createdAt: Date.now(), updatedAt: Date.now() };
    });
    if (config.storageMode === 'local') {
      for (const kind of ['jobs', 'baselines', 'targets']) for (const record of await this.local.list(kind)) {
        requireValue(!record.lease && !['deploying', 'unknown'].includes(record.release?.status), 'MIGRATION_BUSY', 'Không chuyển hồ sơ đang có attempt chưa đối soát.');
        await remote.mutate(kind, record.id, old => {
          requireValue(!old || JSON.stringify(old) === JSON.stringify(record), 'MIGRATION_CONFLICT', 'Kho control đã có một hồ sơ khác cùng ID.');
          return old ? undefined : record;
        });
      }
    }
    // The authority flips only after every copy/readback has succeeded. Local copies are
    // retained for recovery but are never selected automatically during a GitHub outage.
    this.config.update({ storageMode: 'github' }); this.remote = remote; this.snapshot = null;
    return { connected: true, sourceRepo: config.sourceRepo, controlRepo: config.controlRepo, mode: 'github' };
  }
  async createIdea(user, input) {
    requireValue(user?.id && user.status !== 'pending' && user.status !== 'rejected', 'ACCESS_DENIED', 'Tài khoản chưa được cấp quyền.', 403);
    const job = jobs.createJob({ kind: input.kind === 'package' ? 'package' : 'idea', title: input.title, description: input.description || '',
      author: { userId: user.id, email: user.email, name: user.name || user.email } });
    await this.store().mutate('jobs', job.id, old => { requireValue(!old, 'ID_COLLISION', 'Định danh bị trùng.'); return job; });
    return policy.publicJob(job, user, this.config.read().ownerEmail);
  }
  async importPull(number, actor = 'github-sync') {
    const config = await this.effective();
    const { pr, files, patch } = await this.github.pull(config.sourceRepo, number);
    requireValue(pr.base?.repo?.full_name?.toLowerCase() === config.sourceRepo.toLowerCase(), 'PR_REPOSITORY', 'PR không thuộc repo contributor được cấu hình.');
    const id = `pr-${policy.hash(`${config.sourceRepo.toLowerCase()}#${number}`).slice(0, 32)}`;
    const source = { repository: config.sourceRepo, number, url: `https://github.com/${config.sourceRepo}/pull/${number}`,
      headSha: pr.head.sha, baseSha: pr.base.sha, baseBranch: pr.base.ref, patch,
      files: files.map(({ filename, previous_filename, status, additions, deletions }) => ({ filename, ...(previous_filename ? { previousFilename: previous_filename } : {}), status, additions, deletions })) };
    return this.store().mutate('jobs', id, old => {
      const author = { githubLogin: pr.user.login, name: pr.user.login,
        ...(config.contributorBindings[pr.user.login] ? { email: config.contributorBindings[pr.user.login] } : {}) };
      const job = old ? jobs.replaceRevision(old, { title: pr.title, description: pr.body || '', source }, actor) :
        jobs.createJob({ id, kind: 'pull_request', title: pr.title, description: pr.body || '', source, author });
      job.author = author; job.sourceUpdatedAt = pr.updated_at; job.draft = !!pr.draft; job.sourceState = pr.state;
      return job;
    });
  }
  async sync(user, { automatic = false } = {}) {
    if (!automatic) this.requireOwner(user);
    const config = await this.effective();
    const pulls = await this.github.pulls(config.sourceRepo);
    const imported = []; const failures = [];
    const openNumbers = new Set(pulls.map(pr => pr.number));
    // An open-only GitHub listing cannot itself close our cached records.
    for (const old of await this.store().list('jobs')) {
      if (old.kind !== 'pull_request' || old.source?.repository !== config.sourceRepo || old.sourceState !== 'open' || openNumbers.has(old.source.number)) continue;
      try { imported.push(summary(await this.importPull(old.source.number, 'github-sync'))); }
      catch (error) { failures.push({ number: old.source.number, code: error.code || 'SYNC_FAILED' }); }
    }
    for (const pr of pulls) {
      try {
        const id = `pr-${policy.hash(`${config.sourceRepo.toLowerCase()}#${pr.number}`).slice(0, 32)}`;
        let job = await this.store().get('jobs', id);
        if (!job || job.sourceUpdatedAt !== pr.updated_at) job = await this.importPull(pr.number, 'github-sync');
        if (automatic && config.workerEnabled && !job.draft && job.status === 'submitted')
          job = await this.store().mutate('jobs', id, old => jobs.queue(old, job.revision, 'github-sync', config.policy));
        imported.push(summary(job));
      } catch (error) { failures.push({ number: pr.number, code: error.code || 'SYNC_FAILED' }); }
    }
    return { imported, failures, syncedAt: Date.now() };
  }
  async review(user, id, revision) {
    this.requireOwner(user);
    const config = await this.effective();
    const job = await this.store().get('jobs', id); jobs.assertRevision(job, revision);
    if (job.kind === 'pull_request') {
      const fresh = await this.importPull(job.source.number, user.id);
      jobs.assertRevision(fresh, revision);
      requireValue(!fresh.draft && fresh.sourceState === 'open', 'PR_NOT_READY', 'PR cần mở và sẵn sàng review.');
    }
    return this.store().mutate('jobs', id, old => jobs.queue(old, revision, user.id, config.policy));
  }
  async cancel(user, id, revision) {
    this.requireOwner(user);
    return this.store().mutate('jobs', id, job => {
      jobs.assertRevision(job, revision);
      requireValue(!['deploying', 'recovering', 'unknown'].includes(job.release?.status), 'RELEASE_IN_FLIGHT', 'Không hủy khi phát hành chưa đối soát.');
      job.status = 'cancelled'; job.lease = null; job.approval = null;
      for (const task of job.tasks) if (['queued', 'running'].includes(task.status)) task.status = 'cancelled';
      return jobs.event(job, 'review.cancelled', user.id);
    });
  }
  async feedback(user, id, revision, body, publish = false) {
    this.requireOwner(user); body = jobs.text(body, 8000, 'Phản hồi');
    const feedbackId = crypto.randomUUID();
    let job = await this.store().mutate('jobs', id, value => {
      jobs.assertRevision(value, revision);
      requireValue(!publish || value.kind === 'pull_request', 'FEEDBACK_DESTINATION', 'Đề xuất này chưa có PR nhận phản hồi.');
      requireValue(!value.lease && !['deploying', 'unknown'].includes(value.release?.status), 'JOB_BUSY', 'Dừng hoặc đối soát việc đang chạy trước khi yêu cầu sửa.');
      value.status = 'changes_requested'; value.approval = null;
      value.feedback.push({ id: feedbackId, body, createdAt: Date.now(), delivery: publish ? 'pending' : 'in_app' });
      return jobs.event(value, 'feedback.created', user.id, { feedbackId, publish });
    });
    if (!publish) return job;
    requireValue(job.kind === 'pull_request', 'FEEDBACK_DESTINATION', 'Đề xuất này chưa có PR nhận phản hồi.');
    let receipt; let delivery = 'sent';
    try { receipt = await this.github.comment(job.source.repository, job.source.number, `${body}\n\n<!-- sf-feedback:${feedbackId} -->`); }
    catch (error) { delivery = ['GITHUB_OFFLINE', 'GITHUB_FAILED'].includes(error.code) ? 'unknown' : 'failed'; }
    job = await this.store().mutate('jobs', id, value => {
      const feedback = value.feedback.find(item => item.id === feedbackId);
      feedback.delivery = delivery; if (receipt) feedback.remoteId = receipt.id;
      return jobs.event(value, 'feedback.delivery', user.id, { feedbackId, delivery });
    });
    return job;
  }
  async resume(user, id, revision) {
    this.requireOwner(user);
    return this.store().mutate('jobs', id, job => {
      jobs.assertRevision(job, revision);
      requireValue(job.status === 'waiting' && !job.lease, 'NOT_WAITING', 'Đề xuất không ở trạng thái có thể tiếp tục.');
      for (const task of job.tasks) if (['unknown', 'failed'].includes(task.status)) { task.status = 'queued'; task.error = null; }
      job.status = 'queued'; job.waitReason = null; job.reviewStartedAt = null;
      return jobs.event(job, 'review.resumed', user.id, { explicitRetry: true });
    });
  }
  async releaseFeedback(id) {
    const store = this.store(); const attemptId = crypto.randomUUID();
    let reserved = false;
    const job = await store.mutate('jobs', id, value => {
      reserved = false;
      if (value?.release?.status !== 'released') return undefined;
      const feedbackId = `release-${value.release.id}`;
      if (value.feedback.some(item => item.id === feedbackId)) return undefined;
      const body = `Đề xuất revision ${value.revision} đã được áp dụng và kiểm tra thành công tại target ${value.release.targetId}. Candidate: ${value.release.digest}.`;
      value.feedback.push({ id: feedbackId, body, createdAt: Date.now(), delivery: value.kind === 'pull_request' ? 'sending' : 'in_app', attemptId });
      reserved = true; return jobs.event(value, 'release.feedback_prepared', 'release-controller', { feedbackId });
    });
    const feedback = job?.feedback.find(item => item.attemptId === attemptId);
    if (!reserved || !feedback || feedback.delivery !== 'sending') return;
    let receipt; let delivery = 'sent';
    try { receipt = await this.github.comment(job.source.repository, job.source.number, `${feedback.body}\n\n<!-- sf-feedback:${feedback.id} -->`); }
    catch (error) { delivery = ['GITHUB_OFFLINE', 'GITHUB_FAILED'].includes(error.code) ? 'unknown' : 'failed'; }
    await store.mutate('jobs', id, value => {
      const item = value.feedback.find(entry => entry.attemptId === attemptId); if (!item) return undefined;
      item.delivery = delivery; if (receipt) item.remoteId = receipt.id;
      return jobs.event(value, 'release.feedback_delivery', 'release-controller', { feedbackId: item.id, delivery });
    });
  }
}
module.exports = { ContributionService, summary };
