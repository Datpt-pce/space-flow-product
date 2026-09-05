const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { spawnPython } = require('../engine/runner');
const { getCredential } = require('../utils/credentials');
const { getLinkCatalog, getOwnLinkCatalog, getPublicLinkCatalog, saveLinkCatalog, deleteLinkCatalog } = require('../utils/linkCatalog');

const router = express.Router();

const V1_DIR = path.join(__dirname, '..', '..', 'nodes', 'resize-upload');
const V2_DIR = path.join(__dirname, '..', '..', 'nodes', 'resize-upload-v2');
const TOOLS_SCRIPT = path.join(V1_DIR, 'tools.py'); // stateless Asana helper — safe to reuse as-is
const EXECUTOR_SCRIPT = path.join(V2_DIR, 'executor.py');
const LAST_SESSION_FILE = path.join(V2_DIR, 'last_session.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function runTool(action, body, res) {
  spawnPython(TOOLS_SCRIPT, { action, ...body })
    .then(result => res.json(result))
    .catch(err => res.status(400).json({ error: err.message.trim() }));
}

// ---- App/Link catalog — bảng resize_link_catalogs (KHÔNG bị relay, xem `only` ở server.js) ----
router.get('/link-catalog', (req, res) => {
  res.json({ public: getPublicLinkCatalog(), mine: getOwnLinkCatalog(req.user.id) });
});

router.post('/link-catalog', (req, res) => {
  const { scope, data } = req.body;
  if (!['public', 'private'].includes(scope)) return res.status(400).json({ error: 'scope phải là public hoặc private' });
  if (scope === 'public' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới sửa được App/Link catalog dùng chung' });
  }
  saveLinkCatalog(scope, req.user.id, data || {});
  res.json({ success: true });
});

router.delete('/link-catalog', (req, res) => {
  deleteLinkCatalog(req.user.id);
  res.json({ success: true });
});

// ---- Asana helpers — nhận credentialName thay vì pat thô (KHÔNG bị relay) ----
router.post('/asana-test', (req, res) => {
  const pat = getCredential(req.body.credentialName, req.user.id)?.data?.token || '';
  runTool('asana_test', { pat }, res);
});

router.post('/asana-tasks', (req, res) => {
  const pat = getCredential(req.body.credentialName, req.user.id)?.data?.token || '';
  runTool('asana_tasks', { pat }, res);
});

router.post('/asana-auto-gid', (req, res) => {
  const pat = getCredential(req.body.credentialName, req.user.id)?.data?.token || '';
  runTool('asana_auto_gid', { pat, task_url: req.body.task_url }, res);
});

// ---- Phiên làm việc gần nhất (khôi phục bảng khi node bị xoá rồi thêm lại) ----
router.get('/last-session', (req, res) => {
  res.json(readJson(LAST_SESSION_FILE, null));
});

router.post('/last-session', (req, res) => {
  writeJson(LAST_SESSION_FILE, req.body || {});
  res.json({ ok: true });
});

// ---- Chạy trực tiếp (Upload NMS / Resize & Upload NMS) — SSE, không qua workflow executor ----
router.post('/run', (req, res) => {
  const { config = {}, mode = 'upload_only' } = req.body;
  const asanaPat = config.__resolved_asana_pat !== undefined
    ? config.__resolved_asana_pat
    : (getCredential(config.asana_credential_name, req.user?.id)?.data?.token || '');
  const settings = { asana_pat_main: asanaPat };
  const custom_links = config.__resolved_links !== undefined
    ? config.__resolved_links
    : getLinkCatalog(req.user?.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const proc = spawn('python', [EXECUTOR_SCRIPT], { windowsHide: true });
  proc.stdin.write(JSON.stringify({ inputs: {}, config, settings, custom_links, run_mode: mode }));
  proc.stdin.end();

  let stdout = '';
  let stderr = '';
  let stderrLineBuffer = '';

  proc.stdout.on('data', d => { stdout += d; });
  proc.stderr.on('data', d => {
    stderr += d;
    stderrLineBuffer += d;
    const lines = stderrLineBuffer.split('\n');
    stderrLineBuffer = lines.pop();
    for (const line of lines) {
      const clean = line.replace(/\r$/, '');
      if (!clean) continue;
      if (clean.startsWith('PROGRESS\t')) {
        const [, percentStr, message] = clean.split('\t');
        send('progress', { percent: Number(percentStr) || 0, message: message || '' });
      } else if (clean.startsWith('ROWRESULT\t')) {
        try {
          send('rowResult', JSON.parse(clean.slice('ROWRESULT\t'.length)));
        } catch { /* ignore malformed row result line */ }
      } else {
        send('log', { message: clean, level: 'info' });
      }
    }
  });

  proc.on('close', code => {
    if (code !== 0) {
      send('error', { error: stderr.trim() || `Python exited with code ${code}` });
      return res.end();
    }
    try {
      const result = JSON.parse(stdout);
      send('nodeComplete', { outputs: result });
      send('done', { success: true });
    } catch {
      send('error', { error: `Invalid JSON from Python executor: ${stdout}` });
    }
    res.end();
  });

  proc.on('error', err => { send('error', { error: err.message }); res.end(); });
});

module.exports = router;
