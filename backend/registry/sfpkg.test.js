// Acceptance test for Custom Node Platform Phase 2's .sfpkg pack/verify
// (specs/space-flow-master-plan/01-custom-node-platform.md). Run with:
//   node backend/registry/sfpkg.test.js
//
// Acceptance criteria under test: "sfpkg pack+verify roundtrip đúng cho 1 node mẫu (convert
// built-in đơn giản, vd. date-time); zip-slip/symlink test bị verify từ chối trước khi chạm
// filesystem thật; schema reject đúng manifest thiếu field/version sai SemVer/compatibility
// sai cú pháp."

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const AdmZip = require('adm-zip');
const { pack, verify, isSymlinkAttr, isSafeEntryName } = require('./sfpkg');

const FIXTURE_DIR = path.join(__dirname, '__fixtures__', 'date-time-v2');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

async function main() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfpkg-test-'));

  // 1. Real pack+verify round-trip on a converted built-in node.
  const outFile = path.join(scratchDir, 'date-time-1.0.0.sfpkg');
  const packResult = await pack({ sourceDir: FIXTURE_DIR, outFile });
  check('pack() produces packageId/version/checksum for date-time fixture', () => {
    assert.strictEqual(packResult.packageId, 'date-time');
    assert.strictEqual(packResult.version, '1.0.0');
    assert.ok(/^[0-9a-f]{64}$/.test(packResult.checksum));
    assert.ok(fs.existsSync(outFile));
  });

  const verifyResult = verify({ archiveFile: outFile });
  check('verify() accepts the packed archive and checksum matches pack()', () => {
    assert.strictEqual(verifyResult.valid, true, JSON.stringify(verifyResult.errors));
    assert.strictEqual(verifyResult.checksum, packResult.checksum);
    assert.strictEqual(verifyResult.manifest.packageId, 'date-time');
  });

  // 2. Zip-slip: an entry whose name escapes the extraction root. adm-zip's own addFile()
  // sanitizes traversal sequences out of entry names before writing (Utils.zipnamefix) — a
  // real attacker doesn't necessarily use adm-zip to CRAFT the malicious archive, so this test
  // sets the raw entryName directly via its setter (bypassing addFile's sanitization) to
  // simulate an archive built by a tool that doesn't sanitize, which is exactly what verify()
  // must defend against regardless of how the archive was produced.
  const slipZip = new AdmZip();
  slipZip.addFile('node.json', fs.readFileSync(path.join(FIXTURE_DIR, 'node.json')));
  slipZip.addFile('placeholder', Buffer.from('malicious'));
  slipZip.getEntries().find((e) => e.entryName === 'placeholder').entryName = '../../../etc/passwd';
  const slipResult = verify({ buffer: slipZip.toBuffer() });
  check('verify() rejects zip-slip path traversal entry, in-memory only (no disk write)', () => {
    assert.strictEqual(slipResult.valid, false);
    assert.ok(slipResult.errors.some((e) => e.includes('path traversal')), JSON.stringify(slipResult.errors));
  });

  // 3. Symlink entry — set Unix mode bits (S_IFLNK) directly in the central-directory attr,
  // the way a real zip built on Linux with a symlink in it would encode one.
  const symlinkZip = new AdmZip();
  symlinkZip.addFile('node.json', fs.readFileSync(path.join(FIXTURE_DIR, 'node.json')));
  symlinkZip.addFile('evil-link', Buffer.from('/etc/passwd'));
  const evilEntry = symlinkZip.getEntries().find((e) => e.entryName === 'evil-link');
  evilEntry.attr = (0o120777 << 16) >>> 0; // S_IFLNK (0o120000) | 0777 perms, in the upper 16 bits
  check('isSymlinkAttr() correctly classifies the crafted attr as a symlink', () => {
    assert.strictEqual(isSymlinkAttr(evilEntry.attr), true);
  });
  const symlinkResult = verify({ buffer: symlinkZip.toBuffer() });
  check('verify() rejects symlink entry, in-memory only (no disk write)', () => {
    assert.strictEqual(symlinkResult.valid, false);
    assert.ok(symlinkResult.errors.some((e) => e.includes('symlink')), JSON.stringify(symlinkResult.errors));
  });

  // 4. Schema rejection: missing required field, bad SemVer, bad compatibility range syntax.
  const missingFieldZip = new AdmZip();
  missingFieldZip.addFile('node.json', Buffer.from(JSON.stringify({ schemaVersion: 2, packageId: 'x' })));
  const missingFieldResult = verify({ buffer: missingFieldZip.toBuffer() });
  check('verify() rejects manifest missing required fields', () => {
    assert.strictEqual(missingFieldResult.valid, false);
  });

  const badSemverManifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'node.json'), 'utf8'));
  badSemverManifest.version = 'not-a-version';
  const badSemverZip = new AdmZip();
  badSemverZip.addFile('node.json', Buffer.from(JSON.stringify(badSemverManifest)));
  const badSemverResult = verify({ buffer: badSemverZip.toBuffer() });
  check('verify() rejects manifest with invalid SemVer version', () => {
    assert.strictEqual(badSemverResult.valid, false);
  });

  const badCompatManifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'node.json'), 'utf8'));
  badCompatManifest.compatibility = { notSpaceFlow: '>=1.0.0' };
  const badCompatZip = new AdmZip();
  badCompatZip.addFile('node.json', Buffer.from(JSON.stringify(badCompatManifest)));
  const badCompatResult = verify({ buffer: badCompatZip.toBuffer() });
  check('verify() rejects manifest with malformed compatibility field (missing spaceFlow key)', () => {
    assert.strictEqual(badCompatResult.valid, false);
  });

  // 5. isSafeEntryName direct unit coverage (absolute paths, Windows drive letters).
  check('isSafeEntryName rejects absolute POSIX path', () => assert.strictEqual(isSafeEntryName('/etc/passwd'), false));
  check('isSafeEntryName rejects Windows drive-letter path', () => assert.strictEqual(isSafeEntryName('C:/Windows/System32'), false));
  check('isSafeEntryName rejects parent-traversal', () => assert.strictEqual(isSafeEntryName('../../secret'), false));
  check('isSafeEntryName accepts a normal relative path', () => assert.strictEqual(isSafeEntryName('tests/fixture.json'), true));

  fs.rmSync(scratchDir, { recursive: true, force: true });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
