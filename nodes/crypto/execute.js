const crypto = require('crypto');
const { getPath, setPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

function randomString(length, type) {
  if (type === 'uuid') return crypto.randomUUID();
  const bytes = crypto.randomBytes(length);
  if (type === 'hex') return bytes.toString('hex').slice(0, length);
  if (type === 'base64') return bytes.toString('base64').slice(0, length);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i % bytes.length] % chars.length];
  return out;
}

function deriveKey(secret) {
  return crypto.scryptSync(String(secret || ''), 'space-flow-crypto-node-salt', 32, { maxmem: 128 * 1024 * 1024 });
}

function encryptAesGcm(text, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptAesGcm(payloadBase64, secret) {
  const key = deriveKey(secret);
  const buf = Buffer.from(payloadBase64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const action = config.action || 'hash';
  const type = config.type || 'sha256';
  const encoding = config.encoding || 'hex';
  const outputFieldName = config.outputFieldName || 'data';
  const secret = config.secret || '';

  const getSource = (item) => (config.field ? String(getPath(item, config.field) ?? '') : String(config.value ?? ''));

  const process = (item) => {
    const out = { ...item };
    const source = getSource(item);
    let result;

    switch (action) {
      case 'hmac':
        result = crypto.createHmac(type, secret).update(source).digest(encoding);
        break;
      case 'generate':
        result = randomString(Number(config.stringLength) || 32, config.encodingType || 'alphanumeric');
        break;
      case 'encrypt':
        result = encryptAesGcm(source, secret);
        break;
      case 'decrypt':
        result = decryptAesGcm(source, secret);
        break;
      case 'hash':
      default:
        result = crypto.createHash(type).update(source).digest(encoding);
    }

    setPath(out, outputFieldName, result);
    return out;
  };

  return { items: toItems(items.map(process)) };
};
