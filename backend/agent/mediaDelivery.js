// Executed on the destination machine through the existing authenticated video job channel.
// Durable receipts make every step resumable; replacement starts only after the caller
// has redirected old asset identities to the verified backup returned by prepare.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile, probeMetadata } = require('../video/assetService');
const active = new Set();
function machineId() {
  const dir = require('../utils/dataPaths').config;
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'media-machine-id');
  try { fs.writeFileSync(file, crypto.randomUUID(), { flag:'wx' }); } catch(e) { if(e.code !== 'EEXIST') throw e; }
  return fs.readFileSync(file, 'utf8').trim();
}
function writeJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function regular(file) {
  if (!path.isAbsolute(file) || !fs.lstatSync(file).isFile()) throw new Error('Đích phải là file thường trên đúng máy; không dùng symbolic link.');
}
function flush(file) { const fd=fs.openSync(file,'r+');try {fs.fsyncSync(fd);}finally{fs.closeSync(fd);} }
async function runDelivery(kind, p) {
  const device = machineId();
  if(kind === 'delivery-info') return { machineId:device, platform:process.platform };
  if(p.machineId !== device) throw new Error('Máy đích đã đổi. Kết nối lại đúng agent đã chọn.');
  if(!/^[a-f0-9-]{36}$/.test(p.id)) throw new Error('Delivery identity không hợp lệ.');
  if(active.has(p.id)) throw new Error('Delivery này đang chạy; tải lại trạng thái.');
  active.add(p.id);
  const root=path.join(require('../utils/dataPaths').config,'media-deliveries');fs.mkdirSync(root,{recursive:true});
  const receiptFile=path.join(root,`${p.id}.json`);
  try {
    let receipt=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):null;
    if(kind === 'delivery-prepare') {
      if(receipt && receipt.intentHash !== p.intentHash) throw new Error('Delivery identity đã dùng cho yêu cầu khác.');
      if(!receipt) {
      if(!['variant','replace'].includes(p.mode) || !/^[a-f0-9]{64}$/.test(p.outputHash)) throw new Error('Delivery mode/hash không hợp lệ.');
      regular(p.outputPath);
      if(await hashFile(p.outputPath) !== p.outputHash) throw new Error('File render đã đổi hash.');
      let folder, stem;
      if(p.anchorPath) {
        regular(p.anchorPath);
        const uploads=fs.realpathSync(require('../utils/dataPaths').uploads);
        const relative=path.relative(uploads,fs.realpathSync(p.anchorPath));
        if(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Nguồn upload/cache không có thư mục gốc của bạn. Chọn thư mục đích hoặc tải MP4.');
        if(await hashFile(p.anchorPath) !== p.expectedHash) throw new Error('Nguồn đã đổi hash; không giao file.');
        folder=fs.realpathSync(path.dirname(p.anchorPath));stem=path.basename(p.anchorPath,path.extname(p.anchorPath));
      } else {
        if(p.mode==='replace' || !path.isAbsolute(p.folder || '')) throw new Error('Cần chọn thư mục tuyệt đối trên máy đích.');
        folder=fs.realpathSync(p.folder);stem=String(p.stem || 'batch').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,120) || 'batch';
      }
      if(!fs.statSync(folder).isDirectory()) throw new Error('Thư mục đích không hợp lệ.');
      if(p.mode==='variant' && p.stem) stem=require('../video/batchOutputName').batchOutputName([p.stem]);
      if(/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem=`batch-${stem}`;
      const target=p.mode==='replace'?path.join(folder,path.basename(p.anchorPath)):null;
      if(target && path.extname(target).toLowerCase()!=='.mp4') throw new Error('Chỉ thay file MP4; chọn lưu variant cho container khác.');
      receipt={id:p.id,intentHash:p.intentHash,machineId:device,mode:p.mode,outputHash:p.outputHash,expectedHash:p.expectedHash,
        anchorPath:p.anchorPath,folder,stem,target,filenameMode:'asset',stage:path.join(folder,`.sf-${p.id}.stage.mp4`),backup:target?path.join(folder,`.sf-${p.id}.original.mp4`):null,state:'staging'};
      if(target) {
        const canonical=file=>{const resolved=fs.realpathSync(file);return process.platform==='win32'?resolved.toLowerCase():resolved;};
        const source=canonical(p.anchorPath);receipt.protectedAssetIds=[];
        for(const alias of p.sourceAliases || []) {
          try {if(canonical(alias.path)===source)receipt.protectedAssetIds.push(alias.id);}
          catch(e) {if(e.code!=='ENOENT')throw e;}
        }
      }
      writeJson(receiptFile,receipt);
      }
    }
    if(!receipt) throw new Error('Không tìm thấy receipt trên máy đích.');
    if(receipt.state==='staging') {
      if(kind!=='delivery-prepare') throw new Error('Delivery chưa chuẩn bị xong.');
      if(fs.existsSync(receipt.stage) && await hashFile(receipt.stage)!==receipt.outputHash) fs.unlinkSync(receipt.stage);
      if(!fs.existsSync(receipt.stage)) fs.copyFileSync(p.outputPath,receipt.stage,fs.constants.COPYFILE_EXCL);
      flush(receipt.stage);
      if(await hashFile(receipt.stage)!==receipt.outputHash) throw new Error('Không xác minh được bản staging.');
      const media=await probeMetadata(receipt.stage);
      if(!media.width || !media.height || !media.durationMs || !media.codecVideo) throw new Error('Output không phải video hợp lệ.');
      if(receipt.backup) {
        regular(receipt.anchorPath);
        if(await hashFile(receipt.anchorPath)!==receipt.expectedHash) throw new Error('Nguồn đã đổi trong lúc chuẩn bị.');
        if(!fs.existsSync(receipt.backup)) fs.copyFileSync(receipt.anchorPath,receipt.backup,fs.constants.COPYFILE_EXCL);
        flush(receipt.backup);
        if(await hashFile(receipt.backup)!==receipt.expectedHash) throw new Error('Backup không khớp nguồn; chưa thay file.');
      }
      receipt.state='prepared';writeJson(receiptFile,receipt);
    }
    if(kind==='delivery-prepare' && receipt.backup && await hashFile(receipt.backup)!==receipt.expectedHash) throw new Error('Backup đã đổi; không thay nguồn.');
    if(kind==='delivery-prepare' || kind==='delivery-status') return receipt;
    if(kind!=='delivery-commit') throw new Error('Delivery step không hợp lệ.');
    if(receipt.state==='done') {
      if(await hashFile(receipt.target)!==receipt.outputHash) throw new Error('File đã giao đã bị thay đổi. Receipt cũ được giữ nguyên.');
      return receipt;
    }
    if(receipt.mode==='replace') {
      const lock=`${receipt.target}.spaceflow-replace-lock`;
      try { fs.writeFileSync(lock,p.id,{flag:'wx'}); } catch(e) { if(e.code!=='EEXIST' || fs.readFileSync(lock,'utf8')!==p.id) throw new Error('File đang có delivery khác. Hoàn tất/recover delivery đó trước.'); }
      try {
        regular(receipt.target);
        if(await hashFile(receipt.backup)!==receipt.expectedHash) throw new Error('Backup đã đổi; dừng thay file.');
        const currentHash=await hashFile(receipt.target);
        if(currentHash===receipt.outputHash && !fs.existsSync(receipt.stage)) { /* recover rename before receipt commit */ }
        else {
          if(currentHash!==receipt.expectedHash) throw new Error('Nguồn đã đổi sau confirmation; chưa thay file.');
          if(await hashFile(receipt.stage)!==receipt.outputHash) throw new Error('Staging đã đổi.');
          fs.renameSync(receipt.stage,receipt.target);
        }
        receipt.state='done';writeJson(receiptFile,receipt);
      } finally { if(fs.existsSync(lock) && fs.readFileSync(lock,'utf8')===p.id) fs.unlinkSync(lock); }
    } else {
      // Persist each candidate before link, so crash recovery never creates a second variant.
      for(let n=receipt.variantNumber || 1;n<=10000;n++) {
        const filename=receipt.filenameMode==='asset' ? `${receipt.stem}${n===1?'':`_${n}`}.mp4` : `${receipt.stem}-variant-${n}.mp4`;
        receipt.variantNumber=n;receipt.target=path.join(receipt.folder,filename);writeJson(receiptFile,receipt);
        try { fs.linkSync(receipt.stage,receipt.target); break; }
        catch(e) {
          if(e.code!=='EEXIST') throw e;
          const a=fs.statSync(receipt.stage),b=fs.statSync(receipt.target);
          if(a.ino===b.ino && a.dev===b.dev) break;
          if(n===10000) throw new Error('Không còn tên variant trống.');
        }
      }
      receipt.state='done';writeJson(receiptFile,receipt);
      if(fs.existsSync(receipt.stage)) fs.unlinkSync(receipt.stage);
    }
    return receipt;
  } finally { active.delete(p.id); }
}
module.exports={runDelivery,machineId};
