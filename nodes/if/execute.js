const { evaluateConditions } = require('../../backend/utils/conditions');

module.exports = async function execute(inputs, config) {
  const items = inputs.items || [];
  const conditions = config.conditions || [];
  const combinator = config.combinator || 'and';
  const ignoreCase = config.ignoreCase !== false;

  // Routing only — condition reads item.json, but the whole Item (json + binary)
  // is forwarded untouched so branching never drops data (docs/product/node-spec/
  // DISCUSSION.md mục 13).
  const trueItems = [];
  const falseItems = [];
  for (const item of items) {
    const record = item?.json ?? item;
    if (evaluateConditions(record, conditions, combinator, ignoreCase)) trueItems.push(item);
    else falseItems.push(item);
  }

  return { true: trueItems, false: falseItems };
};
