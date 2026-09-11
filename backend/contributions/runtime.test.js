const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureContributionSchema } = require('./schema');
const { SqliteRecordStore } = require('./records');
const { ContributionService } = require('./service');
const { ReviewWorker } = require('./worker');
const { ReleaseService } = require('./releases');
const { ReviewError } = require('./errors');
const { validatePolicy } = require('./policy');
const jobs = require('./jobs');

const owner = { id: 'owner', role: 'admin', status: 'active', email: 'owner@example.invalid' };
const member = { id: 'member', role: 'member', status: 'active', email: 'member@example.invalid' };
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,checksum TEXT,applied_at TEXT)'); ensureContributionSchema(db);
  let settings = { machineId: 'worker-one', machineName: 'Worker One', ownerEmail: owner.email, storageMode: 'local', workerEnabled: true,
    sourceRepo: 'owner/contributor', controlRepo: 'owner/control', contributorBindings: {}, pollMs: 60000, leaseMs: 240000,
    policy: validatePolicy(), workspaceRoot: require('path').resolve('logs/contributor-console/test-artifacts'),
    releaseTargets: [{ id: 'staging', name: 'Isolated staging', kind: 'docker-staging', platform: 'linux/amd64', backendPort: 48998 }] };
  const config = { read: () => structuredClone(settings), initialize: () => structuredClone(settings), public: () => structuredClone(settings),
    write: value => { settings = structuredClone(value); return settings; }, update: value => { settings = { ...settings, ...value }; return structuredClone(settings); },
    prepare: value => ({ ...settings, ...value }) };
  const store = new SqliteRecordStore(db); const service = new ContributionService({ localStore: store, config, github: {} });
  const candidates = { fresh: async (user, id, revision) => { service.requireOwner(user); const job = await store.get('jobs', id); jobs.assertRevision(job, revision); return job; },
    verify: async () => true, directory: () => settings.workspaceRoot };
  return { db, config, store, service, candidates };
}
function reportResult(model) { return { actualModel: model, modelVerified: true, report: { summary: 'Fixture result', findings: [], gaps: [], suggestedTests: [] },
  usage: { inputTokens: 40, outputTokens: 10, costUsd: null } }; }
