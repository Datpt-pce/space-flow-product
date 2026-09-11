// Tiny UTC-based date helper — replaces this fixture's original `require('luxon')` dependency.
//
// WHY: bundleExecutor() (backend/sandbox/js-runtime.js) resolves bare npm imports relative to
// the FILE's own on-disk location, walking up for the nearest node_modules — which works when
// bundling straight from nodes/date-time/execute.js (luxon lives in nodes/node_modules/), but
// breaks once this fixture is packed into a .sfpkg and installed to
// backend/registry-installs/date-time/1.0.0/ (no node_modules anywhere in that subtree at all).
// There is no dependency-installation step for registry packages yet (`install()` in
// backend/registry/install.js only extracts the archive) — see
// docs/issues/2026-08-28-sfpkg-npm-dependency-not-installed.md. Until that exists, any .sfpkg
// with a real npm dependency cannot run once installed, so this fixture (whose only job is
// proving the packageId@version wiring works end-to-end) drops the dependency instead of
// silently masking that gap behind a working demo. The real built-in nodes/date-time/ node is
// untouched and keeps using luxon in-process, same as before.
//
// All operations are UTC-only (no timezone support) — a deliberate reduction versus the
// luxon-backed original, acceptable here because nothing outside this fixture depends on its
// exact output.

const UNIT_TO_MS = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

function addUnit(date, unit, amount) {
  if (unit in UNIT_TO_MS) return new Date(date.getTime() + amount * UNIT_TO_MS[unit]);
  const d = new Date(date.getTime());
  if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + amount);
  else if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() + amount);
  else throw new Error(`Unsupported time unit: ${unit}`);
  return d;
}

function startOf(date, unit) {
  const d = new Date(date.getTime());
  switch (unit) {
    case 'year': d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0); break;
    case 'month': d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); break;
    case 'hour': d.setUTCMinutes(0, 0, 0); break;
    case 'minute': d.setUTCSeconds(0, 0); break;
    case 'second': d.setUTCMilliseconds(0); break;
    case 'day':
    default: d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}

function endOf(date, unit) {
  const start = startOf(date, unit);
  const nextUnit = { year: 'years', month: 'months', day: 'days', hour: 'hours', minute: 'minutes', second: 'seconds' }[unit] || 'days';
  return new Date(addUnit(start, nextUnit, 1).getTime() - 1);
}

function diffInUnit(fromDate, toDate, unit) {
  const ms = toDate.getTime() - fromDate.getTime();
  if (unit in UNIT_TO_MS) return Math.trunc(ms / UNIT_TO_MS[unit]);
  if (unit === 'months') return Math.trunc(ms / UNIT_TO_MS.days / 30);
  if (unit === 'years') return Math.trunc(ms / UNIT_TO_MS.days / 365);
  throw new Error(`Unsupported time unit: ${unit}`);
}

const PAD2 = n => String(n).padStart(2, '0');

// Minimal token formatter — just the handful of tokens this fixture's `format` config exposes,
// not luxon's full token language.
function formatWithTokens(date, format) {
  return format
    .replace(/yyyy/g, date.getUTCFullYear())
    .replace(/MM/g, PAD2(date.getUTCMonth() + 1))
    .replace(/dd/g, PAD2(date.getUTCDate()))
    .replace(/HH/g, PAD2(date.getUTCHours()))
    .replace(/mm/g, PAD2(date.getUTCMinutes()))
    .replace(/ss/g, PAD2(date.getUTCSeconds()));
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ISO 8601 UTC ("Z"-suffixed), matching luxon's toISO() shape closely enough for this fixture's
// purposes.
function toISO(date) {
  return date.toISOString();
}

// getUTCDay() is 0=Sunday..6=Saturday; luxon's .weekday is 1=Monday..7=Sunday — convert to match.
function isoWeekday(date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

module.exports = { addUnit, startOf, endOf, diffInUnit, formatWithTokens, parseDate, toISO, isoWeekday };
