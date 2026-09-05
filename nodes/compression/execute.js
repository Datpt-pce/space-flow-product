const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ZipArchive } = require('archiver');
const tar = require('tar');
const AdmZip = require('adm-zip');

function outPath(uploadsDir, baseName, ext) {
  const fileName = `${baseName || 'archive'}-${Date.now()}.${ext}`;
  return { filePath: path.join(uploadsDir, fileName), fileName };
}

function zipFiles(filePaths, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const p of filePaths) archive.file(p, { name: path.basename(p) });
    archive.finalize();
  });
}

function gzipFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(srcPath);
    const dest = fs.createWriteStream(destPath);
    src.pipe(zlib.createGzip()).pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
  });
}

function gunzipFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const src = fs.createReadStream(srcPath);
    const dest = fs.createWriteStream(destPath);
    src.pipe(zlib.createGunzip()).pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
  });
}

async function compress(items, config, context) {
  const format = config.format || 'zip';
  const sourceBinaryField = config.sourceBinaryField || 'data';
  const outputBinaryField = config.outputBinaryField || 'data';
  const baseName = config.fileName || 'archive';

  const filePaths = items.map(item => item.binary?.[sourceBinaryField]?.path).filter(Boolean);
  if (!filePaths.length) throw new Error('Compression: không có file binary nào trong input để nén');

  if (format === 'zip') {
    const { filePath, fileName } = outPath(context.uploadsDir, baseName, 'zip');
    await zipFiles(filePaths, filePath);
    return { items: [{ json: {}, binary: { [outputBinaryField]: { path: filePath, mimeType: 'application/zip', fileName } } }] };
  }

  if (format === 'gzip') {
    const { filePath, fileName } = outPath(context.uploadsDir, baseName, 'gz');
    await gzipFile(filePaths[0], filePath);
    return { items: [{ json: {}, binary: { [outputBinaryField]: { path: filePath, mimeType: 'application/gzip', fileName } } }] };
  }

  if (format === 'tar' || format === 'targz') {
    const ext = format === 'targz' ? 'tar.gz' : 'tar';
    const { filePath, fileName } = outPath(context.uploadsDir, baseName, ext);
    await tar.create(
      { gzip: format === 'targz', file: filePath, cwd: path.dirname(filePaths[0]) },
      filePaths.map(p => path.basename(p)),
    );
    return { items: [{ json: {}, binary: { [outputBinaryField]: { path: filePath, mimeType: format === 'targz' ? 'application/gzip' : 'application/x-tar', fileName } } }] };
  }

  throw new Error(`Compression: unknown format "${format}"`);
}

async function decompress(items, config, context) {
  const sourceBinaryField = config.sourceBinaryField || 'data';
  const outputBinaryField = config.outputBinaryField || 'data';
  const result = [];

  for (const item of items) {
    const bin = item.binary?.[sourceBinaryField];
    if (!bin?.path) continue;
    const lowerPath = bin.path.toLowerCase();

    if (lowerPath.endsWith('.zip')) {
      const zip = new AdmZip(bin.path);
      const extractDir = path.join(context.uploadsDir, `extract-${Date.now()}`);
      zip.extractAllTo(extractDir, true);
      for (const f of fs.readdirSync(extractDir)) {
        const full = path.join(extractDir, f);
        if (fs.statSync(full).isFile()) {
          result.push({ json: {}, binary: { [outputBinaryField]: { path: full, mimeType: 'application/octet-stream', fileName: f } } });
        }
      }
      continue;
    }

    if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tar')) {
      const extractDir = path.join(context.uploadsDir, `extract-${Date.now()}`);
      fs.mkdirSync(extractDir, { recursive: true });
      await tar.extract({ file: bin.path, cwd: extractDir });
      for (const f of fs.readdirSync(extractDir)) {
        const full = path.join(extractDir, f);
        if (fs.statSync(full).isFile()) {
          result.push({ json: {}, binary: { [outputBinaryField]: { path: full, mimeType: 'application/octet-stream', fileName: f } } });
        }
      }
      continue;
    }

    if (lowerPath.endsWith('.gz')) {
      const destName = path.basename(bin.path).replace(/\.gz$/i, '');
      const destPath = path.join(context.uploadsDir, `${Date.now()}-${destName}`);
      await gunzipFile(bin.path, destPath);
      result.push({ json: {}, binary: { [outputBinaryField]: { path: destPath, mimeType: 'application/octet-stream', fileName: destName } } });
      continue;
    }

    throw new Error(`Compression: định dạng của "${bin.path}" chưa hỗ trợ giải nén (chỉ zip/gzip/tar/tar.gz)`);
  }

  return { items: result };
}

module.exports = async function execute(inputs, config, context) {
  const items = inputs.items || [];
  const operation = config.operation || 'compress';
  return operation === 'decompress' ? decompress(items, config, context) : compress(items, config, context);
};
