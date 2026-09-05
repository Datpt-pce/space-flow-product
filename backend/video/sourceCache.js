const fs = require('node:fs');
const path = require('node:path');

// Only the agent's generated, content-addressed transfer copies are eligible.
// Source library files and completed render deliverables never enter this root.
function cleanSourceCache(root, { now = Date.now(), retentionMs = 7 * 86400000, maxBytes = 10 * 1024 ** 3 } = {}) {
  root = path.resolve(root);
  if (!fs.existsSync(root)) return { removed: 0, bytes: 0, remainingBytes: 0 };
  const entries = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^(?:[a-f0-9]{64}\.(?:mp4|mov|mkv|webm|mp3|wav|png|jpg|jpeg|gif|m4a|aac|flac|ogg|m4v|avi|bmp|tiff|webp)|[a-f0-9-]{36}\.(?:partial|json))$/.test(name)) continue;
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) continue;
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    entries.push({ target, size: stat.size, mtime: stat.mtimeMs });
  }
  let remainingBytes = entries.reduce((sum, e) => sum + e.size, 0), removed = 0, bytes = 0;
  // Never evict recent copies even if the soft quota is exceeded: they may belong
  // to a live render. A later maintenance pass reclaims them once idle long enough.
  const idleMs = Math.max(86400000, (Number(process.env.VIDEO_RENDER_TIMEOUT_MS) || 7200000) + 60000);
  for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
    const age = now - entry.mtime;
    if (age < idleMs || (age < retentionMs && remainingBytes <= maxBytes)) continue;
    try { fs.unlinkSync(entry.target); removed++; bytes += entry.size; remainingBytes -= entry.size; } catch (e) { if (!['EBUSY', 'EPERM', 'ENOENT'].includes(e.code)) throw e; }
  }
  return { removed, bytes, remainingBytes };
}
module.exports = { cleanSourceCache };
