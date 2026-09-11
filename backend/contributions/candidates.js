const path = require('path');
const crypto = require('crypto');
const jobs = require('./jobs');
const { hash } = require('./policy');
const { requireValue, ReviewError } = require('./errors');
const { sourceFiles, allowedChange, allowedChangeNote, scanSecrets, writeFiles, manifestFor } = require('./source');
const { within } = require('./process');
const { DockerSandbox, httpProof } = require('./docker');
const { openGateway } = require('./preview');

function candidateDigest(value) { return hash({ fingerprint: value.fingerprint, revision: value.revision, sourceManifest: value.sourceManifest, distManifest: value.distManifest,
  imageId: value.imageId, platform: value.platform, baselineId: value.baselineId, sourceHead: value.sourceHead }); }
class CandidateService {
  constructor(service, { sandbox = new DockerSandbox(service.config) } = {}) {
    this.service = service; this.sandbox = sandbox; this.builds = new Map(); this.previews = new Map();
  }
  directory(candidate) {
    requireValue(/^candidate-[a-f0-9-]{36}$/.test(candidate.id), 'CANDIDATE_ID', 'Candidate không hợp lệ.');
    return within(this.service.config.read().workspaceRoot, path.join(this.service.config.read().workspaceRoot, 'candidates', candidate.id));
  }
  doctor() { return this.sandbox.doctor(); }
  async setup(user) {
    this.service.requireOwner(user); const source = await sourceFiles(this.service.config.read().sourceRoot);
    this.sandbox.setup(source.files).catch(() => {}); return { status: 'running' };
  }
  async fresh(user, id, revision) {
    this.service.requireOwner(user); let job = await this.service.store().get('jobs', id); jobs.assertRevision(job, revision);
    if (job.kind === 'pull_request') { job = await this.service.importPull(job.source.number, user.id); jobs.assertRevision(job, revision); }
    return job;
  }
  async source(job) {
    const config = await this.service.effective();
    requireValue(job.kind === 'pull_request' && job.sourceState === 'open' && !job.draft, 'CANDIDATE_SOURCE', 'Candidate cần một PR đang mở và sẵn sàng.');
    const baselineFile = await this.service.github.content(config.sourceRepo, 'contributor-baseline.json', job.source.baseSha);
    requireValue(baselineFile?.encoding === 'base64', 'BASELINE_MISSING', 'PR chưa dựa trên baseline contributor đã xuất.');
    const publicBaseline = JSON.parse(Buffer.from(baselineFile.content, 'base64').toString());
    const baseline = await this.service.store().get('baselines', publicBaseline.id);
    requireValue(baseline?.status === 'published' && baseline.publicHead === job.source.baseSha && baseline.repository === config.sourceRepo,
      'BASELINE_STALE', 'Base của PR không còn là baseline đã ghi nhận. Cần cập nhật baseline và rebase PR.');
    const current = await sourceFiles(config.sourceRoot);
    requireValue(hash(manifestFor(current.files)) === baseline.ownerDigest, 'OWNER_SOURCE_CHANGED', 'Source owner đã đổi từ lần xuất baseline. Chuẩn bị baseline mới và rebase PR trước khi tạo candidate.');
    const tree = await this.service.github.request('GET', `/repos/${config.sourceRepo}/git/trees/${job.source.headSha}?recursive=1`, null, { maxBytes: 4000000 });
    requireValue(!tree.truncated && Array.isArray(tree.tree), 'PR_TREE_INCOMPLETE', 'Chưa lấy đủ cây source của PR.');
    const entries = new Map(tree.tree.map(entry => [entry.path, entry])); const changed = [];
    for (const file of job.source.files) {
      // Change notes are review evidence only: validate them but never execute or apply
      // them to the owner runtime, and never let them rename a policy/runtime file.
      if (allowedChangeNote(file.filename)) {
        requireValue(!file.previousFilename || allowedChangeNote(file.previousFilename), 'PR_SCOPE', 'Change note không được đổi tên từ file policy/source.');
        if (file.status !== 'removed') {
          const entry = entries.get(file.filename);
          requireValue(entry?.type === 'blob' && entry.mode === '100644', 'PR_LINK', 'Change note phải là Markdown thông thường.');
          const content = await this.service.github.content(config.sourceRepo, file.filename, job.source.headSha);
          requireValue(content?.encoding === 'base64' && content.sha === entry.sha && content.size <= 32000, 'PR_FILE_SIZE', 'Change note không quá 32 KB.');
          const bytes = Buffer.from(content.content, 'base64');
          requireValue(!bytes.includes(0) && bytes.length <= 32000, 'PR_FILE_SIZE', 'Change note phải là văn bản.');
          scanSecrets(file.filename, bytes);
        }
        continue;
      }
      requireValue(allowedChange(file.filename) && (!file.previousFilename || allowedChange(file.previousFilename)), 'PR_SCOPE',
        `Thay đổi ${file.filename} cần owner cập nhật baseline/build policy trước.`);
      if (file.previousFilename) { requireValue(current.files[file.previousFilename], 'PR_BASE_MISMATCH', 'File rename không có trong baseline.'); delete current.files[file.previousFilename]; }
      if (file.status === 'removed') { requireValue(current.files[file.filename], 'PR_BASE_MISMATCH', 'File xóa không có trong baseline.'); delete current.files[file.filename]; changed.push(file.filename); continue; }
      const entry = entries.get(file.filename);
      requireValue(entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode), 'PR_LINK', 'Không nhận symlink hoặc submodule từ PR.');
      const content = await this.service.github.content(config.sourceRepo, file.filename, job.source.headSha);
      requireValue(content?.encoding === 'base64' && content.sha === entry.sha && content.size <= 1024 * 1024, 'PR_FILE_SIZE', 'File PR phải đọc đủ, không quá 1 MiB.');
      const bytes = Buffer.from(content.content, 'base64'); scanSecrets(file.filename, bytes); current.files[file.filename] = bytes; changed.push(file.filename);
    }
    const latest = await this.service.github.request('GET', `/repos/${config.sourceRepo}/pulls/${job.source.number}`);
    requireValue(latest.head.sha === job.source.headSha && latest.base.sha === job.source.baseSha && latest.state === 'open', 'REVISION_CHANGED', 'PR đổi trong lúc chuẩn bị source; đồng bộ lại.');
    return { files: current.files, baselineId: baseline.id, changed };
  }
  async prepare(user, id, revision) {
    const job = await this.fresh(user, id, revision);
    requireValue(!job.lease && !['deploying', 'recovering', 'unknown'].includes(job.release?.status), 'JOB_BUSY', 'Hoàn tất việc đang chạy trước khi chuẩn bị candidate.');
    requireValue(!this.builds.has(id), 'CANDIDATE_BUSY', 'Candidate đang được chuẩn bị trên máy này.');
    const attemptId = crypto.randomUUID(); const controller = new AbortController();
    const record = await this.service.store().mutate('jobs', id, value => {
      jobs.assertRevision(value, revision);
      requireValue(value.candidateBuild?.status !== 'preparing' || value.candidateBuild.expiresAt < Date.now(), 'CANDIDATE_BUSY', 'Máy khác đang chuẩn bị candidate; chờ hoàn tất hoặc hết lease.');
      value.candidateBuild = { attemptId, status: 'preparing', machineId: this.service.config.read().machineId, startedAt: Date.now(), expiresAt: Date.now() + 12 * 60000 };
      value.candidate = null; value.checks = []; value.trial = null; value.approval = null;
      return jobs.event(value, 'candidate.preparing', user.id);
    });
    const promise = this.build(record, attemptId, user.id, controller.signal).catch(() => {}).finally(() => this.builds.delete(id));
    this.builds.set(id, { controller, promise });
    return { id, revision, candidateBuild: record.candidateBuild };
  }
  async build(job, attemptId, actor, signal) {
    const store = this.service.store();
    try {
      const source = await this.source(job); const config = this.service.config.read();
      const candidate = { id: `candidate-${crypto.randomUUID()}`, revision: job.revision, fingerprint: job.fingerprint, baselineId: source.baselineId,
        sourceHead: job.source.headSha, machineId: config.machineId, sourceManifest: manifestFor(source.files), createdAt: Date.now() };
      const directory = this.directory(candidate); writeFiles(path.join(directory, 'source'), source.files);
      const built = await this.sandbox.build(directory, source.files, source.changed.filter(filename => source.files[filename]), signal);
      Object.assign(candidate, built);
      candidate.digest = candidateDigest(candidate);
      const runtime = await this.sandbox.startRuntime(candidate, { ttlMs: 120000, signal }); let proof;
      try { proof = await httpProof(runtime.backendUrl); } finally { await this.sandbox.stopRuntime(runtime); }
      await store.mutate('jobs', job.id, value => {
        requireValue(value?.candidateBuild?.attemptId === attemptId && value.fingerprint === job.fingerprint && value.revision === job.revision,
          'STALE_ATTEMPT', 'Candidate thuộc attempt/revision cũ.');
        value.candidate = candidate;
        value.checks = [
          { name: 'source', status: 'passed', summary: 'PR head và baseline khớp; kiểm phạm vi, hash file, symlink và credential.', evidence: { baselineId: source.baselineId, head: job.source.headSha } },
          { name: 'build', status: 'passed', summary: `Vite build trong Docker, ${Math.round(built.buildMs / 1000)} giây.`, evidence: { imageId: candidate.imageId, dependencyImage: built.dependencyImage } },
          { name: 'tests', status: 'passed', summary: `${built.tests.length} nhóm kiểm tra tự động và HTTP smoke đạt. Nghiệm thu UI do owner thực hiện.`, evidence: { tests: built.tests, http: proof } },
          { name: 'security', status: 'passed', summary: 'Source/dependency giữ baseline; API đòi đăng nhập và CSRF. Findings AI được kiểm ở gate riêng.', evidence: { http: proof, scope: 'source-policy + dependency-lock + auth/CSRF regression' } },
        ].map(check => ({ ...check, digest: candidate.digest, platform: candidate.platform, completedAt: Date.now(), machineId: config.machineId }));
        value.candidateBuild.status = 'completed'; value.candidateBuild.completedAt = Date.now();
        return jobs.event(value, 'candidate.completed', actor, { digest: candidate.digest, platform: candidate.platform });
      });
    } catch (error) {
      await store.mutate('jobs', job.id, value => {
        if (value?.candidateBuild?.attemptId !== attemptId) return undefined;
        value.candidateBuild.status = 'failed'; value.candidateBuild.error = error instanceof ReviewError ? error.message : 'Không hoàn tất candidate.';
        value.candidateBuild.code = error.code || 'CANDIDATE_FAILED';
        value.candidateBuild.diagnostic = error.diagnostic || null;
        return jobs.event(value, 'candidate.failed', actor, { code: value.candidateBuild.code });
      }).catch(() => {}); throw error;
    }
  }
  async verify(job) {
    requireValue(job.candidate && job.candidate.digest === candidateDigest(job.candidate) && job.candidate.fingerprint === job.fingerprint,
      'ARTIFACT_CHANGED', 'Candidate không còn khớp hồ sơ.');
    requireValue(job.candidate.machineId === this.service.config.read().machineId, 'CANDIDATE_OTHER_MACHINE', 'Artifact ở máy đã tạo candidate. Mở console trên máy đó để dùng thử hoặc áp dụng.');
    await this.sandbox.verify(job.candidate, this.directory(job.candidate));
    return true;
  }
  async preview(user, id, revision) {
    const job = await this.fresh(user, id, revision); const config = await this.service.effective();
    requireValue(job.policy?.version === config.policy.version && jobs.gates(job).canPreview, 'PREVIEW_GATES', 'Các gate trước dùng thử chưa đạt.');
    await this.verify(job); await this.stopPreview(user, id, revision);
    const runtime = await this.sandbox.startRuntime(job.candidate); let gateway;
    try {
      gateway = await openGateway(runtime, this.directory(job.candidate), job.candidate);
      const record = await this.service.store().mutate('jobs', id, value => {
        jobs.assertRevision(value, revision); requireValue(value.candidate?.digest === job.candidate.digest, 'ARTIFACT_CHANGED', 'Candidate đã đổi.');
        value.trial = { id: runtime.id, digest: job.candidate.digest, result: 'pending', startedAt: Date.now(), expiresAt: runtime.expiresAt,
          url: gateway.url, machineId: config.machineId, runtime: { name: runtime.name, network: runtime.network, gatewayName: runtime.gatewayName } };
        value.approval = null; return jobs.event(value, 'trial.started', user.id, { digest: job.candidate.digest });
      });
      const timer = setTimeout(() => this.stopPreview(user, id, revision).catch(() => {}), runtime.expiresAt - Date.now()); timer.unref?.();
      this.previews.set(id, { runtime, gateway, timer }); return record.trial;
    } catch (error) { gateway?.server.close(); await this.sandbox.stopRuntime(runtime); throw error; }
  }
  async stopPreview(user, id, revision) {
    this.service.requireOwner(user); const local = this.previews.get(id);
    if (local) { clearTimeout(local.timer); local.gateway.server.closeAllConnections(); local.gateway.server.close(); await this.sandbox.stopRuntime(local.runtime); this.previews.delete(id); }
    const record = await this.service.store().get('jobs', id); jobs.assertRevision(record, revision);
    if (record.trial?.runtime && record.trial.machineId === this.service.config.read().machineId) await this.sandbox.stopRuntime(record.trial.runtime);
    if (record.trial) await this.service.store().mutate('jobs', id, value => {
      jobs.assertRevision(value, revision); if (!value.trial) return undefined;
      value.trial.url = null; value.trial.stoppedAt = Date.now(); return value;
    });
    return { stopped: true };
  }
  async trial(user, id, input) {
    const job = await this.fresh(user, id, input.revision); await this.verify(job);
    const config = await this.service.effective();
    requireValue(job.policy?.version === config.policy.version && jobs.gates(job).canPreview && !job.lease && !['queued', 'running'].includes(job.status), 'TRIAL_GATES', 'Cần hoàn tất kiểm tra bản hiện tại trước khi chấp nhận.');
    const notes = jobs.text(input.notes, 8000, 'Ghi chú nghiệm thu');
    requireValue(['accepted', 'rejected'].includes(input.result), 'TRIAL_RESULT', 'Kết quả nghiệm thu không hợp lệ.', 400);
    return this.service.store().mutate('jobs', id, value => {
      jobs.assertRevision(value, input.revision);
      requireValue(value.policy?.version === config.policy.version && jobs.gates(value).canPreview && !value.lease && !['queued', 'running', 'changes_requested', 'cancelled'].includes(value.status), 'TRIAL_GATES', 'Hồ sơ đã đổi; cần kiểm tra lại trước khi chấp nhận.');
      requireValue(value.trial?.digest === input.digest && input.digest === value.candidate?.digest && !value.trial.stoppedAt && value.trial.expiresAt > Date.now(), 'TRIAL_EXPIRED', 'Phiên dùng thử đã hết hạn hoặc không khớp candidate.');
      value.trial.result = input.result; value.trial.notes = notes; value.trial.ownerId = user.id; value.trial.acceptedAt = Date.now(); value.approval = null;
      return jobs.event(value, 'trial.recorded', user.id, { result: input.result, digest: input.digest });
    });
  }
}
module.exports = { CandidateService, candidateDigest };
