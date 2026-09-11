const test = require('node:test');
const assert = require('node:assert/strict');
const { CandidateService } = require('./candidates');
const { createJob } = require('./jobs');
function fixture() {
  const job = createJob({ title: 'Test trial guards', author: { userId: 'owner' } });
  job.status = 'reviewed'; job.policy = { version: 1 };
  job.report = { fingerprint: job.fingerprint, findings: [], modelVerified: true };
  job.candidate = { digest: 'digest', fingerprint: job.fingerprint };
  job.checks = ['source', 'security', 'build', 'tests'].map(name => ({ name, digest: 'digest', status: 'passed' }));
  job.trial = { digest: 'digest', expiresAt: Date.now() + 60000 };
  const service = { effective: async () => ({ policy: { version: 1 } }), store: () => ({ mutate: async (_, __, fn) => fn(job) }) };
  const candidate = Object.create(CandidateService.prototype);
  candidate.service = service; candidate.fresh = async () => job; candidate.verify = async () => true;
  const input = { revision: 1, digest: 'digest', notes: 'I tested the current candidate.', result: 'accepted' };
  return { job, candidate, input };
}
test('acceptance requires current verified checks, matching policy and a live preview', async () => {
  for (const mutate of [job => { job.checks[0].status = 'failed'; }, job => { job.policy.version = 2; },
    job => { job.trial.stoppedAt = Date.now(); }, job => { job.trial.expiresAt = 1; }, job => { job.status = 'cancelled'; }]) {
    const { job, candidate, input } = fixture(); mutate(job);
    await assert.rejects(candidate.trial({ id: 'owner' }, job.id, input));
    assert.equal(job.trial.result, undefined);
  }
  const { job, candidate, input } = fixture();
  await candidate.trial({ id: 'owner' }, job.id, input);
  assert.equal(job.trial.result, 'accepted'); assert.equal(job.approval, null); assert.equal(job.release, null);
});
