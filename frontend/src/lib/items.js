// Frontend-side mirror of backend/utils/items.js — small helpers for the Item[]
// envelope ({ json, binary? }), used by DataViewer (display) and the auto-ListNode
// wiring in store.js (extracting real paths out of migrated node output).

export function normalizeToItems(raw) {
  if (!Array.isArray(raw)) return raw;
  if (raw.length === 0) return raw;
  const looksLikeItems = raw.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'json' in x);
  if (looksLikeItems) return raw;
  return raw.map(value => ({ json: value }));
}

export function itemToPath(item, field = 'data') {
  return item?.binary?.[field]?.path;
}
