// Item[] envelope helpers (docs/product/node-spec/DISCUSSION.md mục 13) — nodes call
// these to produce/consume the standard { json, binary? } shape. The engine itself
// never wraps/unwraps or validates — see executor.js, this is opt-in per node.

const path = require('path');

function toItems(plainArray) {
  return (plainArray || []).map(json => ({ json }));
}

function fromItems(items) {
  return (items || []).map(it => it.json);
}

function pathToItem(filePath, meta = {}) {
  const { mimeType, fileName = path.basename(filePath), field = 'data' } = meta;
  return { json: {}, binary: { [field]: { path: filePath, mimeType, fileName } } };
}

function itemToPath(item, field = 'data') {
  return item?.binary?.[field]?.path;
}

// For "loose bag" nodes (list, list-all, list-content, batch-create-folder) whose entries
// are a mix of bare file path strings and plain JSON records — coerce either direction
// without guessing wrong (already-wrapped Items pass through untouched).
function wrapMixed(arr) {
  return (arr || []).map(v => {
    if (v && typeof v === 'object' && 'json' in v) return v;
    if (typeof v === 'string') return pathToItem(v);
    return { json: v };
  });
}

function unwrapMixed(items) {
  return (items || []).map(it => {
    if (!it || typeof it !== 'object' || !('json' in it)) return it;
    const path = itemToPath(it);
    return path !== undefined ? path : it.json;
  });
}

module.exports = { toItems, fromItems, pathToItem, itemToPath, wrapMixed, unwrapMixed };
