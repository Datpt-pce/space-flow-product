// Sheet Phase 3 + 4: proves backend/services/googleSheets.js's URL-building, gid resolution, and
// error mapping against a mocked global.fetch — no real Google credentials needed (this session
// doesn't have any yet, see 03-spreadsheet.md §0 hand-off note), so this only verifies the
// request shape / response parsing, not a live call.
//
// Run with: node backend/services/googleSheets.test.js

const assert = require('assert');
const { GoogleSheetsApiError, quoteSheetTitle, resolveTabTitle, fetchValues } = require('./googleSheets');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

check('quoteSheetTitle: tên đơn giản không quote, tên có khoảng trắng/ký tự đặc biệt thì quote', () => {
  assert.strictEqual(quoteSheetTitle('Sheet1'), 'Sheet1');
  assert.strictEqual(quoteSheetTitle('Sheet 1'), "'Sheet 1'");
  assert.strictEqual(quoteSheetTitle("O'Brien Data"), "'O''Brien Data'");
});

async function run() {
  const originalFetch = global.fetch;

  await checkAsync('resolveTabTitle: gid khớp trả đúng title, gid null trả tab đầu tiên', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }, { properties: { sheetId: 999, title: 'Tab Hai' } }] }),
    });
    const first = await resolveTabTitle('abc', null, { apiKey: 'k' });
    assert.strictEqual(first, 'Sheet1');
    const matched = await resolveTabTitle('abc', '999', { apiKey: 'k' });
    assert.strictEqual(matched, 'Tab Hai');
  });

  await checkAsync('resolveTabTitle: gid không tồn tại -> GoogleSheetsApiError 404', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] }),
    });
    await assert.rejects(
      () => resolveTabTitle('abc', '12345', { apiKey: 'k' }),
      (err) => err instanceof GoogleSheetsApiError && err.status === 404
    );
  });

  await checkAsync('fetchValues: sheet riêng tư (403) -> GoogleSheetsApiError giữ nguyên status, không throw raw', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'The caller does not have permission' } }),
    });
    await assert.rejects(
      () => fetchValues('abc', 'Sheet1', { apiKey: 'k' }),
      (err) => err instanceof GoogleSheetsApiError && err.status === 403 && /permission/.test(err.message)
    );
  });

  await checkAsync('fetchValues: dùng accessToken thì gắn Authorization header, không gắn ?key=', async () => {
    let capturedUrl = null;
    let capturedOptions = null;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return { ok: true, json: async () => ({ values: [['a']] }) };
    };
    const values = await fetchValues('abc', 'Sheet 1', { accessToken: 'tok-123' });
    assert.deepStrictEqual(values, [['a']]);
    assert.ok(!String(capturedUrl).includes('key='));
    assert.strictEqual(capturedOptions.headers.Authorization, 'Bearer tok-123');
    assert.ok(String(capturedUrl).includes("'Sheet%201'") || String(capturedUrl).includes(encodeURIComponent("'Sheet 1'")));
  });

  global.fetch = originalFetch;

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
