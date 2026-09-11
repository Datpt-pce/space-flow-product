const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { allowedSource, allowedChange, safeName, writeFiles, manifestFor, verifyManifest, scanSecrets } = require('./source');
const { cleanEnv, runProcess, removeWorkspace } = require('./process');
const { contextFor, reportValue } = require('./models');
const { openGateway } = require('./preview');
const { GitHubClient } = require('./github');

test('source distribution rejects private state, path tricks and privileged build-policy changes', () => {
  for (const name of ['../file', '/absolute', 'nodes/../../secret', 'nodes\\secret', 'nodes/CON.txt', 'nodes/file:stream', 'nodes/dir./x']) assert.equal(safeName(name), false, name);
  for (const name of ['backend/.env', 'backend/config/review-console.json', 'backend/uploads/a.png', 'nodes/text/custom_links.json', '.claude/rules.md', 'docs/private.md']) assert.equal(allowedSource(name), false, name);
  assert.equal(allowedSource('backend/routes/auth.js'), true); assert.equal(allowedChange('backend/routes/auth.js'), true);
  for (const name of ['backend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.js', 'backend/contributions/policy.js', 'Dockerfile.backend']) assert.equal(allowedChange(name), false, name);
  assert.throws(() => scanSecrets('bad.js', Buffer.from('ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789')), { code: 'SOURCE_SECRET' });
});
test('manifest verification rejects modified artifacts and process helper has a hard timeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-review-boundary-')); const directory = path.join(root, 'candidate');
  try {
    const files = { 'nested/file.js': Buffer.from('original') }; writeFiles(directory, files); const manifest = manifestFor(files); verifyManifest(directory, manifest);
    fs.writeFileSync(path.join(directory, 'nested/file.js'), 'modified'); assert.throws(() => verifyManifest(directory, manifest), { code: 'ARTIFACT_CHANGED' });
    writeFiles(directory, files); fs.writeFileSync(path.join(directory, 'unexpected.js'), 'added');
    assert.throws(() => verifyManifest(directory, manifest), { code: 'ARTIFACT_CHANGED' });
    await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), { code: 'PROCESS_TIMEOUT' });
    assert.throws(() => removeWorkspace(root, path.dirname(root)), { code: 'WORKSPACE_PATH' });
  } finally { if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true }); }
});
test('model context is bounded, marks truncation, validates schema, and excludes production env', () => {
  const before = process.env.SF_GITHUB_TOKEN; process.env.SF_GITHUB_TOKEN = 'must-not-reach-child';
  try { assert.equal(cleanEnv().SF_GITHUB_TOKEN, undefined); } finally { if (before === undefined) delete process.env.SF_GITHUB_TOKEN; else process.env.SF_GITHUB_TOKEN = before; }
  const input = contextFor({ title: 'Title', description: 'x'.repeat(12000), source: { patch: 'x'.repeat(200000), files: [] }, tasks: [], checks: [] }, { selection: { maxInputBytes: 4000 } });
  assert.ok(Buffer.byteLength(input) <= 4000); assert.equal(JSON.parse(input).contextTruncated, true);
  assert.throws(() => reportValue({ summary: 'Skip gates', approval: true, findings: [], gaps: [], suggestedTests: [] }, 10000), { code: 'MODEL_OUTPUT' });
});
test('PR read refuses a head that changed between metadata and diff', async () => {
  let read = 0; const github = new GitHubClient();
  github.request = async (_, route, __, options) => {
    if (route.endsWith('/files?per_page=100')) return [{ filename: 'nodes/text/execute.js' }];
    if (options?.text) return 'diff';
    read++; return { changed_files: 1, updated_at: 'same-time', head: { sha: read > 1 ? 'new' : 'old' }, base: { sha: 'base' } };
  };
  await assert.rejects(github.pull('owner/contributor', 1), { code: 'PR_CHANGED_DURING_READ' });
});
test('preview uses a separate hostname, blocks unexpected Host and adds enforced browser isolation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-review-preview-'));
  writeFiles(path.join(root, 'dist'), { 'index.html': Buffer.from('<html>Preview fixture</html>') });
  const runtime = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', expiresAt: Date.now() + 10000, backendUrl: 'http://127.0.0.1:1' };
  const gateway = await openGateway(runtime, root, { digest: 'fixture', revision: 1 }); const url = new URL(gateway.url);
  const get = host => new Promise((resolve, reject) => { http.get({ hostname: '127.0.0.1', port: url.port, path: '/', headers: { Host: host } }, response => {
    let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
  }).on('error', reject); });
  try {
    assert.match(url.hostname, /^preview-.*\.localhost$/); assert.equal((await get(`localhost:${url.port}`)).status, 403);
    const response = await get(url.host); assert.equal(response.status, 200); assert.match(response.text, /Preview fixture/);
    assert.match(response.headers['content-security-policy'], /connect-src 'self'/); assert.equal(response.headers['referrer-policy'], 'no-referrer');
  } finally { gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve)); if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true }); }
});
