// Package-local copy of backend/utils/dotPath.js — a .sfpkg must not require() anything
// outside its own package directory (see docs/decisions/0008-custom-node-sandbox-architecture.md:
// no trust boundary allows reaching into the host's backend/ internals), and the path must also
// stay correct regardless of where this package gets installed
// (backend/registry-installs/<packageId>/<version>/), which a "../../backend/..." relative
// require is not. Real third-party packages ship their own dependencies the same way; this
// fixture mirrors that.

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
