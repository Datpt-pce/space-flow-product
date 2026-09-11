const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

async function checksum(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function counts(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) =>
    [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n]));
}
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Invalid backup path');
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Backup path escapes destination');
  return file;
}
async function snapshot({ database, roots, destination }) {
  if (fs.existsSync(destination)) throw new Error('Backup destination must not exist');
  // Do not recursively capture a backup into one of its own source roots.
  for (const root of Object.values(roots)) {
    const rel = path.relative(path.resolve(root), path.resolve(destination));
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('Backup destination is inside source');
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(database, { readOnly: true });
  const manifest = { schemaVersion: 1, completedAt: null, files: [], counts: {} };
  async function add(source, relative) {
    const before = fs.lstatSync(source);
    if (before.isSymbolicLink()) throw new Error('Backup refuses symbolic links');
    if (before.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) await add(path.join(source, name), `${relative}/${name}`);
      return;
    }
    if (!before.isFile()) throw new Error('Backup source must be regular');
    const target = inside(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
    const hash = await checksum(target);
    const after = fs.statSync(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || hash !== await checksum(source)) throw new Error('Source changed during backup; quiesce writers and retry');
    manifest.files.push({ path: relative, size: after.size, sha256: hash });
  }
  try {
    db.prepare('VACUUM INTO ?').run(path.join(destination, 'database.sqlite'));
    const copy = new DatabaseSync(path.join(destination, 'database.sqlite'), { readOnly: true });
    try { manifest.counts = counts(copy); } finally { copy.close(); }
    fs.chmodSync(path.join(destination, 'database.sqlite'), 0o600);
    manifest.files.push({ path: 'database.sqlite', size: fs.statSync(path.join(destination, 'database.sqlite')).size, sha256: await checksum(path.join(destination, 'database.sqlite')) });
    for (const [label, source] of Object.entries(roots)) {
      if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid backup root label');
      if (fs.existsSync(source)) await add(source, label);
    }
    manifest.completedAt = Date.now();
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(database + '.backup-status.json', JSON.stringify({ completedAt: manifest.completedAt }), { mode: 0o600 });
    return manifest;
  } finally { db.close(); }
}
async function restore(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Restore destination must not exist');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported backup manifest');
  const seen = new Set();
  for (const item of manifest.files) {
    const file = inside(source, item.path);
    if (seen.has(item.path) || !fs.realpathSync(file).startsWith(fs.realpathSync(source) + path.sep) || fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid backup file');
    seen.add(item.path);
    if (fs.statSync(file).size !== item.size || await checksum(file) !== item.sha256) throw new Error('Backup checksum mismatch');
  }
  if (!seen.has('database.sqlite')) throw new Error('Missing database snapshot');
  const db = new DatabaseSync(path.join(source, 'database.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup integrity failure');
    if (JSON.stringify(counts(db)) !== JSON.stringify(manifest.counts)) throw new Error('Backup row-count mismatch');
  } finally { db.close(); }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const item of manifest.files) {
    const target = inside(destination, item.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(inside(source, item.path), target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
  return { files: manifest.files.length, counts: manifest.counts };
}
module.exports = { snapshot, restore, checksum };
