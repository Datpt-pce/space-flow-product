const fs = require('fs');
const path = require('path');

function checkpointPath(uploadsDir, nodeId) {
  return path.join(uploadsDir, '.checkpoints', `${nodeId}.json`);
}

function readCheckpoint(uploadsDir, nodeId) {
  const p = checkpointPath(uploadsDir, nodeId);
  if (!fs.existsSync(p)) return { completed: 0 };
  try {
    return { completed: Number(JSON.parse(fs.readFileSync(p, 'utf8')).completed) || 0 };
  } catch {
    return { completed: 0 };
  }
}

function writeCheckpoint(uploadsDir, nodeId, completed) {
  const p = checkpointPath(uploadsDir, nodeId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ completed }), 'utf8');
}

function clearCheckpoint(uploadsDir, nodeId) {
  const p = checkpointPath(uploadsDir, nodeId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { readCheckpoint, writeCheckpoint, clearCheckpoint };
