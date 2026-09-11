const fs = require('fs');
const ExcelJS = require('exceljs');
const pdfParse = require('pdf-parse');
const { setPath } = require('../../backend/utils/dotPath');

function parseCsv(content, delimiter, header) {
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  const rows = lines.map(line => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        cells.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells;
  });

  if (!header) return rows.map(cells => cells);
  const [headerRow, ...dataRows] = rows;
  return dataRows.map(cells => Object.fromEntries(headerRow.map((h, i) => [h, cells[i]])));
}

async function parseXlsx(filePath, header) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows = [];
  let headerValues = null;
  sheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1); // exceljs rows are 1-indexed, index 0 is empty
    if (header && rowNumber === 1) {
      headerValues = values;
      return;
    }
    if (header && headerValues) {
      rows.push(Object.fromEntries(headerValues.map((h, i) => [h, values[i]])));
    } else {
      rows.push(values);
    }
  });
  return rows;
}

module.exports = async function execute(inputs, config) {
  const items = inputs.items || [];
  const operation = config.operation || 'csv';
  const sourceBinaryField = config.sourceBinaryField || 'data';
  const destinationFieldName = config.destinationFieldName || 'data';
  const header = config.header !== false;
  const delimiter = config.delimiter || ',';

  const result = [];
  for (const item of items) {
    const bin = item.binary?.[sourceBinaryField];
    if (!bin?.path) continue;

    if (operation === 'csv') {
      const content = fs.readFileSync(bin.path, 'utf8');
      for (const row of parseCsv(content, delimiter, header)) result.push({ json: row });
      continue;
    }

    if (operation === 'xlsx') {
      for (const row of await parseXlsx(bin.path, header)) result.push({ json: row });
      continue;
    }

    if (operation === 'json') {
      const data = JSON.parse(fs.readFileSync(bin.path, 'utf8'));
      if (Array.isArray(data)) {
        for (const row of data) result.push({ json: row });
      } else {
        result.push({ json: data });
      }
      continue;
    }

    if (operation === 'pdf') {
      const parsed = await pdfParse(fs.readFileSync(bin.path));
      const out = { json: {} };
      setPath(out.json, destinationFieldName, parsed.text);
      result.push(out);
      continue;
    }

    if (operation === 'toBase64') {
      const out = { json: {} };
      setPath(out.json, destinationFieldName, fs.readFileSync(bin.path).toString('base64'));
      result.push(out);
      continue;
    }

    // text
    const out = { json: {} };
    setPath(out.json, destinationFieldName, fs.readFileSync(bin.path, 'utf8'));
    result.push(out);
  }

  return { items: result };
};
