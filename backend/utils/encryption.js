// AES-256-GCM secret storage. Shared/production writes require a key; local plaintext
// requires explicit SF_ALLOW_PLAINTEXT_CREDENTIALS=1. Legacy plaintext reads remain
// compatible until an operator runs the backed-up re-encryption command.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let warnedMissingKey = false;

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    if (require('./runtimeConfig').sharedMode() || process.env.SF_ALLOW_PLAINTEXT_CREDENTIALS !== '1') {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is required; local development plaintext requires SF_ALLOW_PLAINTEXT_CREDENTIALS=1');
    }
    return null;
  }
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error('CREDENTIALS_ENCRYPTION_KEY must contain exactly 64 hex characters');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY phải là chuỗi hex 64 ký tự (32 byte) — xem .env.example');
  }
  return key;
}

// encrypt(plaintext) -> string. Plaintext is permitted only by explicit local-development opt-in.
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
