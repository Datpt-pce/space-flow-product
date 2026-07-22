module.exports = async function execute(inputs, config) {
  const mode = config?.mode || 'text';
  const _raw = inputs?.items;
  const incoming = Array.isArray(_raw)
    ? _raw
    : (typeof _raw === 'string' && _raw.trim()
        ? _raw.split('\n').map(s => s.trim()).filter(Boolean)
        : []);

  if (mode === 'table') {
    const headers = config?.headers || [];
    const dataRows = config?.rows || [];
    const rowObjects = dataRows.map(row =>
      Object.fromEntries(headers.map((h, i) => [h || `Col${i + 1}`, row[i] ?? '']))
    );
    return { rows: [...rowObjects, ...incoming] };
  }

  const configItems = config?.items || [];
  return { rows: [...configItems, ...incoming] };
};
