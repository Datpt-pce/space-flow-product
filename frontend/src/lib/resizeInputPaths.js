export const normalizedPath = value => String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
export function replaceInputPath(value, source, destination) {
  const current = normalizedPath(value), from = normalizedPath(source);
  const windows = /^[A-Za-z]:\//.test(from) || from.startsWith('//');
  const a = windows ? current.toLowerCase() : current, b = windows ? from.toLowerCase() : from;
  if (a !== b && !a.startsWith(b + '/')) return value;
  return destination ? normalizedPath(destination) + current.slice(from.length) : null;
}
export function inputActionConfig(config, result) {
  const to = result.deleted ? null : result.destination;
  const remap = value => replaceInputPath(value, result.source, to);
  const paths = list => (list || []).map(remap).filter(Boolean);
  const next = { ...config, short_video_ack: '', sheet_label_ack: '',
    input_theme_overrides: Object.fromEntries(Object.entries(config.input_theme_overrides || {}).filter(([key]) => remap(key) === key)) };
  // Existing upstream outputs may still contain the old path; map them on execution too.
  next.input_path_changes = [...(config.input_path_changes || []), { source: result.source, destination: to }];
  next.rows = (config.rows || []).map(row => ({ ...row, input_folders: paths(row.input_folders) }));
  for (const field of ['source_folders', 'wiring_folders']) if (config[field]) next[field] = paths(config[field]);
  for (const field of ['input_overrides', 'sheet_label_overrides']) if (config[field]) {
    next[field] = Object.fromEntries(Object.entries(config[field]).map(([key, value]) => [remap(key), value]).filter(([key]) => key));
  }
  return next;
}

export function inputTree(preview) {
  if (preview.input_tree) return preview.input_tree;
  const roots = [...new Set(preview.source_roots || preview.recognition?.roots || [])].map(path => ({ path, folder: true, children: [] }));
  const add = (path, folder = false) => {
    const root = roots.find(item => replaceInputPath(path, item.path, '__root__') !== path);
    if (!root || normalizedPath(root.path) === normalizedPath(path)) return;
    const relative = normalizedPath(path).slice(normalizedPath(root.path).length + 1).split('/');
    let parent = root;
    relative.forEach((part, index) => {
      const childPath = normalizedPath(parent.path) + '/' + part;
      let child = parent.children.find(item => normalizedPath(item.path) === childPath);
      if (!child) { child = { path: childPath, folder: folder || index < relative.length - 1, children: [] }; parent.children.push(child); }
      parent = child;
    });
  };
  for (const row of preview.rows || []) for (const theme of row.themes) for (const lang of theme.languages) {
    add(lang.path, true);
    for (const video of lang.videos) add(video.path);
  }
  for (const record of preview.recognition?.records || []) add(record.path);
  return roots;
}
