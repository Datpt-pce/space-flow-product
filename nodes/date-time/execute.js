const { DateTime } = require('luxon');
const { getPath, setPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

const PARTS = {
  year: dt => dt.year,
  month: dt => dt.month,
  day: dt => dt.day,
  hour: dt => dt.hour,
  minute: dt => dt.minute,
  second: dt => dt.second,
  weekday: dt => dt.weekday,
};

function parseDate(value, timezone) {
  const opts = timezone ? { zone: timezone } : undefined;
  if (value === undefined || value === null || value === '') return DateTime.now();
  let dt = DateTime.fromISO(String(value), opts);
  if (!dt.isValid) {
    const ms = Date.parse(value);
    dt = Number.isNaN(ms) ? DateTime.invalid('unparseable') : DateTime.fromMillis(ms, opts);
  }
  return dt;
}

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const operation = config.operation || 'getCurrentDate';
  const dateField = config.dateField || '';
  const outputFieldName = config.outputFieldName || 'result';
  const timezone = config.timezone || undefined;

  const process = (item) => {
    const out = { ...item };
    const dt = parseDate(dateField ? getPath(item, dateField) : undefined, timezone);
    let result;

    switch (operation) {
      case 'addToDate':
        result = dt.plus({ [config.timeUnit || 'days']: Number(config.magnitude) || 0 }).toISO();
        break;
      case 'subtractFromDate':
        result = dt.minus({ [config.timeUnit || 'days']: Number(config.magnitude) || 0 }).toISO();
        break;
      case 'formatDate':
        result = config.format ? dt.toFormat(config.format) : dt.toISO();
        break;
      case 'extractDate':
        result = (PARTS[config.part] || PARTS.year)(dt);
        break;
      case 'getTimeBetweenDates': {
        const endDt = parseDate(getPath(item, config.endDateField || ''), timezone);
        const unit = config.units || 'days';
        result = endDt.diff(dt, unit).toObject()[unit];
        break;
      }
      case 'roundDate': {
        const unit = config.toNearest || 'day';
        result = (config.roundMode === 'roundUp' ? dt.endOf(unit) : dt.startOf(unit)).toISO();
        break;
      }
      case 'getCurrentDate':
      default:
        result = DateTime.now().toISO();
    }

    setPath(out, outputFieldName, result);
    return out;
  };

  return { items: toItems(items.map(process)) };
};
