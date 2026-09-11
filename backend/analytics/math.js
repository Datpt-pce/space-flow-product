const DAY = 86400000;
const dayOf = at => new Date(at).toISOString().slice(0, 10);
function union(spans) {
  const result = [];
  for (const [start, end] of spans.filter(s => s[1] > s[0]).sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
const duration = spans => union(spans).reduce((sum, [a, b]) => sum + b - a, 0);
function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}
function splitDays(start, end) {
  const parts = [];
  while (start < end) { const next = Math.min(end, (Math.floor(start / DAY) + 1) * DAY); parts.push([dayOf(start), start, next]); start = next; }
  return parts;
}
module.exports = { DAY, dayOf, union, duration, percentile, splitDays };
