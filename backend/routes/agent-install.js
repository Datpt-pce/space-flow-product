const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { buildAgentSetupScript } = require('../utils/agentSetupScript');

const router = express.Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildBatScript(installUrl) {
  // cmd.exe dien giai %<digit> la tham chieu tham so dong lenh (%1-%9) trong file .bat, bat ke co
  // nam trong dau ngoac kep hay khong -> URL da encodeURIComponent() (%3A%2F%2F...) bi vo tinh cat
  // mat thanh "AFF" (vi khong co tham so nao duoc truyen khi double-click). Phai "%" -> "%%" de co
  // ky tu % literal trong batch file.
  const escaped = installUrl.replace(/%/g, '%%');
  return `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${escaped}' | iex"\r\npause\r\n`;
}

// Serves the same setup script backend/utils/agentSetupScript.js generates, keyed by the raw
// agent token itself (no session cookie involved) — this is called from the target machine via
// `irm <url> | iex` or a downloaded .bat, neither of which carries the browser's auth cookie.
// Mirrors how the WS 'register' handshake in backend/ws/agentServer.js already authenticates
// purely by token instead of session.
router.get('/:token', (req, res) => {
  const row = db.prepare('SELECT id FROM agents WHERE secret_hash = ?').get(hashToken(req.params.token));
  if (!row) return res.status(404).type('text/plain').send('Token khong hop le hoac agent da bi xoa.');

  // serverUrl is always supplied by the frontend (window.location.origin) since this repo has no
  // `trust proxy` configured — req.protocol/host would be wrong behind the Cloudflare Tunnel.
  const serverUrl = req.query.serverUrl || `${req.protocol}://${req.get('host')}`;
  const format = req.query.format === 'bat' ? 'bat' : 'ps1';

  if (format === 'bat') {
    const psUrl = `${serverUrl}${req.baseUrl}/${req.params.token}?serverUrl=${encodeURIComponent(serverUrl)}`;
    res.set('Content-Disposition', 'attachment; filename="setup-space-flow-agent.bat"');
    return res.type('text/plain').send(buildBatScript(psUrl));
  }

  if (req.query.download) res.set('Content-Disposition', 'attachment; filename="setup-space-flow-agent.ps1"');
  res.type('text/plain').send(buildAgentSetupScript(req.params.token, serverUrl));
});

module.exports = router;
