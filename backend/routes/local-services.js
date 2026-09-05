const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const STORE_PATH = path.join(__dirname, '..', 'config', 'local-services.json');

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// Khong co secret nao o day (chi baseUrl) nen tra ve nguyen store, khac credentials.js.
router.get('/', (req, res) => {
  const store = readStore();
  res.json(Object.entries(store).map(([name, svc]) => ({ name, baseUrl: svc.baseUrl })));
});

router.post('/', (req, res) => {
  const { name, baseUrl } = req.body;
  if (!name || !baseUrl) {
    return res.status(400).json({ error: 'Thiếu name hoặc baseUrl' });
  }
  const store = readStore();
  store[name] = { baseUrl };
  writeStore(store);
  res.json({ success: true });
});

router.delete('/:name', (req, res) => {
  const store = readStore();
  delete store[req.params.name];
  writeStore(store);
  res.json({ success: true });
});

module.exports = router;
