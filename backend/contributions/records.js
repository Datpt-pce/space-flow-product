const crypto = require('crypto');
const { fail, requireValue } = require('./errors');

const MAX_RECORD_BYTES = 700 * 1024;
const KINDS = new Set(['jobs', 'workers', 'settings', 'baselines', 'targets']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function recordKey(kind, id) {
  requireValue(KINDS.has(kind) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id),
    'INVALID_RECORD', 'Định danh hồ sơ không hợp lệ.', 400);
  return `${kind}/${id}.json`;
}
function encode(value) {
  const text = JSON.stringify(value);
  requireValue(Buffer.byteLength(text) <= MAX_RECORD_BYTES, 'RECORD_LIMIT', 'Hồ sơ vượt giới hạn lưu trữ. Cần tách hoặc lưu trữ hồ sơ cũ.', 413);
  return text;
}
class SqliteRecordStore {
  constructor(db) { this.db = db; this.mode = 'local'; }
  async get(kind, id) {
    recordKey(kind, id);
    const row = this.db.prepare('SELECT payload FROM contribution_records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.payload) : null;
  }
  async list(kind) {
    recordKey(kind, 'list');
    return this.db.prepare('SELECT payload FROM contribution_records WHERE kind=? ORDER BY updated_at DESC LIMIT 500').all(kind).map(row => JSON.parse(row.payload));
  }
  async mutate(kind, id, change) {
    recordKey(kind, id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT revision,payload FROM contribution_records WHERE kind=? AND id=?').get(kind, id);
      const next = change(row ? JSON.parse(row.payload) : null);
      if (next === undefined) { this.db.exec('COMMIT'); return row ? JSON.parse(row.payload) : null; }
      const revision = (row?.revision || 0) + 1;
      this.db.prepare('INSERT INTO contribution_records(kind,id,revision,payload,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at')
        .run(kind, id, revision, encode(next), Date.now());
      this.db.exec('COMMIT'); return clone(next);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

class GitHubRecordStore {
  constructor(client, repository) {
    this.client = client; this.repository = repository; this.mode = 'github'; this.cache = new Map();
  }
  async assertPrivate() {
    const repo = await this.client.repository(this.repository);
    requireValue(repo.private && repo.permissions?.push, 'CONTROL_REPO_ACCESS', 'Kho control phải Private và tài khoản trên máy cần quyền ghi.', 403);
    requireValue(repo.owner?.login?.toLowerCase() === this.repository.split('/')[0].toLowerCase(), 'CONTROL_REPO_OWNER', 'Chủ kho control không hợp lệ.', 403);
  }
  async read(kind, id) {
    const path = recordKey(kind, id);
    const file = await this.client.content(this.repository, path);
    if (!file) return null;
    requireValue(file.type === 'file' && file.size <= MAX_RECORD_BYTES && file.encoding === 'base64', 'CONTROL_RECORD_INVALID', 'Hồ sơ control không đúng định dạng hoặc quá lớn.');
    let envelope;
    try { envelope = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); }
    catch { fail('CONTROL_RECORD_INVALID', 'Không đọc được hồ sơ control.'); }
    requireValue(envelope?.schemaVersion === 1 && envelope.kind === kind && envelope.id === id && envelope.value,
      'CONTROL_RECORD_INVALID', 'Hồ sơ control không đúng định danh.');
    this.cache.set(path, { sha: file.sha, value: envelope.value });
    return { sha: file.sha, envelope };
  }
  async get(kind, id) { return clone((await this.read(kind, id))?.envelope.value || null); }
  async list(kind) {
    recordKey(kind, 'list');
    const files = await this.client.content(this.repository, kind);
    if (!files) return [];
    requireValue(Array.isArray(files) && files.length <= 500, 'CONTROL_RECORD_LIMIT', 'Kho control cần lưu trữ bớt hồ sơ trước khi nhận thêm việc.');
    const values = [];
    // Sequential reads keep GitHub secondary limits predictable on both workers.
    for (const file of files) {
      if (file.type !== 'file' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/.test(file.name)) continue;
      const cached = this.cache.get(`${kind}/${file.name}`);
      values.push(cached?.sha === file.sha ? clone(cached.value) : await this.get(kind, file.name.slice(0, -5)));
    }
    return values.filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async mutate(kind, id, change) {
    await this.assertPrivate();
    const path = recordKey(kind, id);
    const mutationId = crypto.randomUUID();
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = await this.read(kind, id);
      const next = change(clone(old?.envelope.value || null));
      if (next === undefined) return clone(old?.envelope.value || null);
      const envelope = { schemaVersion: 1, kind, id, mutationId, value: next };
      try {
        const written = await this.client.putContent(this.repository, path, encode(envelope), old?.sha);
        this.cache.set(path, { sha: written.content.sha, value: clone(next) });
        return clone(next);
      } catch (error) {
        if (error.code === 'GITHUB_CONFLICT') continue;
        // A write may have reached GitHub before the connection disappeared. Read back this
        // exact mutation; never repeat an uncertain append/approval as a new operation.
        const observed = await this.read(kind, id).catch(() => null);
        if (observed?.envelope.mutationId === mutationId) return clone(observed.envelope.value);
        throw error;
      }
    }
    fail('CONTROL_CONFLICT', 'Máy khác vừa cập nhật hồ sơ. Hãy tải lại và thử lại.');
  }
}
module.exports = { SqliteRecordStore, GitHubRecordStore, recordKey, clone, MAX_RECORD_BYTES };
