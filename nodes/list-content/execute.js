// Pure text/table content (not files) — always the generic json envelope, never
// pathToItem, unlike list/list-all which hold actual file paths.
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const mode = config?.mode || 'text';
  const _raw = inputs?.items;
  const incoming = Array.isArray(_raw)
    ? fromItems(_raw)
    : (typeof _raw === 'string' && _raw.trim()
        ? _raw.split('\n').map(s => s.trim()).filter(Boolean)
        : []);

  if (mode === 'table') {
    const headers = config?.headers || [];
    const dataRows = config?.rows || [];
    const rowObjects = dataRows.map(row =>
      Object.fromEntries(headers.map((h, i) => [h || `Col${i + 1}`, row[i] ?? '']))
    );
    return { rows: toItems([...rowObjects, ...incoming]) };
  }

  const configItems = config?.items || [];
  return { rows: toItems([...configItems, ...incoming]) };
};
