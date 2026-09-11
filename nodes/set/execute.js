function coerce(value, type) {
  switch (type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
    case 'array':
      if (Array.isArray(value)) return value;
      try { return JSON.parse(value); } catch { return [value]; }
    case 'object':
      if (value && typeof value === 'object') return value;
      try { return JSON.parse(value); } catch { return {}; }
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const mode = config.mode || 'manual';

  if (mode === 'raw') {
    const template = config.jsonOutput || {};
    return { items: toItems(items.map(() => JSON.parse(JSON.stringify(template)))) };
  }

  const assignments = config.assignments || [];
  const keepOtherFields = config.keepOtherFields !== false;
  const stripFields = config.stripFields || [];

  const result = items.map(item => {
    const base = keepOtherFields ? { ...item } : {};
    for (const { name, type, value } of assignments) {
      if (!name) continue;
      base[name] = coerce(value, type);
    }
    for (const f of stripFields) delete base[f];
    return base;
  });

  return { items: toItems(result) };
};
