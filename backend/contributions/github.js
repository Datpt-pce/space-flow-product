const { spawn } = require('child_process');
const { ReviewError, fail, requireValue } = require('./errors');

function validateRepo(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(p => p === '.' || p === '..'),
    'INVALID_REPOSITORY', 'Repository phải có dạng owner/name.', 400);
  return value;
}
function gitCredential() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    let output = ''; let exceeded = false;
    const timeout = setTimeout(() => { child.kill(); reject(new ReviewError('GITHUB_AUTH', 'GitHub chưa đăng nhập trên máy này.', 503)); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 16384) { exceeded = true; child.kill(); } });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timeout); reject(new ReviewError('GITHUB_AUTH', 'Không tìm thấy Git Credential Manager.', 503)); });
    child.on('close', code => {
      clearTimeout(timeout);
      const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
      output = '';
      if (code !== 0 || !token || exceeded) reject(new ReviewError('GITHUB_AUTH', 'Cần đăng nhập GitHub bằng Git Credential Manager hoặc SF_GITHUB_TOKEN.', 503));
      else resolve(token);
    });
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}
function defaultToken() { return process.env.SF_GITHUB_TOKEN ? Promise.resolve(process.env.SF_GITHUB_TOKEN) : gitCredential(); }

class GitHubClient {
  constructor({ token = defaultToken, fetchImpl = fetch } = {}) {
    this.token = token; this.fetch = fetchImpl; this.repoCache = new Map();
  }
  async request(method, route, body, { text = false, missing = false, maxBytes = 2 * 1024 * 1024 } = {}) {
    requireValue(route.startsWith('/') && !route.includes('://'), 'GITHUB_PATH', 'Đường dẫn GitHub không hợp lệ.', 400);
    let response;
    try {
      response = await this.fetch(`https://api.github.com${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: text ? 'application/vnd.github.diff' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SpaceFlow-Contribution-Console', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      fail('GITHUB_OFFLINE', 'Không kết nối được GitHub. Hồ sơ giữ nguyên và chờ kết nối.', 503);
    }
    if (response.status === 404 && missing) return null;
    if (response.status === 409 || response.status === 422) fail('GITHUB_CONFLICT', 'GitHub từ chối cập nhật do dữ liệu đã đổi hoặc chưa hợp lệ.');
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'))
      fail('GITHUB_QUOTA', 'Đã tới hạn mức GitHub. Chờ hạn mức được cấp lại.', 429);
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'GITHUB_AUTH' : 'GITHUB_FAILED',
      `GitHub trả HTTP ${response.status}. Kiểm tra quyền repository và kết nối.`, response.status === 401 || response.status === 403 ? 403 : 502);
    if (response.status === 204) return null;
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      requireValue(size <= maxBytes, 'GITHUB_SIZE', 'Nội dung GitHub quá lớn cho một lần đánh giá.', 413);
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks).toString('utf8');
    if (text) return data;
    try { return JSON.parse(data); } catch { fail('GITHUB_INVALID', 'GitHub trả nội dung không hợp lệ.', 502); }
  }
  async repository(repo, fresh = false) {
    validateRepo(repo);
    const old = this.repoCache.get(repo);
    if (!fresh && old && Date.now() - old.at < 30000) return old.value;
    const value = await this.request('GET', `/repos/${repo}`);
    this.repoCache.set(repo, { at: Date.now(), value }); return value;
  }
  content(repo, path, ref) {
    validateRepo(repo);
    requireValue(!path.split('/').some(p => !p || p === '.' || p === '..'), 'GITHUB_PATH', 'Đường dẫn hồ sơ không hợp lệ.', 400);
    return this.request('GET', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, null, { missing: true });
  }
  putContent(repo, path, text, sha) {
    validateRepo(repo);
    return this.request('PUT', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
      { message: `chore: update contribution ${path}`, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
  }
  async pulls(repo) {
    validateRepo(repo);
    return this.request('GET', `/repos/${repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`);
  }
  async pull(repo, number) {
    validateRepo(repo);
    requireValue(Number.isSafeInteger(number) && number > 0, 'INVALID_PR', 'Số PR không hợp lệ.', 400);
    const pr = await this.request('GET', `/repos/${repo}/pulls/${number}`);
    requireValue(pr.changed_files <= 100, 'PR_TOO_LARGE', 'PR có hơn 100 file. Hãy chia thành các đề xuất nhỏ hơn.', 413);
    const files = await this.request('GET', `/repos/${repo}/pulls/${number}/files?per_page=100`);
    requireValue(files.length === pr.changed_files, 'PR_INCOMPLETE', 'Chưa lấy đủ các file của PR.');
    const patch = await this.request('GET', `/repos/${repo}/pulls/${number}`, null, { text: true, maxBytes: 256 * 1024 });
    const latest = await this.request('GET', `/repos/${repo}/pulls/${number}`);
    requireValue(latest.head.sha === pr.head.sha && latest.base.sha === pr.base.sha && latest.updated_at === pr.updated_at,
      'PR_CHANGED_DURING_READ', 'PR đổi trong khi đọc diff. Đồng bộ lại trước khi đánh giá.');
    return { pr, files, patch };
  }
  async createControl(repo) {
    validateRepo(repo);
    const [owner, name] = repo.split('/');
    const user = await this.request('GET', '/user');
    requireValue(user.login.toLowerCase() === owner.toLowerCase(), 'GITHUB_OWNER', 'Tạo kho control cần tài khoản owner tương ứng.', 403);
    const existing = await this.request('GET', `/repos/${repo}`, null, { missing: true });
    if (existing) {
      requireValue(existing.private && existing.permissions?.admin, 'CONTROL_REPO_ACCESS', 'Kho control hiện có phải Private và thuộc quyền quản trị của bạn.', 403);
      return existing;
    }
    return this.request('POST', '/user/repos', { name, private: true, auto_init: true,
      description: 'Private Space Flow contribution control records; owner access only', has_issues: false, has_projects: false, has_wiki: false });
  }
  comment(repo, number, body) {
    validateRepo(repo);
    requireValue(Number.isSafeInteger(number) && number > 0 && typeof body === 'string' && body.length <= 10000, 'INVALID_FEEDBACK', 'Phản hồi không hợp lệ.', 400);
    return this.request('POST', `/repos/${repo}/issues/${number}/comments`, { body });
  }
}
module.exports = { GitHubClient, gitCredential, defaultToken, validateRepo };
