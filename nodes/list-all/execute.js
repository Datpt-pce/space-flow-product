module.exports = async function execute(inputs, config) {
  const _raw = inputs?.items;

  // Không có data đến: dùng config mode + data thủ công
  if (_raw === undefined || _raw === null) {
    const mode = config?.mode || 'text';
    if (mode === 'files') return { items: config?.files || [] };
    if (mode === 'table') {
      const headers = config?.headers || [];
      return {
        items: (config?.rows || []).map(row =>
          Object.fromEntries(headers.map((h, i) => [h || `Col${i + 1}`, row[i] ?? '']))
        ),
      };
    }
    return { items: config?.items || [] };
  }

  // String từ Text node → chế độ text
  if (typeof _raw === 'string') {
    const textItems = _raw.trim()
      ? _raw.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    return { items: [...(config?.items || []), ...textItems] };
  }

  // Array từ node ảnh/video/list → chế độ files
  if (Array.isArray(_raw)) {
    return { items: [...(config?.files || []), ..._raw] };
  }

  return { items: [] };
};
