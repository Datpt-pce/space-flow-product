// 08-D D2 — pure unit tests for commandRetry.js. No DOM/network. Run with:
// node frontend/src/video/commandRetry.test.js

import assert from 'assert';
import { postCommandWithRetry } from './commandRetry.js';

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
  await check('postCommandWithRetry(): succeeds on the first attempt — postFn called exactly once', async () => {
    let calls = 0;
    const result = await postCommandWithRetry(async () => { calls++; return { success: true }; }, { retryDelayMs: 0 });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(result, { success: true });
  });

  await check('postCommandWithRetry(): a failure followed by success retries once and resolves', async () => {
    let calls = 0;
    const result = await postCommandWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('network drop');
      return { success: true, idempotent: true };
    }, { retryDelayMs: 0 });
    assert.strictEqual(calls, 2);
    assert.strictEqual(result.idempotent, true);
  });

  await check('postCommandWithRetry(): the SAME idempotencyKey is sent on every attempt, not regenerated', async () => {
    const seenKeys = [];
    await postCommandWithRetry(async (key) => {
      seenKeys.push(key);
      if (seenKeys.length === 1) throw new Error('network drop');
      return { success: true };
    }, { retryDelayMs: 0 });
    assert.strictEqual(seenKeys.length, 2);
    assert.strictEqual(seenKeys[0], seenKeys[1], 'retry must reuse the first attempt\'s idempotencyKey');
  });

  await check('postCommandWithRetry(): an explicit idempotencyKey is used as-is instead of generating one', async () => {
    const seenKeys = [];
    await postCommandWithRetry(async (key) => { seenKeys.push(key); return { success: true }; }, { idempotencyKey: 'fixed-key-1', retryDelayMs: 0 });
    assert.deepStrictEqual(seenKeys, ['fixed-key-1']);
  });

  await check('postCommandWithRetry(): exhausting maxAttempts rejects with the LAST error', async () => {
    let calls = 0;
    await assert.rejects(
      () => postCommandWithRetry(async () => { calls++; throw new Error(`fail-${calls}`); }, { retryDelayMs: 0, maxAttempts: 2 }),
      /fail-2/
    );
    assert.strictEqual(calls, 2, 'must not exceed maxAttempts');
  });

  await check('postCommandWithRetry(): maxAttempts:1 never retries', async () => {
    let calls = 0;
    await assert.rejects(
      () => postCommandWithRetry(async () => { calls++; throw new Error('nope'); }, { retryDelayMs: 0, maxAttempts: 1 })
    );
    assert.strictEqual(calls, 1);
  });

  await check('postCommandWithRetry(): a conflict error (`.conflict = true`) fails fast — never retried even with maxAttempts:2', async () => {
    let calls = 0;
    await assert.rejects(
      () => postCommandWithRetry(async () => {
        calls++;
        const err = new Error('conflict');
        err.conflict = true;
        throw err;
      }, { retryDelayMs: 0, maxAttempts: 2 }),
      /conflict/,
    );
    assert.strictEqual(calls, 1, 'a stale base revision will conflict again identically — retrying wastes the attempt');
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
