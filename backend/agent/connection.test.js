// Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5): unit test for
// streamFileBack() — the piece of backend/agent/connection.js's video-job handler that fixes the
// architecture bug backend/routes/video-assets.js's own header comment flagged ("outPath sent to
// the agent as-is was only ever meaningful in SPACE_FLOW_MODE=agent, never for a real remote
// agent"): a render's finished file gets read back and streamed to the central server in chunks.
// The REST of connection.js's video-job/cancel-job dispatch is exercised indirectly — the wire
// protocol it relies on (agentServer.js) has its own real-WebSocket test
// (backend/ws/agentServer.test.js), and the render/cancel mechanics streamFileBack feeds into
// (backend/agent/videoJobs.js) have theirs (backend/routes/video-render.test.js, including a real
// `tasklist`-verified process kill) — a full 2-process central-server+agent integration test for
// connection.js's own outbound WS client is a bigger investment than this glue code's size
// warrants on its own.
//
// Run with: node backend/agent/connection.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { streamFileBack } = require('./connection');

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.stack || err.message}`);
  }
}

async function main() {
  await check('streamFileBack: reassembling every emitted chunk reproduces the exact original file bytes', async () => {
    const tmpPath = path.join(os.tmpdir(), `sf-connection-test-${Date.now()}.bin`);
    // Deliberately larger than OUTPUT_CHUNK_SIZE (256KB) so this actually exercises multiple
    // chunks, not just 1 — real render outputs are always multi-chunk in practice.
    const original = Buffer.alloc(600 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    fs.writeFileSync(tmpPath, original);

    try {
      const chunks = [];
      await streamFileBack(tmpPath, (event, data) => {
        assert.strictEqual(event, 'output-chunk');
        chunks.push(Buffer.from(data.chunkBase64, 'base64'));
      });
      assert.ok(chunks.length > 1, `expected multiple chunks for a ${original.length}-byte file, got ${chunks.length}`);
      const reassembled = Buffer.concat(chunks);
      assert.ok(reassembled.equals(original), 'reassembled bytes must exactly match the original file');
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  await check('streamFileBack: rejects clearly if the file does not exist', async () => {
    await assert.rejects(() => streamFileBack('/does/not/exist.bin', () => {}), /ENOENT/);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
