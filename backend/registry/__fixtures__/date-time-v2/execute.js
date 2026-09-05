const { getPath, setPath } = require('./lib/dotPath');
const { toItems, fromItems } = require('./lib/items');
const simpleDate = require('./lib/simpleDate');

const PARTS = {
  year: d => d.getUTCFullYear(),
  month: d => d.getUTCMonth() + 1,
  day: d => d.getUTCDate(),
  hour: d => d.getUTCHours(),
  minute: d => d.getUTCMinutes(),
  second: d => d.getUTCSeconds(),
  weekday: d => simpleDate.isoWeekday(d),
};

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const operation = config.operation || 'getCurrentDate';
  const dateField = config.dateField || '';
  const outputFieldName = config.outputFieldName || 'result';

  const process = (item) => {
    const out = { ...item };
    const raw = dateField ? getPath(item, dateField) : undefined;
    const date = simpleDate.parseDate(raw) || new Date(NaN);
    let result;

    switch (operation) {
      case 'addToDate':
        result = simpleDate.toISO(simpleDate.addUnit(date, config.timeUnit || 'days', Number(config.magnitude) || 0));
        break;
      case 'subtractFromDate':
        result = simpleDate.toISO(simpleDate.addUnit(date, config.timeUnit || 'days', -(Number(config.magnitude) || 0)));
        break;
      case 'formatDate':
        result = config.format ? simpleDate.formatWithTokens(date, config.format) : simpleDate.toISO(date);
        break;
      case 'extractDate':
        result = (PARTS[config.part] || PARTS.year)(date);
        break;
      case 'getTimeBetweenDates': {
        const endDate = simpleDate.parseDate(getPath(item, config.endDateField || '')) || new Date(NaN);
        const unit = config.units || 'days';
        result = simpleDate.diffInUnit(date, endDate, unit);
        break;
      }
      case 'roundDate': {
        const unit = config.toNearest || 'day';
        result = simpleDate.toISO(config.roundMode === 'roundUp' ? simpleDate.endOf(date, unit) : simpleDate.startOf(date, unit));
        break;
      }
      case 'getCurrentDate':
      default:
        result = simpleDate.toISO(new Date());
    }

    setPath(out, outputFieldName, result);
    return out;
  };

  return { items: toItems(items.map(process)) };
};
