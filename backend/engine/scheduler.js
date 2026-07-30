const fs = require('fs');
const path = require('path');
const executor = require('./executor');

const LOG_PATH = path.join(__dirname, '..', '..', 'logs', 'scheduler.log');
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

// In-memory only — schedules are lost on server restart. Acceptable for the
// evaluation prototype (see docs/product/node-spec/DISCUSSION.md #3);
// not built for persistence across restarts.
const active = new Map(); // triggerNodeId -> { intervalHandle, workflow, intervalSeconds }

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

function tick(triggerNodeId, workflow, uploadsDir) {
  const send = (event, data) => logLine(`${triggerNodeId} ${event} ${JSON.stringify(data)}`);
  executor.run(workflow, uploadsDir, send, null).catch(err => {
    logLine(`${triggerNodeId} run failed: ${err.message}`);
  });
}

function activate(triggerNodeId, workflow, intervalSeconds, uploadsDir) {
  deactivate(triggerNodeId);
  const intervalHandle = setInterval(() => tick(triggerNodeId, workflow, uploadsDir), intervalSeconds * 1000);
  active.set(triggerNodeId, { intervalHandle, workflow, intervalSeconds });
  logLine(`${triggerNodeId} activated, every ${intervalSeconds}s`);
}

function deactivate(triggerNodeId) {
  const entry = active.get(triggerNodeId);
  if (!entry) return;
  clearInterval(entry.intervalHandle);
  active.delete(triggerNodeId);
  logLine(`${triggerNodeId} deactivated`);
}

function isActive(triggerNodeId) {
  return active.has(triggerNodeId);
}

module.exports = { activate, deactivate, isActive };
