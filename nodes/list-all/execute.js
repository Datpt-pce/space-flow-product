// files mode / files-shaped upstream data → path items (wrapMixed/unwrapMixed);
// text/table modes → generic json items (toItems). "Universal" node, so unlike
// list/list-content this genuinely needs both, picked per branch below.
const { toItems, wrapMixed, unwrapMixed } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const _raw = inputs?.items;

  // Không có data đến: dùng config mode + data thủ công
  if (_raw === undefined || _raw === null) {
    const mode = config?.mode || 'text';
    if (mode === 'files') return { items: wrapMixed(config?.files || []) };
    if (mode === 'table') {
      const headers = config?.headers || [];
      return {
        items: toItems((config?.rows || []).map(row =>
          Object.fromEntries(headers.map((h, i) => [h || `Col${i + 1}`, row[i] ?? '']))
        )),
      };
    }
    return { items: toItems(config?.items || []) };
  }

  // String từ Text node → chế độ text
  if (typeof _raw === 'string') {
    const textItems = _raw.trim()
      ? _raw.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    return { items: toItems([...(config?.items || []), ...textItems]) };
  }

  // Array (Item[]) từ node ảnh/video/list → chế độ files
  if (Array.isArray(_raw)) {
    return { items: wrapMixed([...(config?.files || []), ...unwrapMixed(_raw)]) };
  }

  return { items: [] };
};
