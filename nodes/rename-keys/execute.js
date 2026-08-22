const { getPath, setPath, unsetPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function renameByRegex(value, regexRules) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => renameByRegex(v, regexRules));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    let newKey = key;
    for (const rule of regexRules) {
      if (!rule.pattern) continue;
      newKey = newKey.replace(new RegExp(rule.pattern, rule.flags || ''), rule.replacement || '');
    }
    out[newKey] = renameByRegex(val, regexRules);
  }
  return out;
}

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const keys = config.keys || [];
  const regexRules = config.regexRules || [];

  let result = items.map(item => {
    const out = JSON.parse(JSON.stringify(item));
    for (const { from, to } of keys) {
      if (!from || !to) continue;
      const value = getPath(out, from);
      unsetPath(out, from);
      setPath(out, to, value);
    }
    return out;
  });

  if (regexRules.length) {
    result = result.map(item => renameByRegex(item, regexRules));
  }

  return { items: toItems(result) };
};
