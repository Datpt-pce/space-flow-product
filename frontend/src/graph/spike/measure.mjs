// Drives the graph renderer spike (index.html) headlessly with Playwright and prints the
// frame-time measurements it records. Run with: node src/graph/spike/measure.mjs
// (rebuild spike.bundle.js first with: npx esbuild src/graph/spike/spike.js --bundle
// --format=esm --outfile=src/graph/spike/spike.bundle.js — not run automatically here to
// keep this script dependency-free of a build step when re-running after a data-only change.)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

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

async function measure(url, lod) {
  // headless:false is required for a meaningful FPS number — headless Chromium falls back
  // to software GL (SwiftShader) which produces frame times unrelated to real GPU
  // performance on the target machine (see docs/decisions/0014-graph-renderer-spike.md).
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (msg) => {
    console.log(`  [page:${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => { console.log(`  [pageerror] ${err.message}`); errors.push(err.message); });
  page.on('response', (res) => { if (!res.ok()) console.log(`  [http ${res.status()}] ${res.url()}`); });
  await page.goto(`${url}?lod=${lod ? 1 : 0}`);
  await page.waitForFunction(() => window.__spikeDone === true, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.__spikeResult || { error: window.__spikeError });
  await browser.close();
  if (errors.length) result.consoleErrors = errors;
  return result;
}

async function main() {
  const server = await serve();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/index.html`;

  console.log('=== LOD ON ===');
  console.log(JSON.stringify(await measure(url, true), null, 2));

  console.log('\n=== LOD OFF ===');
  console.log(JSON.stringify(await measure(url, false), null, 2));

  server.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
