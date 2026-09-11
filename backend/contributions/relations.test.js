const test = require('node:test');
const assert = require('node:assert/strict');
const { relationContext, comparisonSnapshot } = require('./relations');
const { contextFor } = require('./models');
const { createJob, replaceRevision } = require('./jobs');
function pr(number, title, files) {
  const job = createJob({ id: `pr-${number}`, kind: 'pull_request', title, author: { githubLogin: `author${number}` },
    source: { number, headSha: `head${number}`, files: files.map(filename => ({ filename })) } });
  job.sourceState = 'open'; return job;
}
test('ten PRs identify possible duplicates, overlap including renames and same area without claiming independence', () => {
  const jobs = [pr(1, 'Giữ nội dung Text khi mở lại workflow', ['nodes/text/execute.js']),
    pr(2, 'Giữ nội dung Text khi mở lại workflow', ['frontend/src/nodes/TextNode.jsx']),
    pr(3, 'Correct empty strings', ['nodes/text/execute.js']),
    pr(4, 'Add multiline input', ['nodes/text/node.json']),
    ...Array.from({ length: 6 }, (_, i) => pr(i + 5, `Unique concern ${i}`, [`nodes/other-${i}/execute.js`]))];
  jobs[9].source.files[0].previousFilename = 'nodes/text/execute.js';
  const result = relationContext(jobs[0], jobs);
  assert.equal(result.comparedCount, 9); assert.equal(result.totalOpen, 10);
  assert.equal(result.related.find(item => item.number === 2).possibleDuplicate, true);
  assert.equal(result.related.find(item => item.number === 3).overlapCount, 1);
  assert.equal(result.related.find(item => item.number === 4).overlapCount, 0);
  assert.equal(result.related.find(item => item.number === 10).overlapCount, 1);
  assert.equal(result.related.some(item => item.number === 5), false);
  assert.equal(result.combinedTested, false); assert.match(result.limitation, /API/);
  const old = result.fingerprint;
  replaceRevision(jobs[1], { title: jobs[1].title, description: '', source: { ...jobs[1].source, headSha: 'changed' } }, 'test');
  assert.notEqual(relationContext(jobs[0], jobs).fingerprint, old);
  jobs[2].sourceState = 'closed';
  assert.equal(relationContext(jobs[0], jobs).related.some(item => item.number === 3), false);
});
test('manager receives a bounded snapshot, other roles do not; queue changes are visible', () => {
  const main = pr(1, 'Text persistence', ['nodes/text/execute.js']);
  const peer = pr(2, 'Text persistence alternative', ['nodes/text/execute.js']);
  main.comparisonSnapshot = comparisonSnapshot(main, [main, peer]);
  const input = JSON.parse(contextFor(main, { role: 'manager', selection: { maxInputBytes: 16000 } }));
  assert.equal(input.otherRequests[0].number, 2);
  assert.deepEqual(JSON.parse(contextFor(main, { role: 'code', selection: { maxInputBytes: 16000 } })).otherRequests, []);
  assert.equal(relationContext(main, [main, peer]).reviewChanged, false);
  peer.revision++;
  assert.equal(relationContext(main, [main, peer]).reviewChanged, true);
  main.comparisonSnapshot.requests = Array.from({ length: 20 }, () => ({ description: 'x'.repeat(800) }));
  const bounded = JSON.parse(contextFor(main, { role: 'manager', selection: { maxInputBytes: 4000 } }));
  assert.equal(bounded.otherRequestsTruncated, true); assert.equal(main.comparisonSnapshot.requests.length, 20);
});
test('sync refreshes a previously open PR missing from the current open listing', async () => {
  const { ContributionService } = require('./service');
  const job = pr(1, 'Closed request', ['nodes/text/execute.js']); job.source.repository = 'owner/contributor';
  const records = new Map([[job.id, job]]);
  const config = { storageMode: 'local', sourceRepo: 'owner/contributor', ownerEmail: 'owner@example.invalid', contributorBindings: {}, workerEnabled: false };
  const service = new ContributionService({ config: { read: () => config, initialize: () => config },
    github: { pulls: async () => [] }, localStore: { list: async () => [...records.values()] } });
  const refreshed = [];
  service.importPull = async number => { refreshed.push(number); job.sourceState = 'closed'; return job; };
  await service.sync({ id: 'owner', email: config.ownerEmail, role: 'admin', status: 'active' });
  assert.deepEqual(refreshed, [1]); assert.equal(relationContext(job, [job]).totalOpen, 0);
});
