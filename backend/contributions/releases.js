const crypto = require('crypto');
const jobs = require('./jobs');
const { requireValue, ReviewError } = require('./errors');
const { validateTarget, targetFingerprint, createAdapter } = require('./release-adapters');

class ReleaseService {
  constructor(service, candidates, { adapterFactory = createAdapter } = {}) {
    this.service = service; this.candidates = candidates; this.adapterFactory = adapterFactory; this.active = new Map();
  }
  target(id) {
    const config = this.service.config.read(); const target = config.releaseTargets.find(value => value.id === id);
    validateTarget(target);
    requireValue(!target.machineId || target.machineId === config.machineId, 'TARGET_OTHER_MACHINE', 'Target thuộc máy khác. Mở console ở máy có target.');
    return target;
  }
  async approve(user, id, input) {
    const job = await this.candidates.fresh(user, id, input.revision); const config = await this.service.effective(); const target = this.target(input.targetId);
    requireValue(!['released', 'cancelled', 'rejected'].includes(job.status), 'APPROVAL_STATE', 'Hồ sơ đã kết thúc.');
    requireValue(job.policy?.version === config.policy.version && jobs.gates(job, target).canApply, 'APPROVAL_GATES', 'Gate trước phát hành chưa đạt hoặc không đúng nền tảng target.');
    requireValue(input.digest === job.candidate?.digest, 'ARTIFACT_CHANGED', 'Candidate đã đổi.'); await this.candidates.verify(job);
    const notes = jobs.text(input.notes, 8000, 'Ghi chú duyệt'); const fingerprint = targetFingerprint(target);
    return this.service.store().mutate('jobs', id, value => {
      jobs.assertRevision(value, input.revision);
      requireValue(value.candidate?.digest === input.digest && jobs.gates(value, target).canApply, 'APPROVAL_GATES', 'Hồ sơ đã đổi trước khi duyệt.');
      value.approval = { id: crypto.randomUUID(), digest: input.digest, revision: value.revision, fingerprint: value.fingerprint, sourceHead: value.source?.headSha,
        targetId: target.id, targetFingerprint: fingerprint, policyVersion: config.policy.version, ownerId: user.id, notes, at: Date.now(), expiresAt: Date.now() + 60 * 60000 };
      return jobs.event(value, 'release.approved', user.id, { digest: input.digest, targetId: target.id, approvalId: value.approval.id });
    });
  }
  context(job, target) {
    return { operationId: job.release.id, targetId: target.id, digest: job.release.digest, revision: job.release.revision,
      artifactDirectory: this.candidates.directory(job.candidate), candidate: { id: job.candidate.id, imageId: job.candidate.imageId, platform: job.candidate.platform },
      backup: job.release.backup || null };
  }
  async apply(user, id, input) {
    this.service.requireOwner(user);
    const prior = await this.service.store().get('jobs', id); jobs.assertRevision(prior, input.revision);
    if (prior.release?.id === prior.approval?.id && prior.release?.targetId === input.targetId) return prior.release;
    const job = await this.candidates.fresh(user, id, input.revision); const target = this.target(input.targetId); const config = await this.service.effective();
    requireValue(job.approval && job.approval.digest === input.digest && job.approval.targetId === target.id && job.approval.expiresAt > Date.now() &&
      job.approval.targetFingerprint === targetFingerprint(target) && job.approval.policyVersion === config.policy.version && job.approval.fingerprint === job.fingerprint,
    'APPROVAL_EXPIRED', 'Duyệt đã hết hạn, policy/target/revision đổi hoặc không khớp candidate.');
    requireValue(jobs.gates(job, target).canApply, 'RELEASE_GATES', 'Các gate phát hành chưa đạt.'); await this.candidates.verify(job);
    const store = this.service.store(); const operationId = job.approval.id;
    await store.mutate('targets', target.id, value => {
      requireValue(!value?.lock, 'TARGET_BUSY', 'Target đang có phát hành cần hoàn tất hoặc đối soát.');
      return { ...(value || { id: target.id, history: [] }), lock: { operationId, jobId: id, machineId: config.machineId, startedAt: Date.now() }, updatedAt: Date.now() };
    });
    let reserved;
    try {
      reserved = await store.mutate('jobs', id, value => {
        jobs.assertRevision(value, input.revision);
        requireValue(value.approval?.id === operationId && !['deploying', 'recovering', 'unknown'].includes(value.release?.status), 'RELEASE_BUSY', 'Lần phát hành đã được xử lý.');
        value.release = { id: operationId, approvalId: operationId, digest: input.digest, revision: value.revision, targetId: target.id, targetFingerprint: targetFingerprint(target),
          status: 'deploying', phase: 'reserved', machineId: config.machineId, startedAt: Date.now(), backup: null };
        return jobs.event(value, 'release.started', user.id, { operationId, targetId: target.id, digest: input.digest });
      });
    } catch (error) {
      await store.mutate('targets', target.id, value => value?.lock?.operationId === operationId ? { ...value, lock: null } : undefined).catch(() => {}); throw error;
    }
    const promise = this.execute(reserved, target, user.id, store).catch(() => {}).finally(() => this.active.delete(operationId));
    this.active.set(operationId, promise); return reserved.release;
  }
  async checkpoint(store, id, operationId, fields, actor, type) {
    return store.mutate('jobs', id, value => {
      requireValue(value?.release?.id === operationId, 'STALE_RELEASE', 'Lần phát hành đã đổi.'); Object.assign(value.release, fields);
      return jobs.event(value, type, actor, { operationId, phase: value.release.phase });
    });
  }
  async complete(store, job, proof, actor) {
    const operationId = job.release.id;
    const complete = await this.checkpoint(store, job.id, operationId, { status: 'released', phase: 'verified', proof, completedAt: Date.now() }, actor, 'release.verified');
    await store.mutate('jobs', job.id, value => { requireValue(value.release?.id === operationId, 'STALE_RELEASE', 'Lần phát hành đã đổi.'); value.status = 'released'; return value; });
    await store.mutate('targets', job.release.targetId, value => {
      requireValue(value?.lock?.operationId === operationId, 'STALE_RELEASE', 'Khóa target đã đổi.');
      const history = [...(value.history || []), ...(value.current ? [value.current] : [])].slice(-30);
      return { ...value, lock: null, current: { jobId: job.id, revision: job.release.revision, operationId, digest: job.release.digest, backup: complete.release.backup }, history, updatedAt: Date.now() };
    });
    // Delivery failure does not turn a verified deployment back into an unknown
    // deployment. Its separate durable receipt prevents duplicate notifications.
    await this.service.releaseFeedback?.(job.id).catch(() => {});
    return complete.release;
  }
  verified(proof, job) {
    return proof?.operationId === job.release.id && proof.digest === job.release.digest && proof.health === true && proof.smoke === true &&
      (!proof.imageId || proof.imageId === job.candidate.imageId);
  }
  async execute(initial, target, actor, store) {
    let job = initial; const operationId = job.release.id; const adapter = this.adapterFactory(this.service.config.read(), target);
    try {
      job = await this.checkpoint(store, job.id, operationId, { phase: 'backup_started' }, actor, 'release.backup_started');
      const backup = await adapter.backup(this.context(job, target));
      requireValue(backup?.operationId === operationId && backup.recoveryReady === true && backup.snapshotId, 'RECOVERY_MISSING', 'Chưa có snapshot có thể phục hồi.');
      job = await this.checkpoint(store, job.id, operationId, { backup, phase: 'backup_ready' }, actor, 'release.backup_ready');
      job = await this.checkpoint(store, job.id, operationId, { phase: 'activation_started' }, actor, 'release.activation_started');
      await adapter.activate(this.context(job, target));
      job = await this.checkpoint(store, job.id, operationId, { phase: 'verification' }, actor, 'release.verification');
      const proof = await adapter.inspect(this.context(job, target));
      requireValue(this.verified(proof, job), 'RELEASE_VERIFICATION', 'Target chưa xác minh đúng candidate, health hoặc smoke.');
      await this.complete(store, job, proof, actor);
    } catch (error) {
      await this.checkpoint(store, job.id, operationId, { status: 'unknown', message: error instanceof ReviewError ? error.message : 'Kết quả phát hành chưa xác định. Cần đối soát hoặc khôi phục.',
        errorCode: error.code || 'RELEASE_FAILED' }, actor, 'release.unknown').catch(() => {});
      // The durable target lock remains. Neither a retry nor another machine may
      // repeat an activation after an uncertain external outcome.
      throw error;
    }
  }
  async reconcile(user, id, input) {
    this.service.requireOwner(user); const store = this.service.store(); const job = await store.get('jobs', id); jobs.assertRevision(job, input.revision);
    requireValue(job.release && !this.active.has(job.release.id), 'RELEASE_RUNNING', 'Lần phát hành đang chạy trên máy này.');
    const target = this.target(input.targetId); requireValue(target.id === job.release.targetId && targetFingerprint(target) === job.release.targetFingerprint,
      'TARGET_CHANGED', 'Target không còn khớp lần phát hành.');
    const adapter = this.adapterFactory(this.service.config.read(), target); const proof = await adapter.inspect(this.context(job, target));
    if (this.verified(proof, job)) {
      const targetRecord = await store.get('targets', target.id);
      if (!targetRecord?.lock && targetRecord?.current?.operationId === job.release.id) return job.release;
      return this.complete(store, job, proof, user.id);
    }
    return this.checkpoint(store, id, job.release.id, { status: 'unknown', lastInspection: proof, inspectedAt: Date.now(),
      message: 'Target chưa chứng minh đã áp dụng đúng candidate. Giữ khóa; cần kiểm tra hoặc khôi phục.' }, user.id, 'release.reconciled');
  }
  async rollback(user, id, input) {
    this.service.requireOwner(user); const store = this.service.store(); let job = await store.get('jobs', id); jobs.assertRevision(job, input.revision);
    requireValue(job.release && !this.active.has(job.release.id), 'RELEASE_RUNNING', 'Lần phát hành đang chạy hoặc chưa có bản để khôi phục.');
    if (job.release.status === 'rolled_back') return job.release;
    const target = this.target(input.targetId); const operationId = job.release.id;
    requireValue(target.id === job.release.targetId && targetFingerprint(target) === job.release.targetFingerprint, 'TARGET_CHANGED', 'Target không còn khớp.');
    jobs.text(input.notes, 8000, 'Lý do khôi phục');
    await store.mutate('targets', target.id, value => {
      requireValue((!value?.lock && value?.current?.operationId === operationId) || value?.lock?.operationId === operationId, 'RECOVERY_CONFLICT', 'Target có phát hành khác; không tự khôi phục đè lên.');
      return { ...value, lock: { operationId, jobId: id, recovery: true, startedAt: Date.now() } };
    });
    job = await this.checkpoint(store, id, operationId, { status: 'recovering', recoveryNotes: input.notes }, user.id, 'release.recovery_started');
    const adapter = this.adapterFactory(this.service.config.read(), target);
    const operation = (async () => {
      try {
        const receipt = await adapter.restore(this.context(job, target));
        requireValue(receipt?.operationId === operationId && receipt.recovered === true, 'RECOVERY_UNVERIFIED', 'Chưa có bằng chứng phục hồi.');
        const result = await this.checkpoint(store, id, operationId, { status: 'rolled_back', recoveryReceipt: receipt, recoveredAt: Date.now() }, user.id, 'release.recovered');
        await store.mutate('jobs', id, value => { value.status = 'reviewed'; value.approval = null; value.trial = null; return value; });
        await store.mutate('targets', target.id, value => {
          requireValue(value?.lock?.operationId === operationId, 'RECOVERY_CONFLICT', 'Khóa target đã đổi.');
          return { ...value, lock: null, current: (value.history || []).at(-1) || null, history: (value.history || []).slice(0, -1), updatedAt: Date.now() };
        }); return result.release;
      } catch (error) {
        await this.checkpoint(store, id, operationId, { status: 'unknown', message: 'Chưa xác minh phục hồi. Giữ khóa target để đối soát.' }, user.id, 'release.recovery_unknown').catch(() => {});
        throw error;
      }
    })();
    this.active.set(operationId, operation);
    try { return await operation; } finally { this.active.delete(operationId); }
  }
}
module.exports = { ReleaseService };
