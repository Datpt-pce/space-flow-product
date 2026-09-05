// Drives the sheet engine spike (index.html) with Playwright and prints the mount/cell-edit/
// recalculation measurements it records. Run with: node src/sheet/spike/measure.mjs
// (rebuild spike.bundle.js first with: npx esbuild src/sheet/spike/spike.js --bundle
// --format=esm --outdir=src/sheet/spike --out-extension:.js=.bundle.js)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const file = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.join(__dirname, file);
      fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(content);
      });
    });
    server.listen(0, () => resolve(server));
  });
}

async function main() {
  const server = await serve();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/index.html`;

  // headless:false — same reasoning as the Graph spike (docs/decisions/0014-graph-renderer-spike.md):
  // avoids headless Chromium's software-GL fallback skewing canvas-render-dependent timing.
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (msg) => console.log(`  [page:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`));
  page.on('response', (res) => { if (!res.ok()) console.log(`  [http ${res.status()}] ${res.url()}`); });

  await page.goto(url);
  await page.waitForFunction(() => window.__spikeDone === true, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.__spikeResult || { error: window.__spikeError });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
