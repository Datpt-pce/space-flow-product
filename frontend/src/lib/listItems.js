// Item model dùng chung của node List (ListNodeBeta.jsx) — trích ra để các chỗ khác (badge/count
// trước khi Run, BatchCreateFolderNode) cũng đọc đúng theo sourceHandle thay vì đoán mò 'files'.
// itemOrder tokens: "file:<idx>" (config.files theo vị trí) / "text:<id>" (config.textItems theo
// id) / "row:<id>" (config.tableItems theo id) — khớp nodes/list/execute.js và store.js.
export function getOrderedListItems(config) {
  const files = (config?.files || []).filter(f => typeof f === 'string');
  const textItems = config?.textItems || [];
  const tableItems = config?.tableItems || [];
  const order = (config?.itemOrder && config.itemOrder.length)
    ? config.itemOrder
    : [...files.map((_, i) => `file:${i}`), ...textItems.map(t => `text:${t.id}`), ...tableItems.map(t => `row:${t.id}`)];
  const textById = {};
  for (const t of textItems) textById[t.id] = t;
  const rowById = {};
  for (const t of tableItems) rowById[t.id] = t;

  return order.map(token => {
    if (token.startsWith('file:')) {
      const idx = parseInt(token.slice(5), 10);
      return files[idx] !== undefined ? { token, kind: 'file', index: idx, path: files[idx] } : null;
    }
    if (token.startsWith('text:')) {
      const item = textById[token.slice(5)];
      return item ? { token, kind: 'text', id: item.id, text: item.text } : null;
    }
    const item = rowById[token.slice(4)];
    return item ? { token, kind: 'row', id: item.id, cells: item.cells } : null;
  }).filter(Boolean);
}

const HANDLE_TO_KIND = { files: 'file', text: 'text', rows: 'row' };

export function countListItemsByKind(config, sourceHandle) {
  const kind = HANDLE_TO_KIND[sourceHandle];
  if (!kind) return 0;
  return getOrderedListItems(config).filter(it => it.kind === kind).length;
}
