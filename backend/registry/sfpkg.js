// .sfpkg pack/verify — Custom Node Platform Phase 2
// (specs/space-flow-master-plan/01-custom-node-platform.md). Replaces the empty skeleton at
// scripts/sfpkg-cli.js (Platform Core Phase 0.2) with a real implementation, importable both
// from that CLI and later from the registry submission pipeline (Phase 6) server-side.
//
// pack(): zip the package source directory, refusing to include any symlink.
// verify(): inspect an archive's entries WITHOUT extracting anything to disk — reject
// zip-slip path traversal and symlink entries purely by reading zip metadata, then validate
// the embedded node.json against the Manifest v2 schema. This is the ordering the acceptance
// criteria requires: "zip-slip/symlink test bị verify từ chối trước khi chạm filesystem thật."

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ZipArchive } = require('archiver'); // v8 API — class-based (new ZipArchive(...)), not the classic archiver('zip') factory function; matches backend/routes/files.js's existing usage.
const AdmZip = require('adm-zip');
const { validateManifest } = require('./manifest-validator');

const UNIX_MODE_MASK = 0xf000;
const UNIX_SYMLINK_MODE = 0xa000;

// ZIP central-directory `external file attributes` field packs the Unix file mode into its
// upper 16 bits when the archive was made on a Unix system (the common case for
// archiver/adm-zip output) — S_IFLNK (symlink) is 0xA000.
function isSymlinkAttr(attr) {
  return ((attr >>> 16) & UNIX_MODE_MASK) === UNIX_SYMLINK_MODE;
}

// Zip-slip guard: entry names are always '/'-separated regardless of the host OS that built
// or reads the archive (per the ZIP spec) — checked as POSIX paths on purpose, not
// path.resolve()'d against a real directory (which would vary by OS separator semantics).
// Must not assume the archive was built by a "nice" tool: adm-zip's own writer sanitizes
// traversal sequences out of entry names before it ever writes them (Utils.zipnamefix), but a
// malicious .sfpkg is not obligated to have been built with adm-zip — this check runs
// independently against whatever entry name verify() actually reads back.
function isSafeEntryName(name) {
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false; // absolute (POSIX or Windows drive)
  const normalized = path.posix.normalize(name);
  return normalized !== '..' && !normalized.startsWith('../');
}

function assertNoSymlinksOnDisk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) {
      throw new Error(`sfpkg pack refused: symlink found in package source: ${full}`);
    }
    if (stat.isDirectory()) assertNoSymlinksOnDisk(full);
  }
}

// pack({ sourceDir, outFile }) -> { outFile, checksum, packageId, version }
async function pack({ sourceDir, outFile }) {
  const manifestPath = path.join(sourceDir, 'node.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No node.json in ${sourceDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { valid, errors } = validateManifest(manifest);
  if (!valid) throw new Error(`Manifest invalid:\n${errors.join('\n')}`);

  assertNoSymlinksOnDisk(sourceDir);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });

  const checksum = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
  return { outFile, checksum, packageId: manifest.packageId, version: manifest.version };
}

// verify({ archiveFile } | { buffer }) -> { valid, checksum, manifest?, errors }
// Never writes to disk. `errors` explains the first rejection reason when valid === false.
function verify({ archiveFile, buffer }) {
  const bytes = buffer || fs.readFileSync(archiveFile);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

  let zip;
  try {
    zip = new AdmZip(bytes);
  } catch (err) {
    return { valid: false, checksum, errors: [`not a valid zip archive: ${err.message}`] };
  }

  const entries = zip.getEntries();
  for (const entry of entries) {
    if (!isSafeEntryName(entry.entryName)) {
      return { valid: false, checksum, errors: [`path traversal / absolute path in entry: ${entry.entryName}`] };
    }
    if (isSymlinkAttr(entry.attr)) {
      return { valid: false, checksum, errors: [`symlink entry not allowed: ${entry.entryName}`] };
    }
  }

  const manifestEntry = entries.find((e) => e.entryName === 'node.json');
  if (!manifestEntry) {
    return { valid: false, checksum, errors: ['archive missing node.json'] };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (err) {
    return { valid: false, checksum, errors: [`node.json is not valid JSON: ${err.message}`] };
  }

  const { valid, errors } = validateManifest(manifest);
  if (!valid) return { valid: false, checksum, errors };

  return { valid: true, checksum, manifest, errors: [] };
}

module.exports = { pack, verify, isSymlinkAttr, isSafeEntryName };
