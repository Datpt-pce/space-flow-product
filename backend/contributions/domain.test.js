const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureContributionSchema } = require('./schema');
const { SqliteRecordStore, GitHubRecordStore } = require('./records');
const policy = require('./policy');
const jobs = require('./jobs');

const owner = { id: 'owner', role: 'admin', email: 'owner@example.invalid', status: 'active' };
const author = { id: 'author', role: 'member', email: 'author@example.invalid', status: 'active' };
function queued() {
  const job = jobs.createJob({ title: 'Text compatibility', description: 'Preserve old inputs', author: { userId: author.id },
    source: { files: [{ filename: 'nodes/text/execute.js' }], patch: 'small diff', headSha: 'a'.repeat(40) } });
  return jobs.queue(job, 1, owner.id, policy.validatePolicy());
}
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,checksum TEXT,applied_at TEXT)');
  ensureContributionSchema(db); return db;
}
test('only configured owner sees reports; another admin and other contributor cannot read', () => {
  const job = queued(); job.report = { summary: 'private internal context' };
  assert.equal(policy.publicJob(job, owner, owner.email).report.summary, 'private internal context');
  assert.equal(policy.publicJob(job, author, owner.email).report, undefined);
  assert.equal(policy.publicJob(job, author, owner.email).source.patch, undefined);
  assert.throws(() => policy.publicJob(job, { ...author, id: 'other', email: 'other@example.invalid' }, owner.email), /Không tìm/);
  assert.throws(() => policy.requireOwner({ ...owner, email: 'another-admin@example.invalid' }, owner.email), /Chỉ owner/);
});
test('two atomic claim attempts produce one winner, and stale attempt cannot complete', async () => {
  const db = database(); const store = new SqliteRecordStore(db); const job = queued();
  await store.mutate('jobs', job.id, () => job);
  await Promise.all(['one', 'two'].map(id => store.mutate('jobs', job.id, value => jobs.claim(value, id, 240000))));
  const current = await store.get('jobs', job.id);
  assert.equal(current.events.filter(e => e.type === 'review.claimed').length, 1);
  assert.throws(() => jobs.recordResult(current, 'stale-attempt', 'assistant', {}), /Attempt/);
  db.close();
});
test('new revision invalidates a running lease and every prior approval/trial', () => {
  const job = jobs.claim(queued(), 'one', 240000); const attempt = job.lease.attemptId;
  job.approval = { digest: 'old' }; job.trial = { result: 'accepted' }; job.report = { summary: 'old' };
  jobs.replaceRevision(job, { title: job.title, description: job.description, source: { ...job.source, headSha: 'b'.repeat(40) } }, 'sync');
  assert.equal(job.revision, 2); assert.equal(job.approval, null); assert.equal(job.trial, null);
  assert.equal(job.report, null); assert.equal(job.lease, null);
  assert.throws(() => jobs.heartbeat(job, attempt, 240000), /Attempt/);
  assert.throws(() => jobs.queue(job, 1, owner.id, policy.validatePolicy()), /revision mới/);
});
test('expired model call becomes unknown instead of being billed again automatically', () => {
  const job = jobs.claim(queued(), 'one', 100, 1000); job.tasks[0].status = 'running';
  jobs.claim(job, 'two', 100, 1200);
  assert.equal(job.status, 'waiting'); assert.equal(job.waitReason, 'UNKNOWN_MODEL_OUTCOME');
  assert.equal(job.tasks[0].status, 'unknown'); assert.equal(jobs.claim(job, 'two', 100, 1400), undefined);
});
test('small helper uses a lower model while an auth diff raises review effort; Fable and aliases fail', () => {
  const p = policy.validatePolicy();
  assert.equal(policy.routeModel('assistant', 'complex', p).model, 'gpt-5.6-luna');
  const risk = policy.riskFor([{ filename: 'backend/middleware/auth.js' }]);
  assert.equal(policy.routeModel('security', risk, p).model, 'gpt-5.6-sol');
  assert.equal(policy.routeModel('code', 'small', { ...p, provider: 'claude' }).model, 'claude-sonnet-5');
  for (const model of ['claude-fable-5', 'fable', 'sonnet', 'inherit'])
    assert.throws(() => policy.assertModel({ provider: 'claude', model, effort: 'medium' }), /allowlist/);
});
test('model agreement never substitutes for build/test/security proof or owner trial', () => {
  const job = queued(); job.status = 'reviewed';
  job.report = { fingerprint: job.fingerprint, findings: [], modelVerified: true };
  assert.equal(jobs.gates(job).canApply, false);
  job.candidate = { fingerprint: job.fingerprint, digest: 'digest', platform: 'linux' };
  job.checks = ['source', 'build', 'tests', 'security'].map(name => ({ name, status: 'passed', digest: 'digest' }));
  assert.equal(jobs.gates(job).canPreview, true); assert.equal(jobs.gates(job).canApply, false);
  job.trial = { digest: 'digest', result: 'accepted', expiresAt: Date.now() + 10000 };
  assert.equal(jobs.gates(job, { platform: 'linux' }).canApply, true);
  assert.equal(jobs.gates(job, { platform: 'win32' }).canApply, false);
  job.checks[1].digest = 'other'; assert.equal(jobs.gates(job).canApply, false);
});
test('GitHub CAS retries merge competing mutations; shared state must be private', async () => {
  let current = null; let counter = 0;
  const client = {
    repository: async () => ({ private: true, permissions: { push: true }, owner: { login: 'owner' } }),
    content: async () => current ? { type: 'file', encoding: 'base64', size: current.text.length, content: Buffer.from(current.text).toString('base64'), sha: current.sha } : null,
    putContent: async (repo, path, text, sha) => {
      await new Promise(resolve => setImmediate(resolve));
      if (sha !== current?.sha) { const error = new Error('conflict'); error.code = 'GITHUB_CONFLICT'; throw error; }
      current = { text, sha: String(++counter) }; return { content: { sha: current.sha } };
    },
  };
  const a = new GitHubRecordStore(client, 'owner/control'); const b = new GitHubRecordStore(client, 'owner/control');
  await a.mutate('settings', 'global', () => ({ count: 0 }));
  await Promise.all([a, b].map(store => store.mutate('settings', 'global', value => ({ count: value.count + 1 }))));
  assert.equal((await a.get('settings', 'global')).count, 2);
  client.repository = async () => ({ private: false, permissions: { push: true } });
  await assert.rejects(a.mutate('settings', 'global', () => ({ count: 99 })), /Private/);
});
test('checksummed additive schema refuses a modified applied migration', () => {
  const db = database(); ensureContributionSchema(db);
  db.prepare('UPDATE schema_migrations SET checksum=? WHERE id=?').run('tampered', '004-contribution-records');
  assert.throws(() => ensureContributionSchema(db), /checksum/); db.close();
});
