// Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md): proves
// assetService.js's 4 functions against real ffmpeg/ffprobe and real fixture video files
// (ref-item/1.mp4, ref-item/2.mp4) — not mocked, matching this repo's existing convention of
// exercising real binaries in *.test.js (see nodes/video-assembly and backend/video/spike/
// render-spike.js).
//
// Run with: node backend/video/assetService.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { hashFile, probeMetadata, generateThumbnail, generateProxy, computeProgressPercent } = require('./assetService');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIP_1 = path.join(REPO_ROOT, 'ref-item', '1.mp4');
const CLIP_2 = path.join(REPO_ROOT, 'ref-item', '2.mp4');

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

async function main() {
  // Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5): a bad value here
  // previously reached a SQLite `NOT NULL` column and crashed the ENTIRE backend process (see
  // docs/issues/2026-08-28-render-progress-nan-crashes-server.md) — ffmpeg's `-progress pipe:1`
  // reports `out_time_ms=N/A` for the first instant or two before real numbers appear.
  check('computeProgressPercent: "N/A" (ffmpeg\'s own transient value before real progress) -> null, never NaN', () => {
    assert.strictEqual(computeProgressPercent('N/A', 5000), null);
  });
  check('computeProgressPercent: missing out_time_ms -> null', () => {
    assert.strictEqual(computeProgressPercent(undefined, 5000), null);
    assert.strictEqual(computeProgressPercent(null, 5000), null);
  });
  check('computeProgressPercent: no known total duration -> null (can\'t compute a percentage at all)', () => {
    assert.strictEqual(computeProgressPercent('2500000', 0), null);
    assert.strictEqual(computeProgressPercent('2500000', null), null);
  });
  check('computeProgressPercent: a real value computes the expected percentage, clamped to 100', () => {
    assert.strictEqual(computeProgressPercent('2500000', 5000), 50); // 2.5s of a 5s total = 50%
    assert.strictEqual(computeProgressPercent('9999000', 5000), 100); // overshoot (ffmpeg's last tick can exceed the estimate) clamps, doesn't go over
  });

  await check('hashFile: returns a stable 64-char hex sha256, same for the same file, different for a different file', async () => {
    const h1a = await hashFile(CLIP_1);
    const h1b = await hashFile(CLIP_1);
    const h2 = await hashFile(CLIP_2);
    assert.match(h1a, /^[0-9a-f]{64}$/);
    assert.strictEqual(h1a, h1b);
    assert.notStrictEqual(h1a, h2);
  });

  let clip1Meta;
  await check('probeMetadata: extracts real duration/width/height/fps/codec from an actual mp4', async () => {
    clip1Meta = await probeMetadata(CLIP_1);
    assert.ok(clip1Meta.durationMs > 0, `expected durationMs > 0, got ${clip1Meta.durationMs}`);
    assert.ok(clip1Meta.width > 0 && clip1Meta.height > 0, `expected real dimensions, got ${clip1Meta.width}x${clip1Meta.height}`);
    assert.ok(clip1Meta.fps > 0, `expected fps > 0, got ${clip1Meta.fps}`);
    assert.ok(typeof clip1Meta.codecVideo === 'string' && clip1Meta.codecVideo.length > 0);
    assert.ok(clip1Meta.sizeBytes > 0);
  });

  await check('generateThumbnail: produces a real, non-empty JPEG file at the requested timestamp', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-video-thumb-'));
    try {
      const outPath = path.join(scratchDir, 'thumb.jpg');
      await generateThumbnail(CLIP_1, outPath, 0.5);
      assert.ok(fs.existsSync(outPath), 'expected thumbnail file to exist');
      assert.ok(fs.statSync(outPath).size > 0, 'expected non-empty thumbnail file');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await check('generateProxy: produces a valid H.264/AAC mp4, duration matches source within 1s, reports progress up to 100', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-video-proxy-'));
    try {
      const outPath = path.join(scratchDir, 'proxy.mp4');
      const progressValues = [];
      await generateProxy(CLIP_1, outPath, { gopSeconds: 0.5, fps: clip1Meta.fps, durationMs: clip1Meta.durationMs }, (pct) => progressValues.push(pct));

      assert.ok(fs.existsSync(outPath), 'expected proxy file to exist');
      const proxyMeta = await probeMetadata(outPath);
      assert.strictEqual(proxyMeta.codecVideo, 'h264');
      assert.strictEqual(proxyMeta.codecAudio, 'aac');
      assert.ok(
        Math.abs(proxyMeta.durationMs - clip1Meta.durationMs) < 1000,
        `expected proxy duration close to source (${clip1Meta.durationMs}ms), got ${proxyMeta.durationMs}ms`
      );
      assert.ok(progressValues.length > 0, 'expected at least 1 progress callback');
      assert.strictEqual(progressValues[progressValues.length - 1], 100, 'expected final progress callback to be 100');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
