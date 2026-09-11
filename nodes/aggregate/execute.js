const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const mode = config.mode || 'fields';

  if (mode === 'allData') {
    const destField = config.destinationFieldName || 'data';
    return { items: toItems([{ [destField]: items }]) };
  }

  const fieldsToAggregate = config.fieldsToAggregate || [];
  const mergeLists = !!config.mergeLists;
  const out = {};

  for (const { field, outputFieldName } of fieldsToAggregate) {
    if (!field) continue;
    const name = outputFieldName || field;
    const values = items.map(item => getPath(item, field));
    out[name] = mergeLists
      ? values.flatMap(v => (Array.isArray(v) ? v : [v]))
      : values;
  }

  return { items: toItems([out]) };
};
