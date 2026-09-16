import { resolveDrop } from './api.js';

// Đọc file/folder vừa kéo-thả từ 1 DragEvent và trả về path thật trên đĩa (không
// upload nội dung). Trên Docker product (backend Linux), resolve-drop cần kèm
// `items` (tên + size + isDir) để dò trong các root đã mount — thiếu items sẽ luôn
// trả về mảng rỗng, xem backend/routes/files.js:325-334.
export async function resolveDropPaths(e) {
  const text = e.dataTransfer.getData('text/plain');
  if (text) return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const internal = e.dataTransfer.getData('space-flow-file');
  if (internal) return [internal];

  const names = [];
  const items = [];
  const dtItems = e.dataTransfer.items;
  if (dtItems && dtItems.length > 0) {
    for (let i = 0; i < dtItems.length; i++) {
      const it = dtItems[i];
      if (it.kind !== 'file') continue;
      const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      const f = it.getAsFile ? it.getAsFile() : null;
      const name = entry ? entry.name : f?.name;
      if (!name) continue;
      names.push(name);
      items.push({ name, size: f?.size ?? null, isDir: entry ? entry.isDirectory : false });
    }
  } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    Array.from(e.dataTransfer.files).forEach(f => {
      names.push(f.name);
      items.push({ name: f.name, size: f.size ?? null, isDir: false });
    });
  }

  if (!names.length) return [];
  const { paths } = await resolveDrop(names, items);
  return paths || [];
}
