const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sourceFiles, writeFiles, manifestFor, verifyManifest } = require('./source');
const { runProcess, within, removeWorkspace } = require('./process');
const { hash } = require('./policy');
const { requireValue } = require('./errors');
const { toolkitFiles } = require('./toolkit');

function contributorFiles(sourceRoot = path.resolve(__dirname, '../..')) {
  const packageJson = { name: 'space-flow-contributor', version: '1.0.0', private: true,
    engines: { node: '>=24.16.0' }, scripts: { setup: 'node scripts/contributor-dev.cjs setup', dev: 'node scripts/contributor-dev.cjs dev',
      build: 'npm run build --prefix frontend', test: 'node --test backend/contributions/domain.test.js',
      'tools:setup': 'node scripts/contributor-tools.cjs setup', 'tools:doctor': 'node scripts/contributor-tools.cjs doctor', 'graph': 'node scripts/contributor-tools.cjs graph',
      'review:doctor': 'node scripts/review-console.js doctor', 'review:open': 'node scripts/review-console-start.js',
      'review:install': 'node scripts/install-review-console.js', 'review:worker': 'node scripts/review-console.js worker' } };
  const guide = `# Space Flow Contributor\n\nKho phát triển riêng dành cho người đóng góp. Mỗi đề xuất đi qua PR và owner review.\n\n` +
    `## Cài và chạy trên máy của bạn\n\nCài Git và Node.js 24.16 trở lên (nhánh 24 LTS). Clone repo này, mở Git Bash rồi chạy:\n\n` +
    '```bash\nnpm run setup\nnpm run dev\n```\n\n' +
    `Mở http://127.0.0.1:4174/api/auth/dev-login để đăng nhập bản local. Dùng một browser profile riêng; cookie không tách theo port.\n` +
    `Dữ liệu thử ở .contributor-state, backend 4101 và frontend 4174. Không ghép agent với server chung và không dùng credential production.\n` +
    `Các node dùng Python/FFmpeg cần runtime tương ứng trên máy; chỉ cài phần cần cho node bạn đang sửa.\n\n` +
    `## Bộ công cụ cho Codex và Claude\n\nĐọc AGENTS.md và docs/TOOLS.md. Chạy npm run tools:setup, npm run tools:doctor để cài Harness và Codegraph riêng trong repo này.\n\n## Gửi một thay đổi\n\n` +
    '```bash\ngit switch -c task/mo-ta-ngan\n# Sửa source, chạy kiểm tra phù hợp\nnpm test\nnpm run build\ngit add <file-da-sua>\ngit commit -m "feat: mo ta thay doi"\ngit push -u origin task/mo-ta-ngan\n```\n\n' +
    `Tạo Pull Request vào main, ghi mục tiêu, trước/sau, ca đã kiểm và ảnh UI nếu có. Chuyển PR khỏi Draft khi sẵn sàng review.\n` +
    `Owner xem báo cáo riêng, gửi phản hồi vào PR hoặc trong ứng dụng. PR mới cập nhật sẽ làm mất hiệu lực review và duyệt cũ.\n\n` +
    `## Phạm vi và baseline\n\nGiữ thay đổi trong frontend/, backend/, nodes/, shared/; bằng chứng ở docs/changes/<ten-ngan>.md (tối đa 32 KB, không đưa vào runtime). Không sửa contributor-baseline.json hoặc worker/control policy.\n` +
    `Thay dependency, build recipe hoặc cấu hình triển khai cần owner cập nhật baseline tin cậy trước. Không gửi .env, token, DB, uploads hoặc dữ liệu người dùng.\n` +
    `Commit chỉ lưu code trong repo contributor; không phải lệnh deploy. Không sử dụng hướng dẫn riêng hoặc lịch sử của repo owner.\n` +
    `Khi owner phát baseline mới, fetch main và rebase nhánh của bạn; xử lý conflict trước khi yêu cầu đánh giá lại.\n`;
  const launcher = `const fs = require('fs');\nconst path = require('path');\nconst { spawn } = require('child_process');\nconst root = path.resolve(__dirname, '..');\n` +
    `const npm = process.env.npm_execpath;\nif (!npm) throw new Error('Chạy bằng npm run setup hoặc npm run dev');\n` +
    `function run(file,args,env){return spawn(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});}\n` +
    `async function main(){\nif(process.argv[2]==='setup'){for(const dir of ['backend','nodes','frontend']){const code=await new Promise((resolve,reject)=>{const child=run(npm,['ci','--prefix',dir],process.env);child.on('error',reject);child.on('close',resolve);});if(code!==0)process.exit(code||1);}return;}\n` +
    `const state=path.join(root,'.contributor-state');fs.mkdirSync(state,{recursive:true});\n` +
    `const env={...process.env,NODE_ENV:'development',DEV_LOGIN_ENABLED:'true',SF_REVIEW_OWNER_EMAIL:'dev@space-flow.local',SF_REVIEW_WORKER_AUTOSTART:'0',SF_DATA_DIR:state,SF_IMPORT_LEGACY:'0',SPACE_FLOW_MODE:'agent',CENTRAL_SERVER_URL:'',SF_BIND_HOST:'127.0.0.1',PORT:'4101',BACKEND_HOST:'127.0.0.1',BACKEND_PORT:'4101',FRONTEND_PORT:'4174',CORS_ORIGINS:'http://127.0.0.1:4174'};\n` +
    `for(const name of ['SF_GITHUB_TOKEN','SF_REVIEW_WORKSPACE','SF_UPLOADS_DIR','SF_WORKFLOWS_DIR','AGENT_TOKEN'])delete env[name];\n` +
    `const children=[run('backend/server.js',[],env),run('frontend/node_modules/vite/bin/vite.js',['frontend','--host','127.0.0.1'],env)];\n` +
    `let stopping=false;function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}\n` +
    `for(const child of children){child.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});child.on('close',code=>{stop();process.exitCode=code||0;});}process.once('SIGINT',stop);process.once('SIGTERM',stop);\n` +
    `console.log('Contributor local: http://127.0.0.1:4174/api/auth/dev-login — dùng browser profile riêng.');}\nmain().catch(error=>{console.error(error.message);process.exitCode=1;});\n`;
  return { 'package.json': Buffer.from(JSON.stringify(packageJson, null, 2) + '\n'), 'README.md': Buffer.from(guide), 'CONTRIBUTING.md': Buffer.from(guide),
    ...toolkitFiles(sourceRoot),
    '.gitignore': Buffer.from('node_modules/\ndist/\n.contributor-tools/\n.code-review-graph/\nscripts/bin/\nharness.db*\n.contributor-state/\n.env\n.env.*\n*.log\n*.sqlite*\n*.db\n__pycache__/\nbackend/uploads/\nbackend/workflows/\nbackend/config/review-console.json\nbackend/config/review-workspace/\n'),
    'scripts/contributor-dev.cjs': Buffer.from(launcher),
    'OWNER-CONSOLE.md': Buffer.from('# Console trên máy owner thứ hai\n\nChỉ owner có quyền đọc kho control thực hiện các bước này. Contributor chỉ cần README.md.\n\n' +
      'Cài Git, Node.js 24.16+, Docker Desktop và hai CLI Codex/Claude. Đăng nhập GitHub bằng Git Credential Manager; đăng nhập từng CLI bằng tài khoản của owner. Không chép token từ máy khác.\n\n' +
      'Clone repo contributor, chạy `npm run setup`, `npm run build`. Tạo `.env` local với `SF_REVIEW_OWNER_EMAIL=dev@space-flow.local` (phải trùng owner trong control repo).\n\n' +
      'Chạy `node scripts/review-console.js connect`, `npm run review:doctor`, `node scripts/review-console.js sandbox-setup`, `node scripts/review-console.js staging-setup`, `npm run review:install`, rồi `npm run review:open`.\n\n' +
      'Bật worker trong Máy & cài đặt. GitHub giữ hàng đợi khi hai máy tắt. Việc model bị ngắt sẽ chờ owner tiếp tục; không tự gọi lại làm tốn quota. Candidate/preview/target thuộc máy tạo nó; tạo lại candidate trên máy hiện tại khi cần.\n\n' +
      'Sau pull baseline mới, chạy lại setup/build và tắt/mở console. Không sao chép controller-state, review-console.json hoặc artifact giữa hai máy.\n') };
}
async function git(directory, args) {
  const result = await runProcess('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args],
    { cwd: directory, env: { ...require('./process').cleanEnv(), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, timeoutMs: 120000, maxBytes: 2000000 });
  requireValue(result.code === 0, 'DISTRIBUTION_GIT', 'Git chưa hoàn tất thao tác gói contributor. Kiểm tra quyền, conflict và kết nối.');
  return result.output.trim();
}
class ContributorDistribution {
  constructor(service) { this.service = service; }
  directory(id) {
    requireValue(/^base-[a-f0-9-]{36}$/.test(id), 'BASELINE_ID', 'Baseline không hợp lệ.', 400);
    return within(this.service.config.read().workspaceRoot, path.join(this.service.config.read().workspaceRoot, 'baselines', id));
  }
  async prepare(user) {
    this.service.requireOwner(user); const config = await this.service.effective();
    const source = await sourceFiles(config.sourceRoot); const id = `base-${crypto.randomUUID()}`;
    const directory = this.directory(id); const exported = { ...source.files, ...contributorFiles(config.sourceRoot) };
    // The owner CLI is useful on the second owner machine but never ships its auth/config.
    for (const name of ['review-console.js', 'review-console-start.js', 'install-review-console.js'])
      exported[`scripts/${name}`] = fs.readFileSync(path.join(config.sourceRoot, 'scripts', name));
    const ownerManifest = manifestFor(source.files); const publicManifest = manifestFor(exported);
    exported['contributor-baseline.json'] = Buffer.from(JSON.stringify({ schemaVersion: 1, id, files: publicManifest }, null, 2) + '\n');
    writeFiles(path.join(directory, 'source'), exported);
    const record = { id, createdAt: Date.now(), status: 'prepared', repository: config.sourceRepo, ownerManifest,
      publicManifest: manifestFor(exported), ownerDigest: hash(ownerManifest), fileCount: Object.keys(exported).length,
      excluded: source.excluded, publicHead: null };
    await this.service.store().mutate('baselines', id, old => { requireValue(!old, 'BASELINE_EXISTS', 'Baseline bị trùng.'); return record; });
    return { id, fileCount: record.fileCount, excludedCount: source.excluded.length, status: record.status, ownerDigest: record.ownerDigest };
  }
  async publish(user, id) {
    this.service.requireOwner(user); const config = await this.service.effective();
    const record = await this.service.store().get('baselines', id);
    requireValue(record?.repository === config.sourceRepo, 'BASELINE_REPOSITORY', 'Baseline không thuộc repository đang chọn.');
    if (record.status === 'published') return { id, publicHead: record.publicHead, status: record.status };
    requireValue(record.status === 'prepared', 'BASELINE_STATE', 'Baseline chưa sẵn sàng.');
    const repo = await this.service.github.repository(config.sourceRepo, true);
    requireValue(repo.private && repo.permissions?.push, 'SOURCE_ACCESS', 'Repo contributor phải Private và có quyền ghi.', 403);
    const directory = this.directory(id); const source = path.join(directory, 'source'); verifyManifest(source, record.publicManifest);
    const publishing = path.join(directory, 'publishing');
    if (record.publishAttempt) {
      const { publicHead, baseHead } = record.publishAttempt;
      requireValue(await git(publishing, ['rev-parse', 'HEAD']) === publicHead, 'PUBLISH_UNCERTAIN', 'Checkout xuất bản đã đổi; cần owner đối chiếu.');
      const observed = (await git(publishing, ['ls-remote', '--heads', 'origin', 'main'])).split(/\s/)[0];
      if (observed !== publicHead) {
        requireValue(observed === baseHead, 'PUBLISH_CONFLICT', 'Main contributor đã đổi; không tự ghi đè.');
        await git(publishing, ['push', '-u', 'origin', 'main']);
      }
      requireValue((await git(publishing, ['ls-remote', '--heads', 'origin', 'main'])).startsWith(publicHead), 'PUBLISH_UNCERTAIN', 'Chưa đọc lại được head sau publish.');
      await this.service.store().mutate('baselines', id, value => ({ ...value, status: 'published', publicHead, publishedAt: Date.now() }));
      return { id, publicHead, status: 'published', repository: config.sourceRepo, fileCount: record.fileCount };
    }
    // Before the durable attempt receipt no push can have happened. Rebuild only this
    // generated checkout after a failed init/fetch; preserve the immutable source copy.
    if (fs.existsSync(publishing)) removeWorkspace(directory, publishing);
    fs.mkdirSync(publishing, { recursive: true });
    await git(publishing, ['init', '-b', 'main']);
    await git(publishing, ['remote', 'add', 'origin', `https://github.com/${config.sourceRepo}.git`]);
    const refs = await git(publishing, ['ls-remote', '--heads', 'origin', 'main']);
    if (refs) {
      await git(publishing, ['fetch', '--depth=1', 'origin', 'main']);
      await git(publishing, ['checkout', '-B', 'main', 'FETCH_HEAD']);
      const oldFile = path.join(publishing, 'contributor-baseline.json');
      requireValue(fs.existsSync(oldFile), 'SOURCE_NOT_MANAGED', 'Repo đã có nội dung ngoài gói contributor; không tự ghi đè.');
      const prior = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
      requireValue(prior.schemaVersion === 1 && prior.id, 'SOURCE_NOT_MANAGED', 'Không xác minh được baseline hiện có.');
      const tracked = (await git(publishing, ['ls-files', '-z'])).split('\0').filter(Boolean);
      for (const filename of tracked) if (!Object.hasOwn(record.publicManifest, filename)) {
        const target = within(publishing, path.join(publishing, filename));
        requireValue(!fs.lstatSync(target).isSymbolicLink(), 'SOURCE_LINK', 'Repo contributor có symlink.'); fs.unlinkSync(target);
      }
    }
    const files = Object.fromEntries(Object.keys(record.publicManifest).map(name => [name, fs.readFileSync(within(source, path.join(source, name)))]));
    writeFiles(publishing, files); await git(publishing, ['add', '--all']);
    await git(publishing, ['-c', 'user.name=Space Flow Owner', '-c', `user.email=${config.ownerEmail}`, 'commit', '-m', `chore: publish contributor baseline ${id}`]);
    const publicHead = await git(publishing, ['rev-parse', 'HEAD']);
    await this.service.store().mutate('baselines', id, value => ({ ...value, publishAttempt: { publicHead, baseHead: refs.split(/\s/)[0] || '', startedAt: Date.now() } }));
    await git(publishing, ['push', '-u', 'origin', 'main']);
    const observed = await git(publishing, ['ls-remote', '--heads', 'origin', 'main']);
    requireValue(observed.startsWith(publicHead), 'PUBLISH_UNCERTAIN', 'Chưa xác minh được head sau khi publish.');
    await this.service.store().mutate('baselines', id, value => ({ ...value, status: 'published', publicHead, publishedAt: Date.now() }));
    return { id, publicHead, status: 'published', repository: config.sourceRepo, fileCount: record.fileCount };
  }
}
module.exports = { ContributorDistribution, contributorFiles, git };
