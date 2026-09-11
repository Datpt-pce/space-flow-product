// Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md §5): proves
// preflight.js's checks against the real ffmpeg/ffprobe installed on this machine — this dev
// machine already has a "full" gyan.dev build with drawtext (verified by 0016-video-render-
// spike.md), so runPreflight() should report ok:true here; the shape assertions are what a
// broken/missing install would actually see.
//
// Run with: node backend/video/preflight.test.js

const assert = require('assert');
const { runPreflight } = require('./preflight');

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
  await check('runPreflight(): ffmpeg/ffprobe/drawtext all pass on this dev machine (gyan.dev full build), errors is empty', async () => {
    const result = await runPreflight();
    assert.strictEqual(result.ok, true, `expected ok:true, errors: ${JSON.stringify(result.errors)}`);
    assert.strictEqual(result.ffmpeg.ok, true);
    assert.strictEqual(result.ffprobe.ok, true);
    assert.strictEqual(result.drawtext.ok, true);
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.ffmpeg.version.includes('ffmpeg version'));
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
