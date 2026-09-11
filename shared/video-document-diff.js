// Compare entities by stable id so a track reorder is not reported as replacing
// every clip. Paths double as locators for review and conflict inspection.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function documentDiff(before, after, path = '') {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].every(v => v && typeof v === 'object' && v.id)) {
    const left = Object.fromEntries(before.map(v => [v.id, v]));
    const right = Object.fromEntries(after.map(v => [v.id, v]));
    return documentDiff(left, right, path);
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key => documentDiff(before[key], after[key], `${path}/${key}`));
  }
  return [{ path: path || '/', kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed', before, after }];
}
module.exports = { canonicalJson, documentDiff };
