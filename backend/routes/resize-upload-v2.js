const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const router = express.Router();

// Ver2 dùng chung credential/catalog App với node V1 (resize-upload).
const V1_DIR = path.join(__dirname, '..', '..', 'nodes', 'resize-upload');
const V2_DIR = path.join(__dirname, '..', '..', 'nodes', 'resize-upload-v2');
const SETTINGS_FILE = path.join(V1_DIR, 'settings.json');
const CUSTOM_LINKS_FILE = path.join(V1_DIR, 'custom_links.json');
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
