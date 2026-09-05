const cheerio = require('cheerio');
const { getPath, setPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fillTemplate(template, item) {
  return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, path) => escapeHtml(getPath(item, path)));
}

function extractOne($, el, rule) {
  const $el = $(el);
  switch (rule.returnValue) {
    case 'html': return $el.html();
    case 'attribute': return $el.attr(rule.attribute || '');
    case 'value': return $el.val();
    case 'text':
    default: return $el.text().trim();
  }
}

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const operation = config.operation || 'extractHtmlContent';

  if (operation === 'generateHtmlTemplate') {
    const template = config.htmlTemplate || '';
    const destinationFieldName = config.destinationFieldName || 'html';
    const result = items.map(item => {
      const out = { ...item };
      setPath(out, destinationFieldName, fillTemplate(template, item));
      return out;
    });
    return { items: toItems(result) };
  }

  if (operation === 'convertToHtmlTable') {
    const capitalizeHeaders = config.capitalizeHeaders !== false;
    const columns = items.length ? Object.keys(items[0]) : [];
    const headerCell = (c) => (capitalizeHeaders ? c.charAt(0).toUpperCase() + c.slice(1) : c);
    const headerRow = `<tr>${columns.map(c => `<th>${escapeHtml(headerCell(c))}</th>`).join('')}</tr>`;
    const rows = items
      .map(item => `<tr>${columns.map(c => `<td>${escapeHtml(item[c])}</td>`).join('')}</tr>`)
      .join('');
    const html = `<table><thead>${headerRow}</thead><tbody>${rows}</tbody></table>`;
    return { items: toItems([{ html }]) };
  }

  // extractHtmlContent
  const field = config.field || '';
  const extractionValues = config.extractionValues || [];
  const result = items.map(item => {
    const source = String((field ? getPath(item, field) : item) ?? '');
    const $ = cheerio.load(source);
    const out = {};
    for (const rule of extractionValues) {
      if (!rule.key || !rule.selector) continue;
      const values = $(rule.selector).toArray().map(el => extractOne($, el, rule));
      out[rule.key] = rule.returnArray ? values : (values.length <= 1 ? values[0] : values);
    }
    return out;
  });
  return { items: toItems(result) };
};
