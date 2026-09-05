const { getPath } = require('../../backend/utils/dotPath');

function recordOf(item) {
  return item?.json ?? item;
}

// Merges two Items' json fields (unchanged clash logic); the binary attachment,
// if either side has one, rides along with whichever side wins the field clash.
function mergeRow(rowA, rowB, clashResolve) {
  const jsonA = rowA ? recordOf(rowA) : undefined;
  const jsonB = rowB ? recordOf(rowB) : undefined;
  const json = !jsonA ? { ...jsonB } : !jsonB ? { ...jsonA } : (clashResolve === 'preferFirst' ? { ...jsonB, ...jsonA } : { ...jsonA, ...jsonB });
  const binary = clashResolve === 'preferFirst' ? (rowA?.binary || rowB?.binary) : (rowB?.binary || rowA?.binary);
  return binary ? { json, binary } : { json };
}

module.exports = async function execute(inputs, config) {
  const numberInputs = Math.min(10, Math.max(2, Number(config.numberInputs) || 2));
  const branches = [];
  for (let i = 1; i <= numberInputs; i++) branches.push(inputs[`input${i}`] || []);

  const mode = config.mode || 'append';

  if (mode === 'chooseBranch') {
    const idx = Math.min(numberInputs - 1, Math.max(0, Number(config.chooseBranchIndex) || 0));
    return { output: branches[idx] || [] };
  }

  if (mode === 'append') {
    return { output: branches.flat() };
  }

  const [a, b] = branches;
  const joinMode = config.joinMode || 'inner';
  const clashResolve = config.clashResolve || 'preferLast';

  if (mode === 'combineByPosition') {
    const len = Math.max(a.length, b.length);
    const output = [];
    for (let i = 0; i < len; i++) {
      const rowA = a[i];
      const rowB = b[i];
      if (joinMode === 'inner' && (rowA === undefined || rowB === undefined)) continue;
      output.push(mergeRow(rowA, rowB, clashResolve));
    }
    return { output };
  }

  // combineByFields
  const matchFields = config.matchFields || [];
  const keyOf = (item, side) => matchFields
    .map(f => JSON.stringify(getPath(recordOf(item), side === 'a' ? f.field1 : f.field2)))
    .join('|');

  const bByKey = new Map();
  for (const item of b) {
    const key = keyOf(item, 'b');
    if (!bByKey.has(key)) bByKey.set(key, []);
    bByKey.get(key).push(item);
  }

  const output = [];
  for (const itemA of a) {
    const key = keyOf(itemA, 'a');
    const candidates = bByKey.get(key);
    if (candidates && candidates.length) {
      output.push(mergeRow(itemA, candidates.shift(), clashResolve));
    } else if (joinMode !== 'inner') {
      output.push(mergeRow(itemA, undefined, clashResolve));
    }
  }

  if (joinMode === 'outer') {
    for (const arr of bByKey.values()) {
      for (const itemB of arr) output.push(mergeRow(undefined, itemB, clashResolve));
    }
  }

  return { output };
};
