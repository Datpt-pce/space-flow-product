const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { spawnPython } = require('../engine/runner');

const router = express.Router();

const DIR = path.join(__dirname, '..', '..', 'nodes', 'resize-upload');
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const CUSTOM_LINKS_FILE = path.join(DIR, 'custom_links.json');
const TOOLS_SCRIPT = path.join(DIR, 'tools.py');
const EXECUTOR_SCRIPT = path.join(DIR, 'executor.py');
const LAST_SESSION_FILE = path.join(DIR, 'last_session.json');

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

// ---- Settings (global secrets/config, shared across all node instances) ----
router.get('/settings', (req, res) => {
  res.json(readJson(SETTINGS_FILE, {
    asana_pat_main: '', gcs_credentials_global: '',
    gcs_streams: { Meta: '', Google: '' }, gcs_google_channels_list: [],
  }));
});

router.post('/settings', (req, res) => {
  const current = readJson(SETTINGS_FILE, {});
  const next = { ...current, ...req.body };
  writeJson(SETTINGS_FILE, next);
  res.json(next);
});

// ---- App catalog (custom_links.json) ----
router.get('/apps', (req, res) => {
  res.json(readJson(CUSTOM_LINKS_FILE, {}));
});

router.post('/apps', (req, res) => {
  const { tag, original_tag, folder = '', thumbnail_folder = '', pinned = false } = req.body;
  if (!tag) return res.status(400).json({ error: 'tag required' });

  const links = readJson(CUSTOM_LINKS_FILE, {});
  if (original_tag && original_tag !== tag) delete links[original_tag];
  links[tag] = { folder, thumbnail_folder, pinned };
  writeJson(CUSTOM_LINKS_FILE, links);
  res.json(links);
});

router.delete('/apps/:tag', (req, res) => {
  const links = readJson(CUSTOM_LINKS_FILE, {});
  delete links[req.params.tag];
  writeJson(CUSTOM_LINKS_FILE, links);
  res.json(links);
});

// ---- Live action proxies (spawn tools.py) ----
router.post('/asana/test', (req, res) => runTool('asana_test', req.body, res));
router.post('/asana/tasks', (req, res) => runTool('asana_tasks', req.body, res));
router.post('/asana/inspect', (req, res) => runTool('asana_inspect', req.body, res));
router.post('/asana/auto-gid', (req, res) => runTool('asana_auto_gid', req.body, res));
router.post('/gcs/test', (req, res) => runTool('gcs_test', req.body, res));
router.post('/unc/test', (req, res) => runTool('unc_test', req.body, res));

// ---- Load credentials từ file config222.json + custom_links.json bên ngoài ----
router.post('/load-credentials', (req, res) => {
  const { config_path, links_path } = req.body;

  const settings = readJson(SETTINGS_FILE, {
    asana_pat_main: '', gcs_credentials_global: '',
    gcs_streams: { Meta: '', Google: '' }, gcs_google_channels_list: [],
  });
  if (config_path) settings.gcs_credentials_global = config_path;

  const links = readJson(CUSTOM_LINKS_FILE, {});
  if (links_path) {
    const external = readJson(links_path, null);
    if (external) {
      for (const [tag, entry] of Object.entries(external)) {
        links[tag] = {
          folder: entry.folder || '',
          thumbnail_folder: entry.thumbnail_folder || '',
          pinned: !!entry.pinned,
        };
        if (entry.asana_pat) settings.asana_pat_main = entry.asana_pat;
        if (entry.gcs_bucket) settings.gcs_streams.Meta = entry.gcs_bucket;
        if (entry.gcs_credentials) settings.gcs_credentials_global = entry.gcs_credentials;
      }
    }
  }

  writeJson(SETTINGS_FILE, settings);
  writeJson(CUSTOM_LINKS_FILE, links);
  res.json({ settings, apps: links });
});

// ---- Phiên làm việc gần nhất (khôi phục config khi node bị xoá rồi thêm lại) ----
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
  const settings = readJson(SETTINGS_FILE, {});
  const custom_links = readJson(CUSTOM_LINKS_FILE, {});

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const proc = spawn('python', [EXECUTOR_SCRIPT]);
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
