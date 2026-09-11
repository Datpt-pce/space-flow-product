const { ModelRunner } = require('./models');
const jobs = require('./jobs');
const { comparisonSnapshot } = require('./relations');
const { requireValue, ReviewError } = require('./errors');

class ReviewWorker {
  constructor(service, { runner = new ModelRunner(service.config), now = Date.now } = {}) {
    this.service = service; this.runner = runner; this.now = now; this.timer = null; this.busy = false; this.active = null;
    this.status = { state: 'stopped', lastError: null, lastSyncAt: null };
  }
  async presence(state, error = null) {
    const config = this.service.config.initialize();
    const value = { id: config.machineId, name: config.machineName, platform: `${process.platform}/${process.arch}`,
      status: state, lastSeenAt: this.now(), currentJobId: this.active?.id || null, lastError: error,
      workerVersion: 1, capabilities: ['model-review', ...(config.sandboxImage ? ['docker-candidate'] : [])] };
    await this.service.store().mutate('workers', config.machineId, () => value);
    this.status.state = state; this.status.lastError = error;
  }
  start() {
    if (this.timer) return;
    this.status.state = 'starting';
    this.timer = setInterval(() => this.tick().catch(() => {}), this.service.config.read().pollMs);
    this.timer.unref?.(); this.tick().catch(() => {});
  }
  async stop() {
    if (this.timer) clearInterval(this.timer); this.timer = null; this.active?.controller.abort();
    this.status.state = 'stopped';
    await this.presence('stopped').catch(() => {});
  }
  async tick({ force = false, sync = true } = {}) {
    if (this.busy) return { busy: true };
    this.busy = true;
    try {
      const config = await this.service.effective();
      if (!force && !config.workerEnabled) { this.status.state = 'paused'; return { paused: true }; }
      requireValue(config.ownerEmail && config.machineId, 'WORKER_SETUP', 'Cần cấu hình owner và máy trước khi chạy.');
      await this.presence('idle');
      if (sync && config.storageMode === 'github') {
        await this.service.sync(null, { automatic: true }); this.status.lastSyncAt = this.now();
      }
      const list = (await this.service.store().list('jobs')).sort((a, b) => (a.requestedAt || a.createdAt) - (b.requestedAt || b.createdAt));
      for (const candidate of list) {
        if (!['queued', 'running'].includes(candidate.status)) continue;
        let claimedAttempt = null;
        const job = await this.service.store().mutate('jobs', candidate.id, old => {
          claimedAttempt = null;
          const next = jobs.claim(old, config.machineId, config.leaseMs);
          if (next?.lease && next.status === 'running') claimedAttempt = next.lease.attemptId;
          return next;
        });
        if (!claimedAttempt || job?.lease?.attemptId !== claimedAttempt) continue;
        await this.execute(job, config); return { processed: job.id };
      }
      return { idle: true };
    } catch (error) {
      this.status.lastError = { code: error.code || 'WORKER_FAILED', message: error instanceof ReviewError ? error.message : 'Worker cần kiểm tra kết nối hoặc cấu hình.' };
      this.status.state = 'waiting';
      await this.presence('waiting', this.status.lastError).catch(() => {});
      return { waiting: true, error: this.status.lastError };
    } finally { this.busy = false; }
  }
  async execute(initial, config) {
    const store = this.service.store(); const attemptId = initial.lease.attemptId;
    const controller = new AbortController(); this.active = { id: initial.id, attemptId, controller };
    let heartbeatBusy = false; let leaseError; let runningRole;
    const pulse = async () => {
      if (heartbeatBusy) return; heartbeatBusy = true;
      try {
        await store.mutate('jobs', initial.id, job => jobs.heartbeat(job, attemptId, config.leaseMs));
        await this.presence('running');
      } catch (error) { leaseError = error; controller.abort(); }
      finally { heartbeatBusy = false; }
    };
    const timer = setInterval(pulse, Math.min(45000, Math.floor(config.leaseMs / 3)));
    try {
      await this.presence('running');
      if (!initial.comparisonSnapshot) {
        const snapshot = comparisonSnapshot(initial, await store.list('jobs'));
        await store.mutate('jobs', initial.id, job => {
          jobs.assertLease(job, attemptId); job.comparisonSnapshot = snapshot; return job;
        });
      }
      for (const task of initial.tasks) {
        if (task.status === 'completed') continue;
        requireValue(!controller.signal.aborted, 'STALE_ATTEMPT', 'Worker đã mất quyền xử lý.');
        let current = await store.mutate('jobs', initial.id, job => {
          jobs.assertLease(job, attemptId);
          job.reviewStartedAt ||= this.now();
          requireValue(job.usage.calls < job.policy.maxCalls && job.usage.inputTokens + job.usage.outputTokens < job.policy.maxJobTokens &&
            this.now() - job.reviewStartedAt < job.policy.maxJobMs, 'REVIEW_BUDGET', 'Đã tới giới hạn lượt/token/thời gian của hồ sơ.');
          const active = job.tasks.find(item => item.role === task.role);
          requireValue(active.status === 'queued', 'TASK_STATE', 'Vai trò đã được máy khác xử lý.');
          active.status = 'running'; active.startedAt = this.now(); job.usage.calls++;
          return jobs.event(job, 'task.started', config.machineId, { role: task.role, selection: active.selection });
        });
        runningRole = task.role;
        const result = await this.runner.run(current, current.tasks.find(item => item.role === task.role), controller.signal);
        requireValue(!leaseError, 'STALE_ATTEMPT', 'Mất lease trong lúc model chạy.');
        current = await store.mutate('jobs', initial.id, job => jobs.recordResult(job, attemptId, task.role, result));
        runningRole = null;
      }
      await store.mutate('jobs', initial.id, job => jobs.finishReview(job, attemptId));
    } catch (error) {
      await store.mutate('jobs', initial.id, job => {
        if (job?.lease?.attemptId !== attemptId || job.status !== 'running') return undefined;
        const active = job.tasks.find(item => item.role === runningRole);
        if (active?.status === 'running') {
          active.status = ['MODEL_TIMEOUT', 'PROCESS_TIMEOUT', 'CANCELLED', 'STALE_ATTEMPT', 'MODEL_CLOSED'].includes(error.code) ? 'unknown' : 'failed';
          active.error = error instanceof ReviewError ? error.message : 'Lời gọi model thất bại; xem cấu hình và quota.';
        }
        job.status = 'waiting'; job.waitReason = leaseError ? 'LEASE_LOST' : error.code || 'MODEL_FAILED'; job.lease = null;
        return jobs.event(job, 'review.waiting', config.machineId, { code: job.waitReason, role: runningRole });
      }).catch(() => {});
      throw error;
    } finally {
      clearInterval(timer); this.active = null;
      if (!this.status.lastError) await this.presence(this.timer ? 'idle' : 'stopped').catch(() => {});
    }
  }
}
module.exports = { ReviewWorker };
