// Sheet Phase 3 + 4 (specs/space-flow-master-plan/03-spreadsheet.md §2, §4): thin REST client for
// the Google Sheets API v4 — no `googleapis` dependency (per §2's research note: "chỉ cần gọi REST
// trực tiếp spreadsheets.values.batchGet/batchUpdate bằng access token, không cần kéo googleapis
// nặng nề"). Public (API key, Phase 3) and OAuth (access token, Phase 4's sheetSyncWorker) share
// the same fetchValues() — only the auth parameter differs.

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

// A1 sheet-title prefix needs single-quoting whenever the title itself isn't a bare identifier
// (contains a space, punctuation, or a leading digit) — otherwise Google's own quoting rules
// would misparse e.g. `Sheet 1!A1:Z100`. A literal `'` inside the title is escaped as `''`.
function quoteSheetTitle(title) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(title)) return title;
  return `'${title.replace(/'/g, "''")}'`;
}

class GoogleSheetsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GoogleSheetsApiError';
    this.status = status;
  }
}

async function googleFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || `Google Sheets API trả lỗi HTTP ${res.status}`;
    throw new GoogleSheetsApiError(message, res.status);
  }
  return res.json();
}

// fetchSpreadsheetMetadata(spreadsheetId, auth) -> [{ sheetId, title }, ...] (auth = { apiKey } or
// { accessToken }) — used to resolve a URL's ?gid=NNN to the actual tab title batchGet needs (the
// gid itself isn't a valid A1 range prefix).
async function fetchSpreadsheetMetadata(spreadsheetId, auth) {
  const url = new URL(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set('fields', 'sheets.properties(sheetId,title)');
  if (auth.apiKey) url.searchParams.set('key', auth.apiKey);

  const res = await fetch(url, auth.accessToken ? { headers: { Authorization: `Bearer ${auth.accessToken}` } } : undefined);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GoogleSheetsApiError(body?.error?.message || `Google Sheets API trả lỗi HTTP ${res.status}`, res.status);
  }
  const data = await res.json();
  return (data.sheets || []).map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title }));
}

// resolveTabTitle(spreadsheetId, gid, auth) -> tab title matching `gid` (or the first tab if gid
// is null/undefined — the common case when a URL has no #gid= fragment).
async function resolveTabTitle(spreadsheetId, gid, auth) {
  const tabs = await fetchSpreadsheetMetadata(spreadsheetId, auth);
  if (!tabs.length) throw new GoogleSheetsApiError('Spreadsheet không có tab nào', 404);
  if (gid === null || gid === undefined) return tabs[0].title;
  const match = tabs.find((t) => String(t.sheetId) === String(gid));
  if (!match) throw new GoogleSheetsApiError(`Không tìm thấy tab với gid=${gid} trong spreadsheet`, 404);
  return match.title;
}

// fetchValues(spreadsheetId, tabTitle, auth) -> 2-D array (UNFORMATTED_VALUE — real
// numbers/booleans, not display strings) for the WHOLE tab. auth = { apiKey } (Phase 3, public
// sheet) or { accessToken } (Phase 4, OAuth-linked sheet, possibly private).
async function fetchValues(spreadsheetId, tabTitle, auth) {
  const range = quoteSheetTitle(tabTitle);
  const url = new URL(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  url.searchParams.set('dateTimeRenderOption', 'FORMATTED_STRING');
  if (auth.apiKey) url.searchParams.set('key', auth.apiKey);

  const res = await fetch(url, auth.accessToken ? { headers: { Authorization: `Bearer ${auth.accessToken}` } } : undefined);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GoogleSheetsApiError(body?.error?.message || `Google Sheets API trả lỗi HTTP ${res.status}`, res.status);
  }
  const data = await res.json();
  return data.values || [];
}

module.exports = { GoogleSheetsApiError, quoteSheetTitle, fetchSpreadsheetMetadata, resolveTabTitle, fetchValues };
