const { toItems, wrapMixed, unwrapMixed } = require('../../backend/utils/items');

// Beta: textItems/tableItems/itemOrder cho phép item file/text/row bảng xen kẽ theo đúng thứ tự
// user sắp trên UI. itemOrder tokens: "file:<idx>" (trỏ vào config.files theo vị trí) /
// "text:<id>" (trỏ vào config.textItems theo id) / "row:<id>" (trỏ vào config.tableItems theo id,
// cells khớp vị trí với config.headers dùng chung cho cả node). Absent/rỗng = thứ tự mặc định
// (files rồi textItems rồi tableItems), khớp frontend/src/store.js's _listDefaultOrder().
function orderedConfigEntries(config) {
  const files = (config.files || []).filter(f => typeof f === 'string');
  const textItems = config.textItems || [];
  const tableItems = config.tableItems || [];
  const headers = config.headers || [];
  const order = (config.itemOrder && config.itemOrder.length)
    ? config.itemOrder
    : [...files.map((_, i) => `file:${i}`), ...textItems.map(t => `text:${t.id}`), ...tableItems.map(t => `row:${t.id}`)];
  const textById = {};
  for (const t of textItems) textById[t.id] = t.text;
  const rowById = {};
  for (const t of tableItems) rowById[t.id] = t.cells;

  return order
    .map(token => {
      if (token.startsWith('file:')) {
        const path = files[parseInt(token.slice(5), 10)];
        return path !== undefined ? { kind: 'file', value: path } : undefined;
      }
      if (token.startsWith('text:')) {
        const text = textById[token.slice(5)];
        // value thô (string) — bucket text đi qua toItems (không phải wrapMixed) nên tự bọc { json }
        // đúng 1 lần ở dưới, không cần tự bọc trước ở đây.
        return text !== undefined ? { kind: 'text', value: text } : undefined;
      }
      if (token.startsWith('row:')) {
        const cells = rowById[token.slice(4)];
        if (cells === undefined) return undefined;
        const row = Object.fromEntries(headers.map((h, i) => [h || `Col${i + 1}`, cells[i] ?? '']));
        return { kind: 'row', value: row };
      }
      return undefined;
    })
    .filter(v => v !== undefined);
}

module.exports = async function execute(inputs, config) {
  const incoming = Array.isArray(inputs?.items) ? unwrapMixed(inputs.items) : [];
  const hasBeta = !!(config?.textItems?.length || config?.tableItems?.length || config?.itemOrder?.length);
  const entries = hasBeta
    ? orderedConfigEntries(config)
    : (config?.files || []).map(f => ({ kind: 'file', value: f }));

  const fileBucket = entries.filter(e => e.kind === 'file').map(e => e.value);
  const textBucket = entries.filter(e => e.kind === 'text').map(e => e.value);
  const rowBucket = entries.filter(e => e.kind === 'row').map(e => e.value);

  // Input port luôn gộp vào nhóm Files — text/rows chỉ thêm được qua UI (kéo file/gõ text/dán bảng).
  const mode = config?.itemMode === 'replace' ? 'replace' : 'append';
  const mergedFiles = mode === 'replace'
    ? (inputs?.items !== undefined ? incoming : fileBucket)
    : [...fileBucket, ...incoming];

  return {
    files: wrapMixed(mergedFiles),
    text: toItems(textBucket),
    rows: toItems(rowBucket),
  };
};