async function queueFixture(f, overrides = {}) {
  const job = jobs.createJob({ title: 'Text defaults', description: 'Keep text output compatible', author: { userId: member.id, email: member.email }, ...overrides });
  jobs.queue(job, 1, owner.id, f.config.read().policy); await f.store.mutate('jobs', job.id, () => job); return job;
}
async function releasable(f) {
  const job = await queueFixture(f); job.status = 'reviewed'; job.report = { fingerprint: job.fingerprint, findings: [], modelVerified: true };
  job.candidate = { id: 'candidate-fixture', digest: 'candidate-digest', fingerprint: job.fingerprint, platform: 'linux/amd64', imageId: 'sha256:fixture' };
  job.checks = ['source', 'build', 'tests', 'security'].map(name => ({ name, status: 'passed', digest: job.candidate.digest }));
  job.trial = { result: 'accepted', digest: job.candidate.digest, expiresAt: Date.now() + 600000 };
  await f.store.mutate('jobs', job.id, () => job); return job;
}
test('two processes using the same machine identity still execute one paid role sequence', async () => {
  const f = fixture(); const job = await queueFixture(f); let calls = 0;
  const runner = { run: async (_, task) => { calls++; await new Promise(resolve => setImmediate(resolve)); return reportResult(task.selection.model); } };
  const one = new ReviewWorker(f.service, { runner }); const two = new ReviewWorker(f.service, { runner });
  await Promise.all([one.tick({ sync: false }), two.tick({ sync: false })]);
  const final = await f.store.get('jobs', job.id); assert.equal(final.status, 'reviewed'); assert.equal(calls, job.tasks.length);
  assert.equal(final.events.filter(event => event.type === 'review.claimed').length, 1); f.db.close();
});
test('model quota failure and call budget stop the queue without a hidden fallback', async () => {
  const f = fixture(); f.config.update({ policy: validatePolicy({ maxCalls: 1 }) }); const job = await queueFixture(f); let calls = 0;
  const worker = new ReviewWorker(f.service, { runner: { run: async (_, task) => { calls++; return reportResult(task.selection.model); } } });
  await worker.tick({ sync: false }); let current = await f.store.get('jobs', job.id);
  assert.equal(calls, 1); assert.equal(current.status, 'waiting'); assert.equal(current.waitReason, 'REVIEW_BUDGET');
  await worker.tick({ sync: false }); assert.equal(calls, 1);
  f.db.close();
});
test('an explicitly new review run gets its own elapsed-time budget', async () => {
  const f = fixture(); const job = await queueFixture(f);
  await f.store.mutate('jobs', job.id, value => { value.status = 'reviewed'; value.reviewStartedAt = Date.now() - 3600000; return value; });
  await f.service.review(owner, job.id, 1);
  assert.equal((await f.store.get('jobs', job.id)).reviewStartedAt, null); f.db.close();
});
test('a late model response cannot populate a replaced source revision', async () => {
  const f = fixture(); const job = await queueFixture(f); let called = false;
  const worker = new ReviewWorker(f.service, { runner: { run: async (_, task) => {
    called = true; await f.store.mutate('jobs', job.id, value => jobs.replaceRevision(value, { title: 'New title', description: value.description, source: null }, 'contributor'));
    return reportResult(task.selection.model);
  } } });
  await worker.tick({ sync: false }); const current = await f.store.get('jobs', job.id);
  assert.ok(called); assert.equal(current.revision, 2); assert.equal(current.report, null); assert.deepEqual(current.tasks, []); f.db.close();
});
test('another admin cannot approve; approval pins policy, target and candidate', async () => {
  const f = fixture(); const job = await releasable(f); const releases = new ReleaseService(f.service, f.candidates);
  const input = { revision: 1, digest: job.candidate.digest, targetId: 'staging', notes: 'Accepted fixture' };
  await assert.rejects(releases.approve({ ...owner, email: 'admin-two@example.invalid' }, job.id, input), { code: 'OWNER_ONLY' });
  await releases.approve(owner, job.id, input); f.config.update({ policy: validatePolicy({ version: 2 }) });
  await assert.rejects(releases.apply(owner, job.id, input), { code: 'APPROVAL_EXPIRED' }); f.db.close();
});
test('duplicate apply has one external effect; receipt proves digest, health and smoke', async () => {
  const f = fixture(); const job = await releasable(f); let activations = 0; let backups = 0;
  const adapter = { backup: async context => { backups++; return { operationId: context.operationId, recoveryReady: true, snapshotId: 'fixture' }; },
    activate: async () => { activations++; }, inspect: async context => ({ operationId: context.operationId, digest: context.digest, health: true, smoke: true, imageId: 'sha256:fixture' }) };
  const releases = new ReleaseService(f.service, f.candidates, { adapterFactory: () => adapter });
  const input = { revision: 1, digest: job.candidate.digest, targetId: 'staging', notes: 'Accepted fixture' };
  await releases.approve(owner, job.id, input); const first = await releases.apply(owner, job.id, input);
  const second = await releases.apply(owner, job.id, input); assert.equal(first.id, second.id);
  await Promise.all([...releases.active.values()]); const current = await f.store.get('jobs', job.id);
  assert.equal(current.status, 'released'); assert.equal(activations, 1); assert.equal(backups, 1);
  assert.equal((await f.store.get('targets', 'staging')).lock, null); f.db.close();
});
test('uncertain activation keeps target locked until inspection verifies the exact digest', async () => {
  const f = fixture(); const job = await releasable(f); let activated = false;
  const adapter = { backup: async context => ({ operationId: context.operationId, recoveryReady: true, snapshotId: 'fixture' }),
    activate: async () => { activated = true; throw new ReviewError('PROCESS_TIMEOUT', 'Lost acknowledgment'); },
    inspect: async context => ({ operationId: context.operationId, digest: context.digest, health: true, smoke: true }) };
  const releases = new ReleaseService(f.service, f.candidates, { adapterFactory: () => adapter });
  const input = { revision: 1, digest: job.candidate.digest, targetId: 'staging', notes: 'Accepted fixture' };
  await releases.approve(owner, job.id, input); await releases.apply(owner, job.id, input); await Promise.all([...releases.active.values()]);
  assert.ok(activated); assert.equal((await f.store.get('jobs', job.id)).release.status, 'unknown'); assert.ok((await f.store.get('targets', 'staging')).lock);
  await releases.reconcile(owner, job.id, input); assert.equal((await f.store.get('jobs', job.id)).status, 'released');
  assert.equal((await f.store.get('targets', 'staging')).lock, null); f.db.close();
});
test('wrong-target proof cannot release, and rollback requires a verified recovery receipt', async () => {
  const f = fixture(); const job = await releasable(f);
  const adapter = { backup: async context => ({ operationId: context.operationId, recoveryReady: true, snapshotId: 'fixture' }), activate: async () => {},
    inspect: async context => ({ operationId: context.operationId, digest: 'wrong-image', health: true, smoke: true }),
    restore: async context => ({ operationId: context.operationId, recovered: true }) };
  const releases = new ReleaseService(f.service, f.candidates, { adapterFactory: () => adapter });
  const input = { revision: 1, digest: job.candidate.digest, targetId: 'staging', notes: 'Recover fixture' };
  await releases.approve(owner, job.id, input); await releases.apply(owner, job.id, input); await Promise.all([...releases.active.values()]);
  assert.equal((await f.store.get('jobs', job.id)).release.status, 'unknown');
  await releases.rollback(owner, job.id, input); const current = await f.store.get('jobs', job.id);
  assert.equal(current.release.status, 'rolled_back'); assert.equal(current.approval, null); assert.equal(current.trial, null); f.db.close();
});
test('release feedback is delivered once and an unknown delivery never repeats deployment or notification', async () => {
  const f = fixture(); const job = await queueFixture(f, { kind: 'pull_request', source: { repository: 'owner/contributor', number: 1 } });
  await f.store.mutate('jobs', job.id, value => { value.status = 'released'; value.release = { id: 'release-proof', status: 'released', targetId: 'staging', digest: 'verified-digest' }; return value; });
  let calls = 0; f.service.github.comment = async () => { calls++; throw new ReviewError('GITHUB_OFFLINE', 'Acknowledgment lost'); };
  await Promise.all([f.service.releaseFeedback(job.id), f.service.releaseFeedback(job.id)]);
  await f.service.releaseFeedback(job.id);
  const result = await f.store.get('jobs', job.id);
  assert.equal(calls, 1); assert.equal(result.release.status, 'released'); assert.equal(result.feedback.length, 1);
  assert.equal(result.feedback[0].delivery, 'unknown'); assert.match(result.feedback[0].body, /staging/); f.db.close();
});
