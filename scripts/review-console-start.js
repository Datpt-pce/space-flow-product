#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ReviewConfig } = require('../backend/contributions/config');
const { within } = require('../backend/contributions/process');
const root = path.resolve(__dirname, '..');
require('../backend/node_modules/dotenv').config({ path: path.join(root, '.env') });

function localRequest(port, hostname, route, { method = 'GET', secret, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: route, method, timeout: 3000,
      headers: { Host: `${hostname}:${port}`, 'Content-Type': 'application/json', ...(secret ? { 'X-Launcher-Key': secret } : {}) } }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('error', reject);
      response.on('end', () => { try { resolve({ ok: response.statusCode === 200, data: text ? JSON.parse(text) : null }); } catch (error) { reject(error); } });
    });
    request.on('timeout', () => request.destroy(new Error('Console timeout'))); request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

function openBrowser(url) {
  if (process.env.SF_REVIEW_NO_BROWSER === '1') return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref();
}
async function main() {
  const reviewConfig = new ReviewConfig(); const config = reviewConfig.initialize();
  if (!config.ownerEmail) throw new Error('Cần cấu hình SF_REVIEW_OWNER_EMAIL trước khi mở console.');
  const state = within(config.workspaceRoot, path.join(config.workspaceRoot, 'controller-state'));
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const file = path.join(state, 'launcher.json'); const hostname = 'console.space-flow.localhost';
  const frontendPort = Number(process.env.SF_REVIEW_PORT || 4180); const backendPort = Number(process.env.SF_REVIEW_BACKEND_PORT || 4181);
  if (![frontendPort, backendPort].every(port => Number.isSafeInteger(port) && port >= 1024 && port <= 65535) || frontendPort === backendPort) throw new Error('Cổng console không hợp lệ.');
  const origin = `http://${hostname}:${frontendPort}`;
  const marker = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  process.env.SF_DATA_DIR = state; process.env.SF_IMPORT_LEGACY = '0'; process.env.SF_REVIEW_CONFIG = reviewConfig.file;
  for (const name of ['SF_DB_PATH', 'SF_UPLOADS_DIR', 'SF_WORKFLOWS_DIR', 'SF_INSTALLS_DIR', 'SF_SUBMISSIONS_DIR', 'SF_DRAFTS_DIR', 'SF_SIGNING_KEY_PATH', 'SF_CONFIG_DIR', 'AGENT_TOKEN']) delete process.env[name];
  // Config lookup resolved the owner's config directory before selecting this
  // controller's separate state. Re-resolve paths before loading DB/session code.
  delete require.cache[require.resolve('../backend/utils/dataPaths')];
  process.env.SPACE_FLOW_MODE = 'agent'; process.env.CENTRAL_SERVER_URL = ''; process.env.NODE_ENV = 'development';
  process.env.SF_REVIEW_WORKER_AUTOSTART = '0';
  // Starting this local, loopback-only controller is an owner OS-account action.
  // Mint a session in its separate DB and pass it through a one-use browser handoff.
  const db = require('../backend/db'); const { createSession } = require('../backend/services/sessions');
  let owner = db.prepare('SELECT * FROM users WHERE email=?').get(config.ownerEmail);
  if (!owner) { const id = crypto.randomUUID(); db.prepare('INSERT INTO users(id,google_sub,email,name,role,status) VALUES(?,?,?,?,?,?)')
    .run(id, `review-owner-${id}`, config.ownerEmail, 'Space Flow Owner', 'admin', 'active'); owner = db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  if (owner.role !== 'admin' || owner.status !== 'active') throw new Error('Owner local chưa được cấp quyền quản trị.');
  const session = createSession(owner.id); const csrf = crypto.randomBytes(32).toString('hex');
  const handoff = async secret => {
    const response = await localRequest(frontendPort, hostname, '/__session', { method: 'POST', secret, body: { session: session.token, csrf } });
    if (!response.ok) throw new Error('Không nối được phiên console hiện có.');
    const result = response.data; openBrowser(origin + result.path); return result;
  };
  if (prior?.marker === marker) {
    try {
      const existing = await localRequest(frontendPort, hostname, '/__console');
      if (existing.ok && existing.data.marker === marker) { await handoff(prior.secret); db.close(); console.log(origin + '/#review'); return; }
    } catch { /* start a new process if the old controller is gone */ }
  }
  if (!fs.existsSync(path.join(root, 'frontend/dist/index.html'))) throw new Error('Cần npm run build --prefix frontend trước khi mở console.');
  const log = fs.openSync(path.join(state, 'backend.log'), 'a');
  const instance = crypto.randomUUID();
  const env = { ...process.env, SF_REVIEW_INSTANCE: instance, SF_BIND_HOST: '127.0.0.1', PORT: String(backendPort), CORS_ORIGINS: origin,
    DEV_LOGIN_ENABLED: 'false', SF_REVIEW_WORKER_AUTOSTART: config.workerEnabled ? '1' : '0', SF_MIN_FREE_BYTES: '0' };
  const backend = spawn(process.execPath, [path.join(root, 'backend/server.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); backend.on('error', error => { throw error; });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (backend.exitCode !== null) throw new Error('Backend console đã dừng. Xem backend.log trong controller-state.');
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && response.headers.get('x-sf-review-instance') === instance) { ready = true; break; }
    } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) { backend.kill(); throw new Error('Backend console chưa sẵn sàng.'); }
  const secret = crypto.randomBytes(32).toString('hex'); const nonces = new Map();
  const frontend = http.createServer((req, res) => {
    if (req.headers.host !== `${hostname}:${frontendPort}`) { res.writeHead(403); return res.end(); }
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.url === '/__console') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ marker, version: 1 })); }
    if (req.url === '/__session') {
      if (req.method !== 'POST' || req.headers['x-launcher-key'] !== secret) { res.writeHead(403); return res.end(); }
      let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body); if (!/^[a-f0-9]{64}$/.test(data.csrf) || typeof data.session !== 'string' || data.session.length > 256) throw new Error('Invalid session');
          for (const [key, value] of nonces) if (value.expires < Date.now()) nonces.delete(key);
          const nonce = crypto.randomBytes(32).toString('hex'); nonces.set(nonce, { ...data, expires: Date.now() + 60000 });
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: `/__launch?nonce=${nonce}` }));
        } catch { res.writeHead(400); res.end(); }
      }); return;
    }
    if (req.url.startsWith('/__launch?')) {
      const nonce = new URL(req.url, origin).searchParams.get('nonce'); const value = nonces.get(nonce); nonces.delete(nonce);
      if (!value || value.expires < Date.now()) { res.writeHead(403); return res.end('Mở lại shortcut để tạo phiên mới.'); }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Set-Cookie', [`sf_session=${value.session}; Path=/; HttpOnly; SameSite=Lax`, `sf_csrf=${value.csrf}; Path=/; SameSite=Lax`]);
      res.writeHead(302, { Location: '/#review' }); return res.end();
    }
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
      const proxy = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${backendPort}` }, timeout: 60000 }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res); response.on('error', () => res.destroy());
      });
      proxy.on('timeout', () => proxy.destroy()); proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(proxy); return;
    }
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw new Error('Method');
      const name = decodeURIComponent(new URL(req.url, origin).pathname).replace(/^\/+/, '') || 'index.html'; const dist = path.join(root, 'frontend/dist');
      let target = within(dist, path.join(dist, name)); if (!fs.existsSync(target) && !path.extname(name)) target = path.join(dist, 'index.html');
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Missing');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
      if (req.method === 'HEAD') return res.end(); fs.createReadStream(target).pipe(res);
    } catch { res.writeHead(404); res.end(); }
  });
  frontend.on('error', error => { backend.kill(); console.error(error.message); process.exitCode = 1; });
  await new Promise((resolve, reject) => { frontend.once('error', reject); frontend.listen(frontendPort, '127.0.0.1', resolve); });
  fs.writeFileSync(file, JSON.stringify({ marker, secret, pid: process.pid, backendPid: backend.pid, frontendPort, backendPort }), { mode: 0o600 });
  await handoff(secret); console.log(origin + '/#review');
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; frontend.closeAllConnections(); frontend.close(); backend.kill(); db.close(); };
  backend.on('close', stop); process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
