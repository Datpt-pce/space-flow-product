// Nhận diện paste tab-delimited (copy từ spreadsheet) thành bảng, ngược lại coi là text nhiều dòng.
export function parsePaste(text) {
  const lines = text.trimEnd().split('\n').map(l => l.trimEnd());
  const nonEmpty = lines.filter(l => l.length > 0);
  const hasTabs = nonEmpty.some(l => l.includes('\t'));
  if (hasTabs) {
    const allRows = nonEmpty.map(l => l.split('\t'));
    const [headerRow, ...dataRows] = allRows;
    return { mode: 'table', headers: headerRow, rows: dataRows };
  }
  return { mode: 'text', items: nonEmpty };
}
