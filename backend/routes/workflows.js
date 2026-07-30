const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

router.get('/', (req, res) => {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
  res.json(files.map(f => ({ id: f.replace('.json', ''), name: f.replace('.json', '') })));
});

router.get('/:id', (req, res) => {
  const file = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

router.post('/:id', (req, res) => {
  const file = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
  fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

module.exports = router;
