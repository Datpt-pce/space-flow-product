// 08-C C6 — proves buildCapabilitySnapshot() against the real ffmpeg/ffprobe on this dev machine
// (same machine 0016-video-render-spike.md verified: gyan.dev full build) — shape assertions are
// what a callsite (a future capability-gating UI) can actually rely on.
//
// Run with: node backend/video/capabilitySnapshot.test.js

const os = require('os');
const path = require('path');
const assert = require('assert');
const { buildCapabilitySnapshot, SNAPSHOT_TTL_MS } = require('./capabilitySnapshot');

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
  await check('buildCapabilitySnapshot(): ok:true on this dev machine, real ffmpeg/encoders/disk all pass', async () => {
    const snapshot = await buildCapabilitySnapshot(os.tmpdir());
    assert.strictEqual(snapshot.ok, true, `expected ok:true, errors: ${JSON.stringify(snapshot.errors)}`);
    assert.deepStrictEqual(snapshot.errors, []);
    assert.strictEqual(snapshot.codec.ffmpeg.ok, true);
    assert.strictEqual(snapshot.codec.drawtext.ok, true);
    assert.strictEqual(snapshot.codec.encoders.h264, true, 'expected libx264 encoder on this dev machine (gyan.dev full build)');
    assert.strictEqual(snapshot.codec.encoders.aac, true);
  });

  await check('buildCapabilitySnapshot(): OS/runtime/hardware fields are real, non-placeholder values', async () => {
    const snapshot = await buildCapabilitySnapshot(os.tmpdir());
    assert.strictEqual(snapshot.os.platform, process.platform);
    assert.strictEqual(snapshot.runtime.node, process.version);
    assert.ok(snapshot.hardware.cpuCount >= 1);
    assert.ok(snapshot.hardware.totalMemBytes > 0);
    assert.ok(snapshot.hardware.freeMemBytes > 0);
  });

  await check('buildCapabilitySnapshot(): GPU is explicitly NOT probed — reports {probed:false}, never a guessed value', async () => {
    const snapshot = await buildCapabilitySnapshot(os.tmpdir());
    assert.deepStrictEqual(snapshot.hardware.gpu, { probed: false });
  });

  await check('buildCapabilitySnapshot(): disk-space check on a real dir reports positive free/total bytes', async () => {
    const snapshot = await buildCapabilitySnapshot(os.tmpdir());
    assert.strictEqual(snapshot.filesystem.ok, true);
    assert.strictEqual(snapshot.filesystem.checkedPath, os.tmpdir());
    assert.ok(snapshot.filesystem.freeBytes > 0);
    assert.ok(snapshot.filesystem.totalBytes >= snapshot.filesystem.freeBytes);
  });

  await check('buildCapabilitySnapshot(): a nonexistent path fails ONLY the filesystem check, not the whole snapshot\'s other fields', async () => {
    const badPath = path.join(os.tmpdir(), 'sf-capability-snapshot-test-does-not-exist', 'nested');
    const snapshot = await buildCapabilitySnapshot(badPath);
    assert.strictEqual(snapshot.filesystem.ok, false);
    assert.strictEqual(snapshot.filesystem.freeBytes, null);
    assert.strictEqual(snapshot.ok, false, 'overall ok must be false when disk check fails');
    assert.ok(snapshot.errors.some((e) => e.includes(badPath)));
    // codec/hardware fields must still be populated — one failing check must not blank the rest.
    assert.strictEqual(snapshot.codec.ffmpeg.ok, true);
    assert.ok(snapshot.hardware.cpuCount >= 1);
  });

  await check('buildCapabilitySnapshot(): expiresAt is capturedAt + SNAPSHOT_TTL_MS', async () => {
    const snapshot = await buildCapabilitySnapshot(os.tmpdir());
    const delta = new Date(snapshot.expiresAt).getTime() - new Date(snapshot.capturedAt).getTime();
    assert.strictEqual(delta, SNAPSHOT_TTL_MS);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
