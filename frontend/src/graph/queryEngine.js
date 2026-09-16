// Graph Library Phase 5 (specs/space-flow-master-plan/02-graph-library.md): minimal filter query
// syntax over a graph entity — `type:workflow`, `owner:me`, `date:>2026-01-01`, combined with AND
// (space-separated clauses). Pure/client-side by design (Phase 5 risk note: round-tripping to the
// API per filter keystroke can't hit the <200ms budget) — Global Graph (Phase 6) filters the page
// already loaded in memory, same as Local Graph does today.

const DATE_OPERATORS = ['>=', '<=', '>', '<'];

function parseClause(token) {
  const sep = token.indexOf(':');
  if (sep === -1) return null;
  const field = token.slice(0, sep);
  let raw = token.slice(sep + 1);
  if (!field || !raw) return null;
  if (field === 'date') {
    const op = DATE_OPERATORS.find((o) => raw.startsWith(o)) || '=';
    if (op !== '=') raw = raw.slice(op.length);
    return { field, op, value: raw };
  }
  return { field, op: '=', value: raw };
}

export function parseQuery(query) {
  return (query || '').trim().split(/\s+/).filter(Boolean).map(parseClause).filter(Boolean);
}

function matchesClause(entity, clause, ctx) {
  const { field, op, value } = clause;
  if (field === 'type') return entity.type === value;
  if (field === 'owner') return entity.ownerId === (value === 'me' ? ctx.currentUserId : value);
  if (field === 'date') {
    const entityDate = entity.updatedAt || entity.createdAt;
    if (!entityDate) return false;
    const a = new Date(entityDate).getTime();
    const b = new Date(value).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    return a === b;
  }
  // Unknown field (e.g. future tag:/status: — 02-graph-library.md §3 phản biện #4: no real data
  // source yet, UI stays "sẵn sàng kỹ thuật (disable/no-op)") — never hide entities over a clause
  // we don't understand.
  return true;
}

// `query` may be a raw string or an already-parsed clause array (color groups reuse this).
export function matchesQuery(entity, query, ctx = {}) {
  const clauses = typeof query === 'string' ? parseQuery(query) : query;
  if (!clauses.length) return true;
  return clauses.every((c) => matchesClause(entity, c, ctx));
}

export function isOrphan(entity) {
  return (entity.degree ?? 0) === 0;
}

// First matching color group wins (declaration order) — falls back to `null` (caller keeps the
// entity's default type color) when nothing matches.
export function resolveGroupColor(entity, colorGroups, ctx = {}) {
  for (const group of colorGroups) {
    if (group.query && matchesQuery(entity, group.query, ctx)) return group.color;
  }
  return null;
}
