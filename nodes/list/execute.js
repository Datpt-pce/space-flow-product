const { wrapMixed, unwrapMixed } = require('../../backend/utils/items');

// Beta: textItems/itemOrder cho phép item text xen kẽ file theo đúng thứ tự user sắp trên UI.
// itemOrder tokens: "file:<idx>" (trỏ vào config.files theo vị trí) / "text:<id>" (trỏ vào
// config.textItems theo id). Absent/rỗng = thứ tự mặc định (files rồi textItems), khớp
// frontend/src/store.js's _listDefaultOrder().
function orderedConfigEntries(config) {
  const files = (config.files || []).filter(f => typeof f === 'string');
  const textItems = config.textItems || [];
  const order = (config.itemOrder && config.itemOrder.length)
    ? config.itemOrder
    : [...files.map((_, i) => `file:${i}`), ...textItems.map(t => `text:${t.id}`)];
  const textById = {};
  for (const t of textItems) textById[t.id] = t.text;

  return order
    .map(token => {
      if (token.startsWith('file:')) return files[parseInt(token.slice(5), 10)];
      const text = textById[token.slice(5)];
      // text item -> { json: text }, không phải string thô (tránh wrapMixed hiểu nhầm thành file path)
      return text !== undefined ? { json: text } : undefined;
    })
    .filter(v => v !== undefined);
}

module.exports = async function execute(inputs, config) {
  const incoming = Array.isArray(inputs?.items) ? unwrapMixed(inputs.items) : [];
  const hasBeta = !!(config?.textItems?.length || config?.itemOrder?.length);
  const configured = hasBeta ? orderedConfigEntries(config) : (config?.files || []);

  const mode = config?.itemMode === 'replace' ? 'replace' : 'append';
  const merged = mode === 'replace'
    ? (inputs?.items !== undefined ? incoming : configured)
    : [...configured, ...incoming];

  return { files: wrapMixed(merged) };
};
