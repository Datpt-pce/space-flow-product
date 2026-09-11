// Test for Custom Node Platform Phase 4's real context-rpc.js
// (specs/space-flow-master-plan/01-custom-node-platform.md) — the enforcement this Phase adds on
// top of the Platform Core Phase 0.2 skeleton (every method used to throw "not implemented").
// fetchImpl is injected in the http() tests specifically to avoid a real network dependency —
// end-to-end network behavior (DNS validation, redirect re-validation) is already covered by
// security-corpus/ssrf-guard-real.test.js; this file only needs to prove the domain-allowlist
// gate around that.
//
// Run with: node backend/sandbox/context-rpc.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createContextRpc, isWithin } = require('./context-rpc');

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

function noopSend() {}

async function main() {
  await check('isWithin: rejects a sibling directory with a matching-prefix name (not a real subdirectory)', () => {
    assert.strictEqual(isWithin('/approved', '/approved-foo'), false);
  });
  await check('isWithin: accepts the directory itself and real subdirectories', () => {
    assert.strictEqual(isWithin('/approved', '/approved'), true);
    assert.strictEqual(isWithin('/approved', '/approved/sub/dir'), true);
  });
  await check('isWithin: rejects a path that escapes via ..', () => {
    assert.strictEqual(isWithin('/approved/sub', '/approved/other'), false);
  });

  await check('scratchDir(): returns the provisioned directory', () => {
    const ctx = createContextRpc({ capabilityGrants: {}, send: noopSend, scratchDir: '/tmp/example' });
    assert.strictEqual(ctx.scratchDir(), '/tmp/example');
  });
  await check('scratchDir(): throws when none was provisioned', () => {
    const ctx = createContextRpc({ capabilityGrants: {}, send: noopSend });
    assert.throws(() => ctx.scratchDir(), /no scratch directory/);
  });

  // ---- http(): capability + domain allowlist gating (fetchImpl injected, no real network) ----
  await check('http(): rejects when no network capability is granted at all', async () => {
    const ctx = createContextRpc({ capabilityGrants: {}, send: noopSend, fetchImpl: async () => { throw new Error('fetchImpl should never be called'); } });
    await assert.rejects(() => ctx.http('https://api.example.com/x'), /no network capability granted/);
  });
  await check('http(): rejects a domain not in capabilities.network', async () => {
    const ctx = createContextRpc({
      capabilityGrants: { network: ['api.allowed.com'] },
      send: noopSend,
      fetchImpl: async () => { throw new Error('fetchImpl should never be called'); },
    });
    await assert.rejects(() => ctx.http('https://api.notallowed.com/x'), /not in this node's allowlisted/);
  });
  await check('http(): allowlisted domain reaches fetchImpl with the requested method/headers', async () => {
    let called = null;
    const ctx = createContextRpc({
      capabilityGrants: { network: ['api.allowed.com'] },
      send: noopSend,
      fetchImpl: async (url, options) => { called = { url, options }; return { statusCode: 200, headers: {}, body: Buffer.from('ok') }; },
    });
    const result = await ctx.http('https://api.allowed.com/x', { method: 'POST', headers: { 'X-Test': '1' } });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(called.url, 'https://api.allowed.com/x');
    assert.strictEqual(called.options.method, 'POST');
    assert.strictEqual(called.options.headers['X-Test'], '1');
  });

  // ---- secret(): opaque token, never the real value ----
  await check('secret(): rejects a name not in capabilities.secrets', () => {
    const ctx = createContextRpc({ capabilityGrants: { secrets: ['allowed_cred'] }, send: noopSend });
    assert.throws(() => ctx.secret('not_allowed_cred'), /not in this node's allowlisted/);
  });
  await check('secret(): returns an opaque token, not a credential-shaped value', () => {
    const ctx = createContextRpc({ capabilityGrants: { secrets: ['allowed_cred'] }, send: noopSend });
    const token = ctx.secret('allowed_cred');
    assert.strictEqual(typeof token, 'string');
    assert.ok(token.startsWith('sfsecret_'), `expected an opaque sfsecret_ token, got: ${token}`);
  });

  // ---- fs: scoped to scratch or user-approved paths only ----
  await check('fs: throws when filesystem capability is "none"', async () => {
    const ctx = createContextRpc({ capabilityGrants: { filesystem: 'none' }, send: noopSend });
    await assert.rejects(() => ctx.fs.readFile('anything.txt'), /no filesystem capability/);
  });

  await check('fs (scratch): write+read round-trip inside the scratch dir succeeds', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-context-rpc-'));
    try {
      const ctx = createContextRpc({ capabilityGrants: { filesystem: 'scratch' }, send: noopSend, scratchDir });
      await ctx.fs.writeFile('note.txt', 'hello');
      const content = await ctx.fs.readFile('note.txt');
      assert.strictEqual(content, 'hello');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await check('fs (scratch): a path that escapes the scratch dir via .. is rejected', async () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-context-rpc-'));
    try {
      const ctx = createContextRpc({ capabilityGrants: { filesystem: 'scratch' }, send: noopSend, scratchDir });
      await assert.rejects(() => ctx.fs.readFile('../../etc/passwd'), /escapes the scratch directory/);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await check('fs (user-approved-path): read succeeds inside an approved path, rejected outside it', async () => {
    const approvedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-context-rpc-approved-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-context-rpc-outside-'));
    try {
      fs.writeFileSync(path.join(approvedDir, 'inside.txt'), 'yes');
      fs.writeFileSync(path.join(outsideDir, 'outside.txt'), 'no');
      const ctx = createContextRpc({
        capabilityGrants: { filesystem: 'user-approved-path', approvedPaths: [approvedDir] },
        send: noopSend,
      });
      const content = await ctx.fs.readFile(path.join(approvedDir, 'inside.txt'));
      assert.strictEqual(content, 'yes');
      await assert.rejects(() => ctx.fs.readFile(path.join(outsideDir, 'outside.txt')), /outside every user-approved path/);
    } finally {
      fs.rmSync(approvedDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
