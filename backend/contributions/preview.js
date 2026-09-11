const http = require('http');
const fs = require('fs');
const path = require('path');
const { within } = require('./process');
const { requireValue } = require('./errors');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function openGateway(runtime, directory, candidate) {
  return new Promise((resolve, reject) => {
    const hostname = `preview-${runtime.id}.localhost`; let port;
    const server = http.createServer((req, res) => {
      if (req.headers.host !== `${hostname}:${port}` || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 4096) { res.writeHead(403); return res.end(); }
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
      if (req.url === '/__candidate') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ digest: candidate.digest, revision: candidate.revision, expiresAt: runtime.expiresAt })); }
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        const target = new URL(runtime.backendUrl + req.url); const headers = { ...req.headers, host: target.host };
        delete headers.origin; delete headers.referer; delete headers.forwarded; delete headers['x-forwarded-for']; delete headers['x-forwarded-host'];
        let bytes = 0;
        const proxy = http.request(target, { method: req.method, headers, timeout: 30000 }, upstream => {
          res.statusCode = upstream.statusCode;
          for (const key of ['content-type', 'content-length', 'set-cookie', 'location', 'content-disposition']) {
            if (!upstream.headers[key]) continue;
            if (key === 'location' && (!String(upstream.headers[key]).startsWith('/') || String(upstream.headers[key]).startsWith('//'))) continue;
            if (key === 'set-cookie') res.setHeader(key, upstream.headers[key].map(value => value.replace(/;\s*Domain=[^;]*/ig, '')));
            else res.setHeader(key, upstream.headers[key]);
          }
          let returned = 0; upstream.on('data', chunk => { returned += chunk.length; if (returned > 32 * 1024 * 1024) { upstream.destroy(); res.destroy(); } });
          upstream.pipe(res); upstream.on('error', () => res.destroy());
        });
        proxy.on('timeout', () => proxy.destroy()); proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Sandbox unavailable'); });
        req.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { proxy.destroy(); req.destroy(); } });
        req.pipe(proxy); return;
      }
      try {
        requireValue(['GET', 'HEAD'].includes(req.method), 'PREVIEW_METHOD', 'Method not allowed');
        const name = decodeURIComponent(new URL(req.url, `http://${hostname}`).pathname).replace(/^\/+/, '') || 'index.html';
        const root = path.join(directory, 'dist'); let target = within(root, path.join(root, name));
        if (!fs.existsSync(target) && !path.extname(name)) target = path.join(root, 'index.html');
        requireValue(fs.existsSync(target) && fs.statSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'PREVIEW_FILE', 'Not found');
        res.setHeader('Content-Type', TYPES[path.extname(target)] || 'application/octet-stream');
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(target); stream.on('error', () => res.destroy()); stream.pipe(res);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve({ server, url: `http://${hostname}:${port}/api/auth/dev-login` }); });
  });
}
module.exports = { openGateway };
