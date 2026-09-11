const { evaluateConditions } = require('../../backend/utils/conditions');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const conditions = config.conditions || [];
  const combinator = config.combinator || 'and';
  const ignoreCase = config.ignoreCase !== false;

  const kept = [];
  const discarded = [];
  for (const item of items) {
    if (evaluateConditions(item, conditions, combinator, ignoreCase)) kept.push(item);
    else discarded.push(item);
  }

  return { kept: toItems(kept), discarded: toItems(discarded) };
};
