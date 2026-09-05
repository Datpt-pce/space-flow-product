const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'agent.json');

// Windows PowerShell 5.1's `Set-Content -Encoding utf8` (buildAgentSetupScript.js) writes a
// leading BOM, which JSON.parse() does not strip on its own — same fix as
// agent/connection.js's readAgentToken(), duplicated here since that function isn't exported.
const BOM_CHAR = String.fromCharCode(0xfeff);

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const withoutBom = raw.startsWith(BOM_CHAR) ? raw.slice(1) : raw;
    return JSON.parse(withoutBom);
  } catch {
    return {};
  }
}

function readAutoUpdateConfig() {
  const { autoUpdate } = readConfig();
  return { enabled: true, windowStart: null, windowEnd: null, ...autoUpdate };
}

function writeAutoUpdateConfig(partial) {
  const current = readConfig();
  const next = { ...current, autoUpdate: { ...readAutoUpdateConfig(), ...partial } };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next.autoUpdate;
}

module.exports = { readAutoUpdateConfig, writeAutoUpdateConfig };
