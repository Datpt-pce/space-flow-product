const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'config', 'local-services.json');

function getLocalServiceUrl(name) {
  if (!name) return null;
  if (!fs.existsSync(STORE_PATH)) return null;
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  return store[name]?.baseUrl || null;
}

module.exports = { getLocalServiceUrl };
