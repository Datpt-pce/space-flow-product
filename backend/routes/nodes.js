const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');

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

  // Non-admin users only see node types Admin has explicitly granted them (see
  // backend/db/index.js user_node_permissions — empty allowlist = nothing shown).
  if (req.user.role !== 'admin') {
    const allowed = new Set(
      db.prepare('SELECT node_type FROM user_node_permissions WHERE user_id = ?').all(req.user.id).map(r => r.node_type)
    );
    return res.json(manifests.filter(m => allowed.has(m.id)));
  }

  res.json(manifests);
});

module.exports = router;
