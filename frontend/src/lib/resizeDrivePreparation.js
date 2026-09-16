export const isDriveFolder = value => typeof value === 'string' && /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?(?:\?[^\s]*)?$/.test(value.trim());

export function queuedDriveFolders(type, config) {
  if (!['resize-upload-v3', 'resize-upload-v3-1', 'resize-upload-v3-2'].includes(type)) return [];
  const selected = (config.rows || []).filter(row => row.selected);
  const folders = type === 'resize-upload-v3-2'
    ? (selected.length ? config.source_folders || [] : [])
    : selected.flatMap(row => row.input_folders || []);
  return [...new Set(folders.filter(isDriveFolder))];
}

export function resizeDriveRowError(type, config, row) {
  const folders = type === 'resize-upload-v3-2'
    ? (row.selected ? config.source_folders || [] : []) : row.input_folders || [];
  return folders.map(path => config.drive_imports?.[path]).find(result => result?.message && result.status !== 'complete')?.message || '';
}

// Resolve before preview/admission, so partial files never reach a resize executor.
export async function prepareResizeDriveInputs(nodeId, get, set) {
  const ownerId = get().currentUser?.id;
  const current = () => get().nodes.find(node => node.id === nodeId);
  const node = current();
  if (!node) throw new Error('Node không còn tồn tại');
  const urls = queuedDriveFolders(node.type, node.data.config || {});
  const failed = [];
  const download = async (url, recovery = false) => {
    if (get().resizeDriveRequest) throw new Error('Đang chuẩn bị Input Drive; hoàn tất hoặc dừng lượt hiện tại trước.');
    const saveSession = result => {
      if (get().currentUser?.id !== ownerId || !current() || get().resizeDriveRequest?.saveSession !== saveSession) return;
      get().updateNodeConfig(nodeId, 'drive_imports', { ...current().data.config.drive_imports, [url]: result });
    };
    const result = await new Promise(resolve => {
      const request = {
        nodeId, ownerId, url, recovery, deferFailure: !recovery, failedCount: failed.length,
        version: node.type.replace('resize-upload-', ''),
        result: current().data.config.drive_imports?.[url], saveSession,
        finish: result => {
          if (get().resizeDriveRequest !== request) return;
          request.cancel?.();
          set({ resizeDriveRequest: null }); resolve(result);
        },
      };
      set({ resizeDriveRequest: request });
    });
    if (!result || get().currentUser?.id !== ownerId || !current()) return null;
    if (result.status && result.status !== 'complete') { failed.push(url); return result; }
    const config = current().data.config;
    const replace = folders => [...new Set((folders || []).map(path => path === url ? result.folder : path))];
    get().updateNodeConfig(nodeId, 'rows', (config.rows || []).map(row => ({ ...row, input_folders: replace(row.input_folders) })));
    for (const field of ['source_folders', 'wiring_folders']) {
      if (config[field]) get().updateNodeConfig(nodeId, field, replace(config[field]));
    }
    get().updateNodeConfig(nodeId, 'short_video_ack', '');
    get().updateNodeConfig(nodeId, 'sheet_label_ack', '');
    const imports = { ...current().data.config.drive_imports };
    delete imports[url];
    get().updateNodeConfig(nodeId, 'drive_imports', imports);
    return result;
  };
  for (const url of urls) {
    if (!await download(url)) return null;
  }
  for (const url of failed) {
    if (!await download(url, true)) return null;
  }
  return current()?.data.config || null;
}
