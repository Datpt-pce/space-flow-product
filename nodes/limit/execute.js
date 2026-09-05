const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const maxItems = Math.max(1, Number(config.maxItems) || 1);
  const keep = config.keep || 'firstItems';
  const result = keep === 'lastItems' ? items.slice(-maxItems) : items.slice(0, maxItems);
  return { items: toItems(result) };
};
