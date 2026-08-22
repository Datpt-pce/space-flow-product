const path = require('path');
const fs = require('fs');

const NODES_DIR = path.join(__dirname, '..', '..', 'nodes');

// Shared by the executor (needs the full manifest to run a node) and the server-mode
// pre-flight check in routes/execute.js (only needs manifest.runsOn) — one read path.
function getManifest(nodeType) {
  const manifestPath = path.join(NODES_DIR, nodeType, 'node.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

module.exports = { NODES_DIR, getManifest };
