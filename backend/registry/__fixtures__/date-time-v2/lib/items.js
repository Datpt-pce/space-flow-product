// Package-local copy of backend/utils/items.js — see lib/dotPath.js's header comment for why a
// .sfpkg ships its own copy instead of require()ing out of the host's backend/ tree.

function toItems(plainArray) {
  return (plainArray || []).map(json => ({ json }));
}

function fromItems(items) {
  return (items || []).map(it => it.json);
}

module.exports = { toItems, fromItems };
