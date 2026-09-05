const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanSourceCache } = require('./sourceCache');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-source-cache-'));
try {
  const now = Date.now();
  const old = path.join(root, `${'a'.repeat(64)}.mp4`), recent = path.join(root, `${'b'.repeat(64)}.mp4`), source = path.join(root, 'user-source.mp4');
  for (const file of [old, recent, source]) fs.writeFileSync(file, 'safe');
  const aged = new Date(now - 8 * 86400000);
  fs.utimesSync(old, aged, aged); fs.utimesSync(source, aged, aged);
  const report = cleanSourceCache(root, { now, maxBytes: 0 });
  assert.equal(report.removed, 1); assert.equal(report.bytes, 4);
  assert.equal(fs.existsSync(recent), true, 'soft quota cannot evict a recent render input');
  assert.equal(fs.existsSync(source), true, 'unrecognized source files never deleted');
  console.log('PASS generated source cache: age retention, soft quota and source/live-input protection');
} finally {
  // This exact temporary directory was created above and contains only this test.
  for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
  fs.rmdirSync(root);
}
