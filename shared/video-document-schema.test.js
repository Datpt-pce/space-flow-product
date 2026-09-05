// 08-B B1 — pure unit tests for migrateCompositionDocument()/CURRENT_SCHEMA_VERSION. No DB.
// Run with: node shared/video-document-schema.test.js

const assert = require('assert');
const { CURRENT_SCHEMA_VERSION, migrateCompositionDocument } = require('./video-document-schema');

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

check('CURRENT_SCHEMA_VERSION is 1 (only version that exists today)', () => {
  assert.strictEqual(CURRENT_SCHEMA_VERSION, 1);
});

check('migrateCompositionDocument(): already-current document (schemaVersion:1) passes through deterministically', () => {
  const doc = { schemaVersion: 1, tracks: [] };
  const result1 = migrateCompositionDocument(doc);
  const result2 = migrateCompositionDocument(doc);
  assert.deepStrictEqual(result1, doc);
  assert.deepStrictEqual(result1, result2);
});

check('migrateCompositionDocument(): missing schemaVersion treated as implicit v1 (0020 precedent)', () => {
  const doc = { tracks: [] };
  const result = migrateCompositionDocument(doc);
  assert.deepStrictEqual(result, doc);
});

check('migrateCompositionDocument(): throws on non-object input', () => {
  assert.throws(() => migrateCompositionDocument(null), /phải là object/);
  assert.throws(() => migrateCompositionDocument('nope'), /phải là object/);
});

check('migrateCompositionDocument(): throws loudly on a schemaVersion newer than this code knows about', () => {
  assert.throws(() => migrateCompositionDocument({ schemaVersion: 99 }), /mới hơn CURRENT_SCHEMA_VERSION/);
});

console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exitCode = 1;
