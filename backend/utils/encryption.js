// Secret-at-rest for the `credentials` table's `data` column — added for Sheet Phase 4
// (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #7: Google OAuth refresh tokens
// land in this same table via backend/routes/credentials.js, and that phản biện explicitly says
// not to invent a Sheet-only encryption scheme). Applied to every credential, not just Google's,
// per the decision made when this was scoped — 1 mechanism for the whole table, not 2.
//
// Backward compatible by construction: encrypt() only activates once CREDENTIALS_ENCRYPTION_KEY
// is set (falls back to plaintext otherwise, exactly like today), and decrypt() recognizes
// legacy plaintext rows (no "enc:v1:" prefix) and returns them unchanged. So existing
// installations keep working the moment this ships; encryption only takes effect for
// credentials written/updated AFTER the key is set. Rows written while encrypted stay
// unreadable if the key is later removed — same one-directional risk as
// SIGNING_KEY_PASSPHRASE (backend/registry/signing.js), deliberately not softened.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let warnedMissingKey = false;

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY phải là chuỗi hex 64 ký tự (32 byte) — xem .env.example');
  }
  return key;
}

// encrypt(plaintext) -> string. No-op (returns plaintext unchanged) when the key isn't set,
// so a fresh clone with no .env entry behaves exactly like before this change.
function encrypt(plaintext) {
  const key = getKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[encryption] CREDENTIALS_ENCRYPTION_KEY chưa được set — credential mới lưu ở dạng plaintext (xem .env.example).');
    }
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// decrypt(stored) -> string. Passes legacy plaintext rows (no "enc:v1:" prefix) through
// unchanged; only throws if a row WAS encrypted but the key to read it back is missing/wrong.
function decrypt(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) {
    throw new Error('Credential này đã được mã hoá nhưng CREDENTIALS_ENCRYPTION_KEY hiện không được set — không thể đọc lại.');
  }
  const [ivB64, authTagB64, ciphertextB64] = stored.slice(PREFIX.length).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
