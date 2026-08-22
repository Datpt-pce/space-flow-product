const { getPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function stripFields(obj, skipFields) {
  if (!skipFields.length) return obj;
  const out = { ...obj };
  for (const f of skipFields) delete out[f];
  return out;
}

function isEqual(a, b, fuzzy) {
  if (fuzzy) return String(a) === String(b) || JSON.stringify(a) === JSON.stringify(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = async function execute(inputs, config) {
  const inputA = fromItems(inputs.inputA || []);
  const inputB = fromItems(inputs.inputB || []);
  const matchFields = config.matchFields || [];
  const resolve = config.resolve || 'includeBoth';
  const fuzzyCompare = !!config.fuzzyCompare;
  const skipFields = (config.skipFields || '').split(',').map(s => s.trim()).filter(Boolean);

  const keyOf = (item, side) => {
    if (!matchFields.length) return JSON.stringify(item);
    return matchFields
      .map(m => JSON.stringify(getPath(item, side === 'A' ? m.fieldA : m.fieldB)))
      .join('|');
  };

  const bByKey = new Map();
  for (const item of inputB) {
    const key = keyOf(item, 'B');
    if (!bByKey.has(key)) bByKey.set(key, []);
    bByKey.get(key).push(item);
  }

  const inAOnly = [];
  const same = [];
  const different = [];

  for (const itemA of inputA) {
    const key = keyOf(itemA, 'A');
    const candidates = bByKey.get(key);
    if (!candidates || !candidates.length) {
      inAOnly.push(itemA);
      continue;
    }
    const itemB = candidates.shift();

    const a = stripFields(itemA, skipFields);
    const b = stripFields(itemB, skipFields);
    if (isEqual(a, b, fuzzyCompare)) {
      same.push(itemA);
    } else if (resolve === 'preferInput1') {
      different.push(itemA);
    } else if (resolve === 'preferInput2') {
      different.push(itemB);
    } else if (resolve === 'mix') {
      different.push({ ...itemB, ...itemA });
    } else {
      different.push({ inputA: itemA, inputB: itemB });
    }
  }

  const inBOnly = [];
  for (const arr of bByKey.values()) {
    inBOnly.push(...arr);
  }

  return { inAOnly: toItems(inAOnly), same: toItems(same), different: toItems(different), inBOnly: toItems(inBOnly) };
};
