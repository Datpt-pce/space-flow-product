const { evaluateConditions } = require('../../backend/utils/conditions');

module.exports = async function execute(inputs, config) {
  const items = inputs.items || [];
  const rules = config.rules || [];
  const ignoreCase = config.ignoreCase !== false;
  const fallbackEnabled = config.fallbackOutput === 'extra';
  const allMatching = !!config.allMatchingOutputs;

  const portId = (i) => `output${i}`;
  const result = {};
  rules.forEach((_, i) => { result[portId(i)] = []; });
  if (fallbackEnabled) result.fallback = [];

  // Routing only — rules read item.json, but the whole Item (json + binary) is
  // forwarded untouched so branching never drops data.
  for (const item of items) {
    const record = item?.json ?? item;
    let matched = false;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (evaluateConditions(record, rule.conditions || [], rule.combinator || 'and', ignoreCase)) {
        result[portId(i)].push(item);
        matched = true;
        if (!allMatching) break;
      }
    }
    if (!matched && fallbackEnabled) result.fallback.push(item);
  }

  return result;
};
