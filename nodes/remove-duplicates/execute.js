const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const compare = config.compare || 'allFields';
  const fields = (config.fields || '').split(',').map(s => s.trim()).filter(Boolean);

  const keyOf = (item) => {
    if (compare === 'selectedFields' && fields.length) {
      return JSON.stringify(fields.map(f => getPath(item, f)));
    }
    return JSON.stringify(item);
  };

  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return { items: toItems(result) };
};
