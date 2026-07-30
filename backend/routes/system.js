const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const router = express.Router();
const ROOT_DIR = path.join(__dirname, '..', '..');

const ALL_TARGETS = [
  { label: 'root', dir: ROOT_DIR },
  { label: 'frontend', dir: path.join(ROOT_DIR, 'frontend') },
  { label: 'backend', dir: path.join(ROOT_DIR, 'backend') },
];

// Container backend cua product (Dockerfile.backend) chi COPY backend/ + nodes/, khong
// co frontend/ hay package.json o root ben trong image -> tu phat hien target nao thuc
// su ton tai thay vi gia dinh ca 3 luon nam canh nhau nhu khi chay dev native.
function availableTargets() {
  return ALL_TARGETS.filter(t => fs.existsSync(path.join(t.dir, 'package.json')));
}

function runNpmUpdate(cwd, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['update'], { cwd, shell: true });
    let lineBuffer = '';

    const handle = (d) => {
      lineBuffer += d.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    };

    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);

    proc.on('close', (code) => {
      if (lineBuffer) onLine(lineBuffer.replace(/\r$/, ''));
      if (code !== 0) return reject(new Error(`npm update exited with code ${code} (${cwd})`));
      resolve();
    });

    proc.on('error', reject);
  });
}

router.get('/status', (req, res) => {
  const targets = availableTargets();
  res.json({
    available: targets.length === ALL_TARGETS.length,
    targets: targets.map(t => t.label),
  });
});

router.post('/update-deps', async (req, res) => {
  const targets = availableTargets();
  if (targets.length < ALL_TARGETS.length) {
    return res.status(400).json({ error: 'Chỉ khả dụng khi backend, frontend và root cùng nằm trên một máy (dev native), không dùng được trong container product.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  for (const target of targets) {
    send('log', { target: target.label, line: `=== npm update (${target.label}) ===` });
    try {
      await runNpmUpdate(target.dir, (line) => send('log', { target: target.label, line }));
    } catch (err) {
      send('error', { target: target.label, error: err.message });
      res.end();
      return;
    }
  }

  send('done', { success: true });
  res.end();
});

module.exports = router;
