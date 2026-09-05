const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { getPath } = require('../../backend/utils/dotPath');

function csvEscape(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (/["\n]/.test(s) || s.includes(',') || s.includes(';')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, delimiter, header) {
  const columns = rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
  const lines = [];
  if (header && columns.length) lines.push(columns.map(csvEscape).join(delimiter));
  for (const row of rows) {
    lines.push(columns.length ? columns.map(c => csvEscape(row?.[c])).join(delimiter) : csvEscape(row));
  }
  return lines.join('\n');
}

function outPath(uploadsDir, baseName, ext) {
  const fileName = `${baseName || 'output'}-${Date.now()}.${ext}`;
  return { filePath: path.join(uploadsDir, fileName), fileName };
}

function binaryItem(outputBinaryField, filePath, fileName, mimeType) {
  return { json: {}, binary: { [outputBinaryField]: { path: filePath, mimeType, fileName } } };
}

module.exports = async function execute(inputs, config, context) {
  const items = inputs.items || [];
  const operation = config.operation || 'csv';
  const outputBinaryField = config.outputBinaryField || 'data';
  const baseName = config.fileName || 'output';
  const sourceOf = (item) => (config.sourceField ? getPath(item, config.sourceField) : item);

  if (operation === 'csv') {
    const rows = items.map(sourceOf);
    const csv = toCsv(rows, config.delimiter || ',', config.header !== false);
    const { filePath, fileName } = outPath(context.uploadsDir, baseName, 'csv');
    fs.writeFileSync(filePath, csv, 'utf8');
    return { items: [binaryItem(outputBinaryField, filePath, fileName, 'text/csv')] };
  }

  if (operation === 'xlsx') {
    const rows = items.map(sourceOf);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    if (rows.length && rows[0] && typeof rows[0] === 'object') {
      sheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
      sheet.addRows(rows);
    }
    const { filePath, fileName } = outPath(context.uploadsDir, baseName, 'xlsx');
    await workbook.xlsx.writeFile(filePath);
    return { items: [binaryItem(outputBinaryField, filePath, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')] };
  }

  if (operation === 'json') {
    const mode = config.mode || 'once';
    if (mode === 'once') {
      const data = items.map(sourceOf);
      const { filePath, fileName } = outPath(context.uploadsDir, baseName, 'json');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { items: [binaryItem(outputBinaryField, filePath, fileName, 'application/json')] };
    }
    const result = items.map((item, i) => {
      const { filePath, fileName } = outPath(context.uploadsDir, `${baseName}-${i}`, 'json');
      fs.writeFileSync(filePath, JSON.stringify(sourceOf(item), null, 2), 'utf8');
      return binaryItem(outputBinaryField, filePath, fileName, 'application/json');
    });
    return { items: result };
  }

  if (operation === 'text') {
    const result = items.map((item, i) => {
      const text = String(sourceOf(item) ?? '');
      const { filePath, fileName } = outPath(context.uploadsDir, `${baseName}-${i}`, 'txt');
      fs.writeFileSync(filePath, text, 'utf8');
      return binaryItem(outputBinaryField, filePath, fileName, 'text/plain');
    });
    return { items: result };
  }

  if (operation === 'fromBase64') {
    const result = items.map((item, i) => {
      const buf = Buffer.from(String(sourceOf(item) ?? ''), 'base64');
      const { filePath, fileName } = outPath(context.uploadsDir, `${baseName}-${i}`, 'bin');
      fs.writeFileSync(filePath, buf);
      return binaryItem(outputBinaryField, filePath, fileName, 'application/octet-stream');
    });
    return { items: result };
  }

  throw new Error(`Convert to File: unknown operation "${operation}"`);
};
