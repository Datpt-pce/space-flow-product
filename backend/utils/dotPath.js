// Minimal dot-notation get/set/unset helpers, shared by data-transform nodes
// (rename-keys, split-out, aggregate, summarize) that need to read/write nested
// fields like "address.city" or "tags[0]" without adding a lodash dependency.

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function toParts(path) {
  return String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of toParts(path)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = toParts(path);
  if (parts.some(p => UNSAFE_KEYS.has(p))) return obj;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[part] == null || typeof cur[part] !== 'object') {
      cur[part] = nextIsIndex ? [] : {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function unsetPath(obj, path) {
  const parts = toParts(path);
  if (parts.some(p => UNSAFE_KEYS.has(p))) return obj;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null) return obj;
    cur = cur[parts[i]];
  }
  if (cur != null) delete cur[parts[parts.length - 1]];
  return obj;
}

module.exports = { getPath, setPath, unsetPath };
