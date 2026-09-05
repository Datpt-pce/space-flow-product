// 08-C C6 — proves the 'capability-snapshot' job KIND is wired correctly through runVideoJob()
// (not just buildCapabilitySnapshot() in isolation, already covered by
// backend/video/capabilitySnapshot.test.js). 'preflight' and 'delete-cache' dispatch are already
// covered indirectly via backend/routes/video-assets.test.js (importAsset()/deleteAsset()).
//
// Run with: node backend/agent/videoJobs.test.js

const assert = require('assert');
const { runVideoJob } = require('./videoJobs');

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
  await check('runVideoJob(\'capability-snapshot\'): returns a real AgentCapabilitySnapshot, no payload needed', async () => {
    const snapshot = await runVideoJob('capability-snapshot', {}, () => {});
    assert.strictEqual(snapshot.ok, true, `expected ok:true, errors: ${JSON.stringify(snapshot.errors)}`);
    assert.strictEqual(snapshot.os.platform, process.platform);
    assert.strictEqual(snapshot.codec.encoders.h264, true);
    // The whole point of computing uploadsDir relative to THIS module's own __dirname (not a
    // caller-supplied path) — must resolve to backend/uploads, not os.tmpdir() or anything else.
    assert.ok(snapshot.filesystem.checkedPath.replace(/\\/g, '/').endsWith('backend/uploads'));
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
