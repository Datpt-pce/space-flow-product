const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'credentials', 'store.json');

function getCredential(name) {
  if (!name) return null;
  if (!fs.existsSync(STORE_PATH)) return null;
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  return store[name] || null;
}

// Generic auth injection, mirrors n8n's credential "authenticate" property:
// header/query/basicAuth/bearer all just mutate the outgoing request shape.
function applyAuth(credential, { headers, qs }) {
  if (!credential) return;
  switch (credential.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${credential.data.token}`;
      break;
    case 'basicAuth':
      headers['Authorization'] =
        'Basic ' + Buffer.from(`${credential.data.user}:${credential.data.pass}`).toString('base64');
      break;
    case 'header':
      headers[credential.data.name] = credential.data.value;
      break;
    case 'query':
      qs[credential.data.name] = credential.data.value;
      break;
  }
}

module.exports = { getCredential, applyAuth };
