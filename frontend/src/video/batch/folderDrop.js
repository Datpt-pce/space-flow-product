// Same supported extensions as backend/routes/video-assets.js. Folder sidecars
// are skipped; loose files keep the existing import validation behavior.
const MEDIA = /\.(mp4|mov|avi|mkv|webm|m4v|mp3|wav|aac|flac|m4a|ogg|opus|aiff|aif|wma|jpg|jpeg|png|webp|gif|bmp|tiff)$/i;

export async function readBatchDrop(transfer, { maxFiles = 1000, maxFolders = 50 } = {}) {
  // Capture entries/files before the drop event returns: DataTransfer becomes
  // protected after dispatch, while FileSystemEntry handles remain readable.
  const entries = [...(transfer.items || [])].filter(i => i.kind === 'file').map(i => ({
    entry: i.webkitGetAsEntry?.(), file: i.getAsFile?.(),
  }));
  const fallback = [...(transfer.files || [])];
  if (!entries.length) entries.push(...fallback.map(file => ({ file })));
  const folders = [], files = [];
  let count = 0;
  const countFile = () => { if (++count > maxFiles) throw new Error('Mỗi Lab nhận tối đa 1000 item. Giảm số file trong folder.'); };
  if (entries.filter(i => i.entry?.isDirectory).length > maxFolders) throw new Error('Mỗi Lab nhận tối đa 50 list. Giảm số folder hoặc bỏ list không dùng.');
  async function walk(entry, target) {
    if (entry.isFile) {
      if (!MEDIA.test(entry.name)) return;
      countFile();
      target.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader(), children = [];
      // Chromium returns directory entries in batches; one read can miss files.
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        children.push(...batch);
      }
      children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const child of children) await walk(child, target);
    }
  }
  for (const { entry, file } of entries) {
    if (entry?.isDirectory) {
      if (!entry.name.trim() || entry.name.length > 120) throw new Error(`Tên folder cần từ 1 đến 120 ký tự: ${entry.name}`);
      const folder = { name: entry.name, files: [] };
      try { await walk(entry, folder.files); }
      catch (error) { throw new Error(`Folder “${entry.name}”: ${error.message || 'Không đọc được file.'}`); }
      folders.push(folder);
    } else {
      countFile();
      const source = file || (entry?.isFile && await new Promise((resolve, reject) => entry.file(resolve, reject)));
      if (source) files.push(source);
    }
  }
  return { folders, files };
}
