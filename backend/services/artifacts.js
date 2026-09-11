const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { uploads } = require('../utils/dataPaths');

function withinUploads(file) {
  try {
    const root = fs.realpathSync(uploads);
    const real = fs.realpathSync(file);
    const relative = path.relative(root, real);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && fs.statSync(real).isFile() ? real : null;
  } catch { return null; }
}

async function register(file, ownerId, { kind = 'upload', expiresAt = null } = {}) {
  const real = withinUploads(file);
  if (!real) throw Object.assign(new Error('Artifact must be a regular file inside uploads'), { status: 400 });
  const prior = db.prepare('SELECT * FROM artifacts WHERE path = ?').get(real);
  if (prior) {
    if (prior.owner_id !== ownerId || prior.state !== 'active') throw Object.assign(new Error('Artifact ownership conflict'), { status: 403 });
    return prior;
  }
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(real)) hash.update(chunk);
  const id = crypto.randomUUID();
  const size = fs.statSync(real).size;
  const used = db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS n FROM artifacts WHERE owner_id=? AND state='active'").get(ownerId).n;
  if (used + size > Number(process.env.SF_ARTIFACT_QUOTA_BYTES || 10 * 1024 ** 3)) throw Object.assign(new Error('Artifact quota exceeded'), { status: 429 });
  db.prepare('INSERT INTO artifacts (id, owner_id, path, checksum, size_bytes, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, real, hash.digest('hex'), size, kind, Date.now(), expiresAt);
  return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
}

function canRead(file, ownerId) {
  const real = withinUploads(file);
  if (!real || !ownerId) return false;
  const row = db.prepare('SELECT id, owner_id, state FROM artifacts WHERE path = ?').get(real);
  if (row) {
    if (row.state !== 'active') return false;
    if (row.owner_id === ownerId) return true;
    return !!db.prepare("SELECT 1 FROM workflow_artifacts r JOIN workflows w ON w.id=r.workflow_id WHERE r.artifact_id=? AND w.visibility='team' AND w.owner_id=?").get(row.id, row.owner_id);
  }
  // Existing video metadata is an explicit server-side owner record. Arbitrary workflow
  // JSON references are deliberately NOT an authorization source.
  return !!db.prepare(`SELECT id FROM video_assets WHERE owner_id = ? AND
    (source_path = ? OR thumbnail_path = ? OR proxy_path = ?)`).get(ownerId, real, real, real);
}

function serve(req, res, next) {
  let relative;
  try { relative = decodeURIComponent(req.path); } catch { return res.status(400).json({ error: 'Invalid artifact path' }); }
  const file = path.resolve(uploads, '.' + relative);
  if (!canRead(file, req.user?.id)) return res.status(404).json({ error: 'Artifact not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.sendFile(file, error => error && next(error));
}

function referenced(file) {
  const record = db.prepare('SELECT id FROM artifacts WHERE path=?').get(file);
  if (record && (db.prepare('SELECT 1 FROM run_artifacts WHERE artifact_id=? LIMIT 1').get(record.id) || db.prepare('SELECT 1 FROM workflow_artifacts WHERE artifact_id=? LIMIT 1').get(record.id))) return true;
  // Conservative reachability across persisted documents/revisions/assets. False positives
  // retain a file; unknown records are never deletion candidates. No client can subtract refs.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('artifacts','schema_migrations')").all();
  const quote = value => '"' + value.replace(/"/g, '""') + '"';
  const names = [file, file.replace(/\\/g, '/'), JSON.stringify(file).slice(1, -1), path.basename(file)];
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${quote(name)})`).all().filter(c => /TEXT|JSON|CLOB/i.test(c.type));
    for (const col of cols) {
      if (names.some(value => db.prepare(`SELECT 1 FROM ${quote(name)} WHERE instr(${quote(col.name)}, ?) > 0 LIMIT 1`).get(value))) return true;
    }
  }
  return false;
}

function cleanup(ownerId, now = Date.now()) {
  const rows = db.prepare("SELECT * FROM artifacts WHERE owner_id = ? AND state = 'active' AND expires_at IS NOT NULL AND expires_at <= ?").all(ownerId, now);
  let deleted = 0;
  for (const row of rows) {
    // Realpath at deletion time blocks symlink substitution or paths moved outside the root.
    if (withinUploads(row.path) !== row.path || referenced(row.path)) continue;
    fs.unlinkSync(row.path);
    db.prepare("UPDATE artifacts SET state = 'deleted' WHERE id = ? AND owner_id = ?").run(row.id, ownerId);
    deleted++;
  }
  return { deleted };
}
function assertReferences(value, ownerId, depth = 0, references = new Set()) {
  if (depth > 32) throw Object.assign(new Error('Document nesting limit exceeded'), { status: 400 });
  if (typeof value === 'string') {
    const file = value.startsWith('/uploads/') ? path.resolve(uploads, '.' + value.slice('/uploads'.length)) : path.isAbsolute(value) ? path.resolve(value) : null;
    if (!file) return references;
    const relative = path.relative(uploads, file);
    const inside = relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    if (inside && fs.existsSync(file) && !canRead(file, ownerId)) {
      throw Object.assign(new Error('Artifact access denied'), { status: 403, code: 'FORBIDDEN' });
    }
    if (inside) {
      const record = db.prepare("SELECT id FROM artifacts WHERE path=? AND state='active'").get(withinUploads(file) || file);
      if (record) references.add(record.id);
    }
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) assertReferences(child, ownerId, depth + 1, references);
  }
  return references;
}
module.exports = { withinUploads, register, canRead, serve, referenced, cleanup, assertReferences };
