const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const NODES_DIR = path.join(__dirname, '..', '..', 'nodes');

router.get('/', (req, res) => {
  const manifests = [];
  if (!fs.existsSync(NODES_DIR)) return res.json([]);

  for (const name of fs.readdirSync(NODES_DIR)) {
    const manifestPath = path.join(NODES_DIR, name, 'node.json');
    if (fs.existsSync(manifestPath)) {
      try {
        manifests.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      } catch (e) {
        console.error(`Failed to parse ${manifestPath}:`, e.message);
      }
    }
  }

  res.json(manifests);
});

module.exports = router;
