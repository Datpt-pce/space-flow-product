const fs = require('fs');
const path = require('path');
const { docker, waitReady } = require('./docker');
const { within, removeWorkspace, runProcess, executable, cleanEnv } = require('./process');
const { hash } = require('./policy');
const { requireValue, ReviewError } = require('./errors');

function validateTarget(target) {
  requireValue(target && /^[a-z0-9][a-z0-9-]{0,48}$/.test(target.id) && typeof target.name === 'string' &&
    ['docker-staging', 'command'].includes(target.kind) && typeof target.platform === 'string', 'TARGET_CONFIG', 'Target phát hành chưa được cấu hình hợp lệ.');
  if (target.kind === 'docker-staging') requireValue(target.platform === 'linux/amd64' && Number.isSafeInteger(target.backendPort) && target.backendPort >= 1024 && target.backendPort <= 65535,
    'TARGET_CONFIG', 'Target staging cần Linux amd64 và cổng backend hợp lệ.');
  if (target.kind === 'command') {
    requireValue(target.operatorRoot && path.isAbsolute(target.operatorRoot) && target.commands && ['backup', 'activate', 'inspect', 'restore'].every(action =>
      target.commands[action]?.command && Array.isArray(target.commands[action].args)), 'TARGET_CONFIG', 'Target cần adapter backup/activate/inspect/restore do owner cấu hình.');
    for (const key of ['healthUrl', 'smokeUrl']) {
      let url; try { url = new URL(target[key]); } catch { /* checked below */ }
      requireValue(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'TARGET_CONFIG', `Target thiếu ${key} hợp lệ.`);
    }
  }
  return target;
}
function targetFingerprint(target) {
  validateTarget(target);
  return hash({ target, envDigest: target.envFile ? hash(fs.readFileSync(target.envFile)) : null });
}
function checkTree(root) {
  let count = 0; let bytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const target = within(root, path.join(directory, name)); const stat = fs.lstatSync(target);
      requireValue(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), 'BACKUP_LINK', 'State chứa link hoặc file đặc biệt; không snapshot tự động.');
      if (stat.isDirectory()) visit(target); else { count++; bytes += stat.size; }
      requireValue(count <= 100000 && bytes <= 1024 ** 3, 'BACKUP_LIMIT', 'State staging vượt giới hạn snapshot 1 GiB.');
    }
  }
  if (fs.existsSync(root)) visit(root);
}
class DockerStagingAdapter {
  constructor(config, target) { this.config = config; this.target = validateTarget(target); }
  paths(operationId) {
    requireValue(/^[a-f0-9-]{36}$/.test(operationId), 'RELEASE_ID', 'Lần phát hành không hợp lệ.');
    const root = within(this.config.workspaceRoot, path.join(this.config.workspaceRoot, 'targets', this.target.id));
    const state = within(root, path.join(root, 'state')); const snapshot = within(root, path.join(root, 'recovery', operationId));
    return { root, state, snapshot, name: `sf-review-release-${this.target.id}`, previousName: `sf-review-release-${this.target.id}-before-${operationId.slice(0, 8)}` };
  }
  async info(name) {
    const result = await runProcess('docker', ['inspect', name]);
    if (result.code !== 0) return null; return JSON.parse(result.output)[0];
  }
  async backup(context) {
    const locations = this.paths(context.operationId); fs.mkdirSync(locations.root, { recursive: true });
    requireValue(!fs.existsSync(locations.snapshot), 'BACKUP_EXISTS', 'Snapshot của lần phát hành đã tồn tại; cần đối soát trước.');
    const old = await this.info(locations.name);
    if (old) {
      requireValue(old.Config.Labels?.['sf.review.target'] === this.target.id, 'TARGET_OWNERSHIP', 'Container target không thuộc bộ phát hành này.');
      await docker(['stop', '--time', '30', locations.name]); await docker(['rename', locations.name, locations.previousName]);
    }
    try {
      checkTree(locations.state); fs.mkdirSync(locations.snapshot, { recursive: true });
      if (fs.existsSync(locations.state)) fs.cpSync(locations.state, path.join(locations.snapshot, 'state'), { recursive: true, dereference: false });
      const receipt = { operationId: context.operationId, snapshotId: context.operationId, previousImageId: old?.Image || null, previousName: old ? locations.previousName : null,
        stateExisted: fs.existsSync(locations.state), completedAt: Date.now(), recoveryReady: true };
      fs.writeFileSync(path.join(locations.snapshot, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 }); return receipt;
    } catch (error) {
      if (old) { await docker(['rename', locations.previousName, locations.name]).catch(() => {}); await docker(['start', locations.name]).catch(() => {}); }
      throw error;
    }
  }
  async activate(context) {
    const locations = this.paths(context.operationId); fs.mkdirSync(locations.state, { recursive: true });
    requireValue(!locations.state.includes(','), 'TARGET_PATH', 'Target path không hợp lệ cho Docker mount.');
    const args = ['run', '-d', '--name', locations.name, '--label', `sf.review.target=${this.target.id}`, '--label', `sf.review.operation=${context.operationId}`,
      '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--label', `sf.review.digest=${context.digest}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--cpus', '2', '--memory', '2g',
      '--tmpfs', '/tmp:rw,exec,size=512m,uid=1000,gid=1000', '--tmpfs', '/app/logs:rw,noexec,size=128m,uid=1000,gid=1000', '--mount', `type=bind,source=${locations.state},target=/state`,
      '-p', `127.0.0.1:${this.target.backendPort}:4001`, '-e', 'SF_DATA_DIR=/state', '-e', 'SF_BIND_HOST=0.0.0.0', '-e', 'SF_MIN_FREE_BYTES=0',
      '-e', 'SF_REVIEW_WORKER_AUTOSTART=0', '-e', 'DEV_LOGIN_ENABLED=false', '-e', 'NODE_ENV=production'];
    if (this.target.envFile) args.push('--env-file', this.target.envFile);
    args.push(context.candidate.imageId); await docker(args); return { operationId: context.operationId, status: 'activated', digest: context.digest };
  }
  async inspect(context) {
    const current = await this.info(this.paths(context.operationId).name);
    if (!current?.State?.Running) return { status: 'unavailable', health: false, smoke: false, digest: current?.Config?.Labels?.['sf.review.digest'] || null };
    let healthy = false; try { await waitReady(`http://127.0.0.1:${this.target.backendPort}`, null, 20000); healthy = true; } catch { /* report */ }
    let smoke = false;
    try { const response = await fetch(`http://127.0.0.1:${this.target.backendPort}/api/auth/config`, { redirect: 'error', signal: AbortSignal.timeout(5000) }); const body = await response.json(); smoke = response.ok && Object.hasOwn(body, 'googleClientId'); } catch { /* report */ }
    return { status: healthy && smoke ? 'ready' : 'unavailable', imageId: current.Image, digest: current.Config.Labels?.['sf.review.digest'], health: healthy, smoke,
      operationId: current.Config.Labels?.['sf.review.operation'] };
  }
  async restore(context) {
    const locations = this.paths(context.operationId);
    const receipt = context.backup || JSON.parse(fs.readFileSync(path.join(locations.snapshot, 'receipt.json'), 'utf8'));
    requireValue(receipt.operationId === context.operationId && receipt.recoveryReady, 'RECOVERY_MISSING', 'Snapshot phục hồi không khớp.');
    const current = await this.info(locations.name);
    if (current) { requireValue(current.Config.Labels?.['sf.review.operation'] === context.operationId, 'RECOVERY_CONFLICT', 'Target đã có phát hành khác.'); await docker(['rm', '-f', locations.name]); }
    const saved = path.join(locations.snapshot, 'state'); if (receipt.stateExisted) checkTree(saved);
    if (fs.existsSync(locations.state)) removeWorkspace(locations.root, locations.state);
    if (receipt.stateExisted) fs.cpSync(saved, locations.state, { recursive: true, dereference: false }); else fs.mkdirSync(locations.state, { recursive: true });
    if (receipt.previousName) { await docker(['rename', receipt.previousName, locations.name]); await docker(['start', locations.name]); await waitReady(`http://127.0.0.1:${this.target.backendPort}`); }
    return { operationId: context.operationId, status: 'rolled_back', recovered: true, previousImageId: receipt.previousImageId };
  }
}
class CommandReleaseAdapter {
  constructor(config, target) { this.config = config; this.target = validateTarget(target); }
  async invoke(action, context) {
    const spec = this.target.commands[action]; const directory = path.resolve(this.target.operatorRoot);
    requireValue(!directory.startsWith(path.join(this.config.workspaceRoot, 'candidates') + path.sep), 'TARGET_COMMAND', 'Adapter không được lấy từ source candidate.');
    const untrustedRoot = path.resolve(this.config.workspaceRoot, 'candidates') + path.sep;
    requireValue(![spec.command, ...spec.args].some(value => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value).startsWith(untrustedRoot)),
      'TARGET_COMMAND', 'Lệnh triển khai không được trỏ vào script của candidate.');
    const result = await runProcess(executable(spec.command), spec.args, { cwd: directory, env: cleanEnv(), input: JSON.stringify({ schemaVersion: 1, action, ...context }) + '\n',
      timeoutMs: Math.min(this.target.timeoutMs || 180000, 600000), maxBytes: 64000 });
    requireValue(result.code === 0, 'TARGET_COMMAND_FAILED', 'Adapter target chưa hoàn tất; cần đối soát kết quả.');
    let receipt; try { receipt = JSON.parse(result.output); } catch { throw new ReviewError('TARGET_RECEIPT', 'Adapter thiếu receipt JSON hợp lệ.'); }
    requireValue(receipt.operationId === context.operationId, 'TARGET_RECEIPT', 'Receipt không thuộc lần phát hành hiện tại.'); return receipt;
  }
  backup(context) { return this.invoke('backup', context); }
  activate(context) { return this.invoke('activate', context); }
  restore(context) { return this.invoke('restore', context); }
  async inspect(context) {
    const receipt = await this.invoke('inspect', context);
    for (const [field, url] of [['health', this.target.healthUrl], ['smoke', this.target.smokeUrl]]) {
      try { receipt[field] = (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) })).ok; } catch { receipt[field] = false; }
    }
    return receipt;
  }
}
function createAdapter(config, target) { return target.kind === 'docker-staging' ? new DockerStagingAdapter(config, target) : new CommandReleaseAdapter(config, target); }
module.exports = { validateTarget, targetFingerprint, DockerStagingAdapter, CommandReleaseAdapter, createAdapter, checkTree };
