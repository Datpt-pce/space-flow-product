// Bounded chunks over the existing authenticated owner-agent job channel.
// Neither endpoint accepts a destination path from the other machine.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile } = require('./assetService');
function createSourceReceiver(root) {
  root = path.resolve(root);
  function paths(p) {
    if (!/^[a-f0-9-]{36}$/.test(p.transferId) || !/^[a-f0-9]{64}$/.test(p.hash) || !/^\.(mp4|mov|mkv|webm|mp3|wav|png|jpg|jpeg|gif|m4a|aac|flac|ogg|m4v|avi|bmp|tiff|webp)$/.test(p.extension)) throw new Error('Invalid media transfer identity');
    return { partial: path.join(root, `${p.transferId}.partial`), meta: path.join(root, `${p.transferId}.json`), final: path.join(root, `${p.hash}${p.extension}`) };
  }
  return async function receive(kind, p) {
    const files = paths(p);
    if (kind === 'source-begin') {
      if (!Number.isSafeInteger(p.size) || p.size <= 0 || p.size > 50 * 1024 ** 3) throw new Error('Invalid media transfer size');
      fs.mkdirSync(root, { recursive: true });
      if (fs.existsSync(files.final) && fs.statSync(files.final).size === p.size && await hashFile(files.final) === p.hash) {
        const now = new Date(); fs.utimesSync(files.final, now, now);
        require('./sourceCache').cleanSourceCache(root);
        return { cached: true, path: files.final };
      }
      require('./sourceCache').cleanSourceCache(root);
      fs.writeFileSync(files.partial, '', { flag: 'wx' });
      try { fs.writeFileSync(files.meta, JSON.stringify({ hash: p.hash, size: p.size, extension: p.extension }), { flag: 'wx' }); }
      catch (e) { fs.rmSync(files.partial, { force: true }); throw e; }
      return { cached: false };
    }
    if (kind === 'source-abort') { for (const f of [files.partial, files.meta]) fs.rmSync(f, { force: true }); return { aborted: true }; }
    const meta = JSON.parse(fs.readFileSync(files.meta, 'utf8'));
    if (meta.hash !== p.hash || meta.extension !== p.extension) throw new Error('Media transfer identity changed');
    if (kind === 'source-chunk') {
      if (typeof p.chunk !== 'string' || p.chunk.length > 1500000) throw new Error('Media chunk too large');
      const data = Buffer.from(p.chunk, 'base64');
      const size = fs.statSync(files.partial).size;
      if (!Number.isSafeInteger(p.offset) || p.offset !== size || size + data.length > meta.size) throw new Error('Media transfer offset/size mismatch');
      fs.appendFileSync(files.partial, data);
      return { received: size + data.length };
    }
    if (kind !== 'source-finish') throw new Error('Unknown media transfer step');
    if (fs.statSync(files.partial).size !== meta.size || await hashFile(files.partial) !== meta.hash) throw new Error('Media transfer checksum mismatch');
    fs.renameSync(files.partial, files.final);
    fs.unlinkSync(files.meta);
    return { path: files.final };
  };
}
async function transferSource(sourcePath, runJob, assertCurrent = () => {}) {
  const params = { transferId: crypto.randomUUID(), hash: await hashFile(sourcePath), size: fs.statSync(sourcePath).size, extension: path.extname(sourcePath).toLowerCase() };
  assertCurrent();
  const start = await runJob('source-begin', params);
  if (start.cached) return start.path;
  try {
    let offset = 0;
    for await (const data of fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 })) {
      assertCurrent();
      await runJob('source-chunk', { ...params, offset, chunk: data.toString('base64') });
      offset += data.length;
    }
    assertCurrent();
    return (await runJob('source-finish', params)).path;
  } catch (error) {
    await runJob('source-abort', params).catch(() => {});
    throw error;
  }
}
module.exports = { createSourceReceiver, transferSource };
