const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runProcess, within } = require('./process');
const { writeFiles, safeName, manifestFor, verifyManifest } = require('./source');
const { hash } = require('./policy');
const { requireValue, ReviewError } = require('./errors');

async function docker(args, options = {}) {
  const result = await runProcess('docker', args, { timeoutMs: 120000, maxBytes: 2000000, ...options });
  if (result.code !== 0) {
    const error = new ReviewError('DOCKER_FAILED', 'Docker chưa hoàn tất tác vụ. Xem trạng thái sandbox và cấu hình image.', 503);
    error.diagnostic = (result.stderr || result.output).slice(-8000); throw error;
  }
  return result.output.trim();
}
const lockFiles = ['backend/package.json', 'backend/package-lock.json', 'nodes/package.json', 'nodes/package-lock.json', 'frontend/package.json', 'frontend/package-lock.json'];
function lockDigest(files) { return hash(Object.fromEntries(lockFiles.map(name => { requireValue(files[name], 'DEPENDENCY_MANIFEST', `Thiếu ${name}.`); return [name, hash(files[name])]; }))); }
async function waitReady(url, signal, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ReviewError('CANCELLED', 'Đã dừng sandbox.');
    try { const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(2000), redirect: 'error' }); if (response.ok && (await response.json()).status === 'ready') return; } catch { /* retry bounded */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new ReviewError('SANDBOX_HEALTH', 'Ứng dụng candidate chưa sẵn sàng trong giới hạn thời gian.');
}
async function httpProof(url) {
  const request = async (route, options = {}) => fetch(url + route, { signal: AbortSignal.timeout(10000), redirect: 'manual', ...options });
  const unauth = await request('/api/nodes'); requireValue(unauth.status === 401, 'SANDBOX_AUTH', 'Candidate không giữ cổng đăng nhập API.');
  const login = await request('/api/auth/dev-login'); requireValue(login.status === 302, 'SANDBOX_LOGIN', 'Đăng nhập dữ liệu thử chưa hoạt động.');
  const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]);
  requireValue(cookies.some(value => value.startsWith('sf_session=')) && cookies.some(value => value.startsWith('sf_csrf=')), 'SANDBOX_COOKIE', 'Candidate thiếu session/CSRF cookie.');
  const headers = { Cookie: cookies.join('; ') };
  const nodes = await request('/api/nodes', { headers }); const catalog = await nodes.json();
  requireValue(nodes.ok && Array.isArray(catalog) && catalog.some(node => node.id === 'text'), 'SANDBOX_CATALOG', 'Candidate chưa tải được catalog node.');
  const csrf = await request('/api/contributions/jobs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'must not be created without CSRF' }) });
  requireValue(csrf.status === 403, 'SANDBOX_CSRF', 'Candidate không giữ cổng CSRF.');
  const csrfToken = cookies.find(value => value.startsWith('sf_csrf=')).slice('sf_csrf='.length);
  const run = await request('/api/execute', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrfToken) },
    body: JSON.stringify({ workflow: { nodes: [{ id: 'smoke-text', type: 'text', config: { content: 'sf-candidate-smoke' } }], edges: [] } }) });
  requireValue(run.ok, 'SANDBOX_EXECUTION', 'Candidate không khởi động được workflow mẫu.');
  const stream = await run.text(); requireValue(stream.length < 100000, 'SANDBOX_EXECUTION', 'Workflow mẫu trả quá nhiều dữ liệu.');
  const events = stream.split('\n\n').map(block => ({ event: block.split('\n').find(line => line.startsWith('event: '))?.slice(7),
    data: block.split('\n').find(line => line.startsWith('data: '))?.slice(6) }));
  const complete = events.find(event => event.event === 'nodeComplete' && JSON.parse(event.data).nodeId === 'smoke-text');
  requireValue(complete && JSON.parse(complete.data).outputs?.text === 'sf-candidate-smoke' && events.some(event => event.event === 'done'), 'SANDBOX_EXECUTION', 'Output workflow Text chưa khớp ca regression.');
  return { authenticatedCatalog: true, unauthenticatedDenied: true, csrfDenied: true, textWorkflow: true, nodeCount: catalog.length };
}
class DockerSandbox {
  constructor(config) { this.config = config; this.setupStatus = null; }
  async doctor() {
    try {
      const version = JSON.parse(await docker(['version', '--format', '{{json .Server}}']));
      const image = this.config.read().sandboxImage;
      if (!image) return { ready: false, available: true, version: version.Version, message: 'Cần chuẩn bị image dependency tin cậy.' };
      const info = JSON.parse(await docker(['image', 'inspect', image]))[0];
      return { ready: info.Os === 'linux' && !!info.Config?.Labels?.['sf.review.locks'], available: true, version: version.Version,
        imageId: info.Id, platform: `${info.Os}/${info.Architecture}`, setup: this.setupStatus };
    } catch (error) { return { ready: false, available: false, message: error.message, code: error.code || 'DOCKER_MISSING', setup: this.setupStatus }; }
  }
  async setup(files) {
    requireValue(!this.setupStatus || this.setupStatus.status !== 'running', 'SANDBOX_SETUP_BUSY', 'Đang chuẩn bị image.');
    const digest = lockDigest(files); const config = this.config.read();
    const directory = within(config.workspaceRoot, path.join(config.workspaceRoot, 'images', digest)); fs.mkdirSync(directory, { recursive: true });
    const copied = Object.fromEntries(lockFiles.map(name => [name, files[name]]));
    copied.Dockerfile = fs.readFileSync(path.join(__dirname, 'sandbox/Dockerfile'));
    for (const name of ['idle.cjs', 'export-dist.cjs', 'test-file.cjs']) copied[`trusted/${name}`] = fs.readFileSync(path.join(__dirname, 'sandbox', name));
    writeFiles(directory, copied); const image = `space-flow-review-deps:${digest.slice(0, 16)}`;
    this.setupStatus = { status: 'running', startedAt: Date.now() };
    try {
      await docker(['build', '--label', `sf.review.locks=${digest}`, '--label', 'sf.review.trusted=1', '-t', image, directory], { timeoutMs: 20 * 60000, maxBytes: 6000000 });
      const info = JSON.parse(await docker(['image', 'inspect', image]))[0];
      requireValue(info.Os === 'linux' && info.Architecture === 'amd64', 'SANDBOX_PLATFORM', 'Image review hiện cần Linux amd64.');
      // Pin the immutable local image ID, not its mutable tag.
      this.config.write({ ...this.config.read(), sandboxImage: info.Id });
      this.setupStatus = { status: 'completed', imageId: info.Id, completedAt: Date.now() }; return this.setupStatus;
    } catch (error) { this.setupStatus = { status: 'failed', code: error.code || 'SETUP_FAILED', completedAt: Date.now() }; throw error; }
  }
  async build(directory, files, changedFiles, signal) {
    const config = this.config.read(); const info = JSON.parse(await docker(['image', 'inspect', config.sandboxImage]))[0];
    requireValue(info.Config?.Labels?.['sf.review.locks'] === lockDigest(files), 'DEPENDENCY_BASELINE', 'Dependency khác image tin cậy. Cần owner chuẩn bị lại image trước.');
    const source = path.join(directory, 'source'); const name = `sf-review-build-${crypto.randomUUID()}`;
    requireValue(!source.includes(','), 'DOCKER_PATH', 'Workspace Docker không được chứa dấu phẩy.');
    const testResults = []; const startedAt = Date.now();
    try {
      await docker(['run', '-d', '--name', name, '--label', 'sf.review.ephemeral=1', '--label', `sf.review.machine=${config.machineId}`,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--cpus', '2', '--memory', '6g',
        '--tmpfs', '/work:rw,exec,size=4g,uid=1000,gid=1000', '--tmpfs', '/tmp:rw,exec,size=512m,uid=1000,gid=1000',
        '--tmpfs', '/opt/deps/frontend/node_modules/.vite-temp:rw,exec,size=64m,uid=1000,gid=1000',
        '--mount', `type=bind,source=${source},target=/source,readonly`, info.Id], { signal });
      let initialized = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if ((await docker(['logs', name], { signal })).includes('SF_REVIEW_READY')) { initialized = true; break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      requireValue(initialized, 'SANDBOX_INIT', 'Sandbox chưa hoàn tất khởi tạo.');
      const build = await runProcess('docker', ['exec', name, 'node', '/opt/deps/frontend/node_modules/vite/bin/vite.js', 'build', '/work/frontend'],
        { signal, timeoutMs: 300000, maxBytes: 4000000 });
      if (build.code !== 0) { const error = new ReviewError('CANDIDATE_BUILD', 'Frontend candidate build thất bại. Source vẫn giữ nguyên; sửa PR rồi đánh giá lại.');
        error.diagnostic = (build.stderr + '\n' + build.output).slice(-8000); throw error; }
      // Execute adjacent regression tests and an invariant suite from the owner baseline.
      const tests = new Set(['backend/contributions/domain.test.js']);
      for (const filename of changedFiles) {
        if (/\.test\.(js|mjs|cjs)$/.test(filename)) tests.add(filename);
        const adjacent = /\.(js|mjs|cjs)$/.test(filename) ? filename.replace(/\.(js|mjs|cjs)$/, '.test.js') : null;
        if (adjacent && files[adjacent]) tests.add(adjacent);
        if (filename.endsWith('.py')) {
          const syntax = await runProcess('docker', ['exec', name, 'python', '-m', 'py_compile', `/work/${filename}`], { signal, timeoutMs: 30000 });
          requireValue(syntax.code === 0, 'CANDIDATE_TEST', `Python syntax chưa đạt: ${filename}.`); testResults.push({ file: filename, kind: 'python-syntax', passed: true });
        }
      }
      for (const filename of tests) {
        if (!files[filename]) continue;
        const tested = await runProcess('docker', ['exec', name, 'node', '/trusted/test-file.cjs', `/work/${filename}`], { signal, timeoutMs: 90000, maxBytes: 2000000 });
        requireValue(tested.code === 0, 'CANDIDATE_TEST', `Regression test chưa đạt: ${filename}.`); testResults.push({ file: filename, kind: 'node-test', passed: true });
      }
      const output = await docker(['exec', name, 'node', '/trusted/export-dist.cjs'], { signal, maxBytes: 115 * 1024 * 1024 });
      const encoded = JSON.parse(output); const dist = {}; let size = 0;
      for (const [filename, content] of Object.entries(encoded)) {
        requireValue(safeName(filename) && typeof content === 'string', 'ARTIFACT_PATH', 'Build tạo đường dẫn không hợp lệ.');
        const bytes = Buffer.from(content, 'base64'); size += bytes.length;
        requireValue(bytes.length <= 16 * 1024 * 1024 && size <= 80 * 1024 * 1024, 'ARTIFACT_SIZE', 'Build vượt giới hạn artifact.');
        dist[filename] = bytes;
      }
      requireValue(dist['index.html'] && Object.keys(dist).length <= 4096, 'ARTIFACT_MISSING', 'Build thiếu entrypoint.');
      writeFiles(path.join(directory, 'dist'), dist);
      // BuildKit resolves FROM as an image reference, not a bare local image ID.
      // Give that ID a content-named tag, then verify the resulting base layers.
      const pinnedBase = `space-flow-review-pinned:${info.Id.replace('sha256:', '')}`;
      await docker(['tag', info.Id, pinnedBase]);
      const runtimeRecipe = `FROM ${pinnedBase}\nUSER root\nWORKDIR /app\nCOPY --chown=node:node source/ /app/\nCOPY --chown=node:node dist/ /app/frontend/dist/\n` +
        'RUN ln -s /opt/deps/backend/node_modules /app/backend/node_modules && ln -s /opt/deps/nodes/node_modules /app/nodes/node_modules && chmod -R a+rX /app\nUSER node\n' +
        'ENV PORT=4001 SF_DATA_DIR=/tmp/state SF_IMPORT_LEGACY=0 SF_REVIEW_WORKER_AUTOSTART=0 SPACE_FLOW_MODE=agent CENTRAL_SERVER_URL=\nCMD ["node","/app/backend/server.js"]\n';
      fs.writeFileSync(path.join(directory, 'Dockerfile'), runtimeRecipe);
      const tag = `space-flow-candidate:${hash(manifestFor(files)).slice(0, 20)}-${crypto.randomBytes(3).toString('hex')}`;
      await docker(['build', '--network', 'none', '-t', tag, directory], { signal, timeoutMs: 300000, maxBytes: 2000000 });
      const image = JSON.parse(await docker(['image', 'inspect', tag]))[0];
      requireValue(info.RootFS.Layers.every((layer, index) => image.RootFS.Layers[index] === layer), 'DEPENDENCY_IMAGE_CHANGED', 'Base image đã đổi trong lúc đóng gói.');
      return { imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, distManifest: manifestFor(dist), tests: testResults,
        buildMs: Date.now() - startedAt, dependencyImage: info.Id };
    } finally { await docker(['rm', '-f', name]).catch(() => {}); }
  }
  async startRuntime(candidate, { ttlMs = 60 * 60000, signal } = {}) {
    const config = this.config.read(); const id = crypto.randomUUID(); const name = `sf-review-preview-${id}`; const network = `sf-review-net-${id}`; const gatewayName = `sf-review-access-${id}`;
    const image = JSON.parse(await docker(['image', 'inspect', candidate.imageId]))[0];
    requireValue(image.Id === candidate.imageId, 'ARTIFACT_CHANGED', 'Image candidate không còn khớp.');
    await docker(['network', 'create', '--internal', '--label', `sf.review.machine=${config.machineId}`, network]);
    try {
      await docker(['run', '-d', '--name', name, '--label', 'sf.review.ephemeral=1', '--label', `sf.review.machine=${config.machineId}`,
        '--label', `sf.review.expires=${Date.now() + ttlMs}`, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '256', '--cpus', '2', '--memory', '2g', '--tmpfs', '/tmp:rw,exec,size=1g,uid=1000,gid=1000', '--tmpfs', '/app/logs:rw,noexec,size=128m,uid=1000,gid=1000',
        '-e', 'SF_BIND_HOST=0.0.0.0', '-e', 'DEV_LOGIN_ENABLED=true', '-e', 'SF_REVIEW_OWNER_EMAIL=dev@space-flow.local',
        '-e', 'SF_MIN_FREE_BYTES=0', '-e', 'NODE_ENV=development', '-e', `CREDENTIALS_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`,
        '-e', `SIGNING_KEY_PASSPHRASE=${crypto.randomBytes(32).toString('hex')}`, candidate.imageId], { signal });
      // Docker Desktop does not publish ports on an internal-only network. A trusted
      // inbound proxy joins both networks; IP forwarding is disabled and its sole
      // destination is this candidate. The candidate still has no egress route.
      const backendInfo = JSON.parse(await docker(['inspect', name]))[0];
      const backendIp = backendInfo.NetworkSettings.Networks[network].IPAddress;
      requireValue(/^\d+\.\d+\.\d+\.\d+$/.test(backendIp), 'SANDBOX_NETWORK', 'Chưa xác minh địa chỉ nội bộ của candidate.');
      const proxyCode = "const http=require('http');http.createServer((req,res)=>{if(!req.url.startsWith('/')||req.method==='CONNECT'){res.writeHead(400);return res.end();}const out=http.request({host:process.env.CANDIDATE_IP,port:4001,path:req.url,method:req.method,headers:req.headers,timeout:30000},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);up.on('error',()=>res.destroy());});out.on('timeout',()=>out.destroy());out.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(out);}).listen(4001,'0.0.0.0');";
      await docker(['run', '-d', '--name', gatewayName, '--label', 'sf.review.ephemeral=1', '--label', `sf.review.machine=${config.machineId}`,
        '--network', 'bridge', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--sysctl', 'net.ipv4.ip_forward=0',
        '--pids-limit', '32', '--cpus', '0.5', '--memory', '128m', '-p', '127.0.0.1::4001', '-e', `CANDIDATE_IP=${backendIp}`, config.sandboxImage, 'node', '-e', proxyCode], { signal });
      await docker(['network', 'connect', network, gatewayName]);
      const info = JSON.parse(await docker(['inspect', gatewayName]))[0]; const port = Number(info.NetworkSettings.Ports['4001/tcp']?.[0]?.HostPort);
      requireValue(Number.isSafeInteger(port) && port > 1024, 'SANDBOX_PORT', 'Không xác minh được cổng sandbox.');
      const result = { id, name, network, gatewayName, backendUrl: `http://127.0.0.1:${port}`, expiresAt: Date.now() + ttlMs };
      await waitReady(result.backendUrl, signal); return result;
    } catch (error) {
      const appLog = await runProcess('docker', ['logs', '--tail', '30', name]).catch(() => null);
      const proxyLog = await runProcess('docker', ['logs', '--tail', '10', gatewayName]).catch(() => null);
      error.diagnostic = [error.diagnostic, appLog?.stderr, appLog?.output, proxyLog?.stderr].filter(Boolean).join('\n').slice(-10000);
      await this.stopRuntime({ name, network, gatewayName }); throw error;
    }
  }
  async stopRuntime(runtime) {
    requireValue(/^sf-review-preview-[a-f0-9-]{36}$/.test(runtime.name) && /^sf-review-net-[a-f0-9-]{36}$/.test(runtime.network), 'SANDBOX_ID', 'Định danh sandbox không hợp lệ.');
    if (runtime.gatewayName) { requireValue(/^sf-review-access-[a-f0-9-]{36}$/.test(runtime.gatewayName), 'SANDBOX_ID', 'Định danh proxy không hợp lệ.'); await docker(['rm', '-f', runtime.gatewayName]).catch(() => {}); }
    await docker(['rm', '-f', runtime.name]).catch(() => {}); await docker(['network', 'rm', runtime.network]).catch(() => {});
  }
  async verify(candidate, directory) {
    verifyManifest(path.join(directory, 'source'), candidate.sourceManifest); verifyManifest(path.join(directory, 'dist'), candidate.distManifest);
    const info = JSON.parse(await docker(['image', 'inspect', candidate.imageId]))[0]; requireValue(info.Id === candidate.imageId, 'ARTIFACT_CHANGED', 'Image candidate đã đổi.');
    return true;
  }
}
module.exports = { DockerSandbox, docker, lockDigest, waitReady, httpProof };
