const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const fields = (config.fields || '').split(',').map(s => s.trim()).filter(Boolean);
  const destNamesRaw = (config.destinationNames || '').split(',').map(s => s.trim()).filter(Boolean);
  const includeOtherFields = !!config.includeOtherFields;

  if (!fields.length) return { items: toItems(items) };

  const destNames = fields.map((f, i) => destNamesRaw[i] || f.split(/[.[\]]/).filter(Boolean).pop());

  const result = [];
  for (const item of items) {
    const arrays = fields.map(f => {
      const v = getPath(item, f);
      if (Array.isArray(v)) return v;
      return v === undefined ? [] : [v];
    });
    const maxLen = Math.max(0, ...arrays.map(a => a.length));
    for (let i = 0; i < maxLen; i++) {
      const out = includeOtherFields ? { ...item } : {};
      destNames.forEach((name, fi) => { out[name] = arrays[fi][i]; });
      result.push(out);
    }
  }

  return { items: toItems(result) };
};
