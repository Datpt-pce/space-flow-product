// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #7): proves
// encrypt()/decrypt() round-trip when the key is set, legacy plaintext passes through unchanged,
// and encrypt() falls back to plaintext when no key is configured (backward compatibility).
//
// Run with: node backend/utils/encryption.test.js

const assert = require('assert');

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

const KEY = require('crypto').randomBytes(32).toString('hex');

check('round-trip khi có key', () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
  delete require.cache[require.resolve('./encryption')];
  const { encrypt, decrypt } = require('./encryption');
  const plaintext = JSON.stringify({ token: 'super-secret-value' });
  const encrypted = encrypt(plaintext);
  assert.ok(encrypted.startsWith('enc:v1:'), 'ciphertext phải có prefix enc:v1:');
  assert.notStrictEqual(encrypted, plaintext);
  assert.strictEqual(decrypt(encrypted), plaintext);
});

check('legacy plaintext (không có prefix) đọc lại nguyên vẹn dù có key', () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
  delete require.cache[require.resolve('./encryption')];
  const { decrypt } = require('./encryption');
  const legacy = JSON.stringify({ token: 'plaintext-legacy' });
  assert.strictEqual(decrypt(legacy), legacy);
});

check('encrypt() fallback plaintext khi chưa set key', () => {
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  delete require.cache[require.resolve('./encryption')];
  const { encrypt } = require('./encryption');
  const plaintext = JSON.stringify({ token: 'no-key-yet' });
  assert.strictEqual(encrypt(plaintext), plaintext);
});

check('decrypt() throw rõ ràng nếu dữ liệu đã mã hoá nhưng thiếu key', () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
  delete require.cache[require.resolve('./encryption')];
  const { encrypt } = require('./encryption');
  const encrypted = encrypt(JSON.stringify({ token: 'x' }));

  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  delete require.cache[require.resolve('./encryption')];
  const { decrypt } = require('./encryption');
  assert.throws(() => decrypt(encrypted), /CREDENTIALS_ENCRYPTION_KEY/);
});

delete process.env.CREDENTIALS_ENCRYPTION_KEY;
delete require.cache[require.resolve('./encryption')];

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
