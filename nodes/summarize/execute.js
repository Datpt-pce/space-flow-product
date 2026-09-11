const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function aggregate(values, type, separator) {
  switch (type) {
    case 'sum':
      return values.reduce((a, b) => a + (Number(b) || 0), 0);
    case 'avg':
      return values.length ? values.reduce((a, b) => a + (Number(b) || 0), 0) / values.length : 0;
    case 'count':
      return values.length;
    case 'min':
      return values.reduce((a, b) => (b !== undefined && (a === undefined || b < a) ? b : a), undefined);
    case 'max':
      return values.reduce((a, b) => (b !== undefined && (a === undefined || b > a) ? b : a), undefined);
    case 'countUnique':
      return new Set(values.map(v => JSON.stringify(v))).size;
    case 'concatenate':
      return values.join(separator ?? ',');
    default:
      return values;
  }
}

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const splitFields = (config.fieldsToSplitBy || '').split(',').map(s => s.trim()).filter(Boolean);
  const summarize = config.fieldsToSummarize || [];
  const outputFormat = config.outputFormat || 'separateItems';

  const groups = new Map();
  for (const item of items) {
    const keyFields = splitFields.map(f => ({ field: f, value: getPath(item, f) }));
    const key = splitFields.length ? keyFields.map(k => JSON.stringify(k.value)).join('|') : '__all__';
    if (!groups.has(key)) groups.set(key, { keyFields, items: [] });
    groups.get(key).items.push(item);
  }

  const results = [];
  for (const { keyFields, items: groupItems } of groups.values()) {
    const row = {};
    for (const { field, value } of keyFields) row[field] = value;
    for (const { field, aggregation, outputFieldName, separator } of summarize) {
      if (!field || !aggregation) continue;
      const name = outputFieldName || `${aggregation}_${field}`;
      row[name] = aggregate(groupItems.map(item => getPath(item, field)), aggregation, separator);
    }
    results.push(row);
  }

  if (outputFormat === 'singleItem') {
    return { items: toItems([{ groups: results }]) };
  }
  return { items: toItems(results) };
};
