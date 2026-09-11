const fs = require('fs');
const path = require('path');
const { hash } = require('./policy');
const { requireValue } = require('./errors');
const { runProcess, within } = require('./process');

const SOURCE_DIRS = ['frontend', 'backend', 'nodes', 'shared'];
const SOURCE_FILES = ['VERSION.json', 'CHANGELOG.md', 'Dockerfile.backend', 'Dockerfile.frontend',
  'scripts/state-backup.js', 'scripts/rotate-credentials.js', 'scripts/retain-state.js'];
function safeName(name) {
  return typeof name === 'string' && name.length <= 300 && !/[\\:\x00-\x1f\x7f]/.test(name) &&
    name.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function allowedSource(name) {
  if (!safeName(name) || !(SOURCE_DIRS.includes(name.split('/')[0]) || SOURCE_FILES.includes(name))) return false;
  if (name.split('/').some(part => /^(\.git|\.env.*|node_modules|dist|build|uploads|workflows|logs|sessions|credentials|registry-installs|registry-submissions|local-drafts|__pycache__|\.cache|\.auth)$/i.test(part))) return false;
  if (/\.(sqlite|sqlite3|db|pem|key|log|pyc|zip|7z|tar|gz|mp4|mov|exe)$/i.test(name)) return false;
  if (/(^|\/)(settings|custom_links|agent|store|review-console|local-services)\.json$/i.test(name)) return false;
  if (name.startsWith('backend/config/') && !['backend/config/agentConfig.js', 'backend/config/local-services.example.json'].includes(name)) return false;
  return true;
}
function allowedChange(name) {
  return allowedSource(name) && SOURCE_DIRS.includes(name.split('/')[0]) &&
    !/(^|\/)(package(-lock)?\.json|requirements[^/]*|Dockerfile[^/]*|\.npmrc|\.yarnrc[^/]*|vite\.config\.js|nginx\.conf)$/.test(name) &&
    !name.startsWith('backend/contributions/') && !name.startsWith('frontend/src/contributions/');
}
function allowedChangeNote(name) { return safeName(name) && /^docs\/changes\/[a-z0-9][a-z0-9-]{0,99}\.md$/.test(name) && name !== 'docs/changes/README.md'; }
function scanSecrets(name, bytes) {
  if (bytes.includes(0)) return;
  const value = bytes.toString('utf8');
  const token = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-ant-[A-Za-z0-9_-]{35,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{30})/;
  requireValue(!token.test(value), 'SOURCE_SECRET', `Phát hiện credential có thể có trong ${name}. Gỡ khỏi source trước khi xuất.`, 409);
}
async function sourceFiles(root) {
  const result = await runProcess('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...SOURCE_DIRS, ...SOURCE_FILES], { cwd: root, maxBytes: 2000000 });
  requireValue(result.code === 0, 'SOURCE_GIT', 'Không đọc được danh sách source của repository.');
  const files = {}; const excluded = []; let size = 0;
  for (const name of [...new Set(result.output.split('\0').filter(Boolean))].sort()) {
    if (!allowedSource(name)) { excluded.push(name); continue; }
    const target = within(root, path.join(root, name));
    if (!fs.existsSync(target)) continue;
    requireValue(!fs.lstatSync(target).isSymbolicLink() && fs.statSync(target).isFile(), 'SOURCE_LINK', `Không xuất symlink hoặc thư mục: ${name}.`);
    requireValue(fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep), 'SOURCE_LINK', `Đường dẫn source vượt repository: ${name}.`);
    const bytes = fs.readFileSync(target); size += bytes.length;
    requireValue(bytes.length <= 8 * 1024 * 1024 && size <= 100 * 1024 * 1024, 'SOURCE_SIZE', 'Source vượt giới hạn gói contributor.');
    scanSecrets(name, bytes); files[name] = bytes;
  }
  requireValue(Object.keys(files).length > 0 && Object.keys(files).length <= 3000, 'SOURCE_EMPTY', 'Source rỗng hoặc có quá nhiều file.');
  return { files, excluded, size };
}
function writeFiles(directory, files) {
  const seen = new Set();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) {
    requireValue(safeName(name) && !seen.has(name.toLowerCase()), 'SOURCE_PATH', 'Gói có đường dẫn trùng hoặc không hợp lệ.'); seen.add(name.toLowerCase());
    const target = within(directory, path.join(directory, name));
    let cursor = path.resolve(directory);
    for (const part of name.split('/')) {
      cursor = path.join(cursor, part);
      requireValue(!fs.existsSync(cursor) || !fs.lstatSync(cursor).isSymbolicLink(), 'SOURCE_LINK', 'Không ghi source qua symlink.');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { mode: 0o600 });
  }
}
function manifestFor(files) { return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])); }
function verifyManifest(directory, manifest) {
  const found = [];
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      requireValue(!entry.isSymbolicLink(), 'ARTIFACT_CHANGED', `Artifact có symlink ${name}.`);
      if (entry.isDirectory()) walk(name); else found.push(name);
    }
  }
  walk();
  requireValue(found.length === Object.keys(manifest).length && found.every(name => Object.hasOwn(manifest, name)), 'ARTIFACT_CHANGED', 'Artifact có file ngoài manifest.');
  for (const [name, digest] of Object.entries(manifest)) {
    const target = within(directory, path.join(directory, name));
    requireValue(fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink() && hash(fs.readFileSync(target)) === digest,
      'ARTIFACT_CHANGED', `Artifact đã thay đổi hoặc thiếu file ${name}.`);
  }
}
module.exports = { SOURCE_DIRS, SOURCE_FILES, safeName, allowedSource, allowedChange, allowedChangeNote, scanSecrets, sourceFiles, writeFiles, manifestFor, verifyManifest };
