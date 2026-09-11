// Shared condition evaluator for Filter/If (and similar "route by field
// comparison" nodes) — a simple field/operator/value combinator, not a full
// expression engine (space-flow has none).
const { getPath } = require('./dotPath');

function isEmptyValue(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function compare(fieldValue, operator, value) {
  switch (operator) {
    case 'equals': return fieldValue == value; // eslint-disable-line eqeqeq
    case 'notEquals': return fieldValue != value; // eslint-disable-line eqeqeq
    case 'greaterThan': return Number(fieldValue) > Number(value);
    case 'lessThan': return Number(fieldValue) < Number(value);
    case 'greaterThanOrEqual': return Number(fieldValue) >= Number(value);
    case 'lessThanOrEqual': return Number(fieldValue) <= Number(value);
    case 'contains': return String(fieldValue ?? '').includes(String(value));
    case 'notContains': return !String(fieldValue ?? '').includes(String(value));
    case 'startsWith': return String(fieldValue ?? '').startsWith(String(value));
    case 'endsWith': return String(fieldValue ?? '').endsWith(String(value));
    case 'isEmpty': return isEmptyValue(fieldValue);
    case 'isNotEmpty': return !isEmptyValue(fieldValue);
    default: return false;
  }
}

function evaluateConditions(item, conditions, combinator, ignoreCase) {
  if (!conditions || !conditions.length) return true;

  const results = conditions.map(({ field, operator, value }) => {
    let fieldValue = getPath(item, field);
    let compareValue = value;
    if (ignoreCase && typeof fieldValue === 'string' && typeof compareValue === 'string') {
      fieldValue = fieldValue.toLowerCase();
      compareValue = compareValue.toLowerCase();
    }
    return compare(fieldValue, operator, compareValue);
  });

  return combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

module.exports = { evaluateConditions };
