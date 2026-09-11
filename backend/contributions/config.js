const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validatePolicy } = require('./policy');
const { validateRepo } = require('./github');
const { requireValue } = require('./errors');

class ReviewConfig {
  constructor({ file, env = process.env, root = path.resolve(__dirname, '../..') } = {}) {
    this.file = file || env.SF_REVIEW_CONFIG || path.join(require('../utils/dataPaths').config, 'review-console.json');
    this.env = env; this.root = root;
  }
  defaults() {
    return { schemaVersion: 1, ownerEmail: this.env.SF_REVIEW_OWNER_EMAIL ||
      ((this.env.NODE_ENV !== 'production' && this.env.DEV_LOGIN_ENABLED === 'true') ? 'dev@space-flow.local' : (this.env.ADMIN_EMAILS || '').split(',')[0].trim()),
    sourceRepo: 'Datpt-pce/space-flow-contributor', controlRepo: 'Datpt-pce/space-flow-control', storageMode: 'local',
    machineId: this.env.SF_REVIEW_MACHINE_ID || null, machineName: require('os').hostname(), workerEnabled: false,
    sourceRoot: this.root, workspaceRoot: path.resolve(this.env.SF_REVIEW_WORKSPACE || path.join(require('../utils/dataPaths').config, 'review-workspace')),
    pollMs: 60000, leaseMs: 240000, policy: validatePolicy(), contributorBindings: {},
    codexPath: this.env.SF_CODEX_PATH || 'codex', claudePath: this.env.SF_CLAUDE_PATH || 'claude',
    sandboxImage: this.env.SF_REVIEW_SANDBOX_IMAGE || '', releaseTargets: [] };
  }
  read() {
    const defaults = this.defaults();
    if (!fs.existsSync(this.file)) return defaults;
    const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    requireValue(saved.schemaVersion === 1, 'CONFIG_VERSION', 'Cấu hình review chưa được hỗ trợ.');
    return { ...defaults, ...saved, ownerEmail: this.env.SF_REVIEW_OWNER_EMAIL || saved.ownerEmail || defaults.ownerEmail,
      codexPath: this.env.SF_CODEX_PATH || saved.codexPath || defaults.codexPath,
      claudePath: this.env.SF_CLAUDE_PATH || saved.claudePath || defaults.claudePath,
      policy: validatePolicy(saved.policy) };
  }
  initialize() {
    const current = this.read();
    if (!current.machineId) { current.machineId = crypto.randomUUID(); this.write(current); }
    return current;
  }
  write(value) {
    const directory = path.dirname(this.file); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, this.file); return value;
  }
  prepare(input) {
    const current = this.initialize();
    const allowed = new Set(['sourceRepo', 'controlRepo', 'storageMode', 'machineName', 'workerEnabled', 'policy', 'contributorBindings']);
    requireValue(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => allowed.has(key)),
      'CONFIG_FIELD', 'Cấu hình chứa trường không được thay qua giao diện.', 400);
    const next = { ...current, ...input };
    validateRepo(next.sourceRepo); validateRepo(next.controlRepo);
    requireValue(next.sourceRepo.toLowerCase() !== next.controlRepo.toLowerCase(), 'CONTROL_SEPARATION', 'Kho contributor và kho control phải khác nhau.', 400);
    requireValue(['local', 'github'].includes(next.storageMode) && typeof next.workerEnabled === 'boolean', 'CONFIG_FIELD', 'Chế độ lưu hoặc worker không hợp lệ.', 400);
    requireValue(typeof next.machineName === 'string' && next.machineName.length > 0 && next.machineName.length <= 80, 'CONFIG_FIELD', 'Tên máy không hợp lệ.', 400);
    next.policy = validatePolicy(input.policy ? { ...input.policy, version: current.policy.version + 1 } : current.policy);
    requireValue(next.contributorBindings && typeof next.contributorBindings === 'object' && !Array.isArray(next.contributorBindings) && Object.entries(next.contributorBindings).length <= 100,
      'CONFIG_BINDINGS', 'Danh sách contributor không hợp lệ.', 400);
    for (const [login, email] of Object.entries(next.contributorBindings))
      requireValue(/^[a-zA-Z0-9-]{1,39}$/.test(login) && typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'CONFIG_BINDINGS', 'Ánh xạ GitHub/email không hợp lệ.', 400);
    return next;
  }
  update(input) { return this.write(this.prepare(input)); }
  public() {
    const value = this.initialize();
    return { schemaVersion: value.schemaVersion, ownerEmail: value.ownerEmail, sourceRepo: value.sourceRepo, controlRepo: value.controlRepo,
      storageMode: value.storageMode, machineId: value.machineId, machineName: value.machineName, workerEnabled: value.workerEnabled,
      policy: value.policy, contributorBindings: value.contributorBindings, releaseTargets: value.releaseTargets.map(({ id, name, kind, platform }) => ({ id, name, kind, platform })),
      hasSandboxImage: !!value.sandboxImage };
  }
}
module.exports = { ReviewConfig };
