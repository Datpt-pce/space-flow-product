// Real SSRF guard test corpus — Custom Node Platform Phase 4
// (specs/space-flow-master-plan/01-custom-node-platform.md). Distinct from
// security-corpus/ssrf-guard.test.js (Phase 0.3, pure IP-classification unit tests for
// ssrf-guard-prototype.js — unchanged, still passing) — this exercises the NEW
// backend/sandbox/ssrf-guard.js: DNS-resolution-time validation and per-redirect-hop
// re-validation, against real local HTTP servers (loopback only, no external network
// dependency, so this runs anywhere including CI).
//
// Run with: node backend/sandbox/security-corpus/ssrf-guard-real.test.js

const http = require('http');
const assert = require('assert');
const { safeFetch, createGuardedLookup, assertHostnameAllowed } = require('../ssrf-guard');

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

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  // ---- Unit: createGuardedLookup, fully offline (fake resolver, no real DNS) ----

  await check('guardedLookup: rejects a hostname resolving to a blocked address (169.254.169.254, cloud metadata)', async () => {
    const fakeLookup = (hostname, options, cb) => cb(null, '169.254.169.254', 4);
    const lookup = createGuardedLookup(fakeLookup);
    await new Promise((resolve, reject) => {
      lookup('metadata.internal.test', {}, (err) => {
        if (!err) return reject(new Error('expected the guard to reject'));
        assert.ok(/blocked address range/.test(err.message), `unexpected message: ${err.message}`);
        resolve();
      });
    });
  });

  await check('guardedLookup: allows a hostname resolving to a public address', async () => {
    const fakeLookup = (hostname, options, cb) => cb(null, '203.0.113.50', 4); // TEST-NET-3, not in the blocklist
    const lookup = createGuardedLookup(fakeLookup);
    await new Promise((resolve, reject) => {
      lookup('public.internal.test', {}, (err, address) => {
        if (err) return reject(err);
        assert.strictEqual(address, '203.0.113.50');
        resolve();
      });
    });
  });

  await check('assertHostnameAllowed: rejects a literal blocked IP directly in the URL', () => {
    assert.throws(() => assertHostnameAllowed('127.0.0.1', () => true), /blocked/);
  });

  await check('assertHostnameAllowed: does not reject a literal public IP', () => {
    assert.doesNotThrow(() => assertHostnameAllowed('203.0.113.50', () => false));
  });

  // ---- Regression: the literal-IP bypass this guard exists to close ----

  await check('safeFetch: a literal blocked IP in the URL (no hostname, so no DNS lookup happens at all) is still rejected', async () => {
    await assert.rejects(
      () => safeFetch('http://169.254.169.254/latest/meta-data/', { timeoutMs: 2000 }),
      /blocked/,
    );
  });

  // ---- Integration: real loopback HTTP servers, real safeFetch(), custom test blocklist ----
  //
  // The real production blocklist (ssrf-guard-prototype.js) correctly treats ALL of 127.0.0.0/8
  // as blocked — which means it can't be exercised against a real local test server as the
  // "safe" leg of a redirect chain. isBlockedIpFn here is a TEST-ONLY stand-in (blocks a single
  // marker TEST-NET-3 address representing "the internal target") so these tests can prove the
  // actual mechanism — DNS-driven per-hop re-validation — against real sockets, not just
  // string-level IP classification (already covered by the unit tests above and by
  // ssrf-guard.test.js).
  const isBlockedIpFn = (ip) => ip === '203.0.113.7';

  await check('safeFetch: a direct (non-redirected) request through the guard succeeds normally', async () => {
    const server = await listen((req, res) => { res.writeHead(200); res.end('ok'); });
    try {
      const port = server.address().port;
      const rawLookup = (hostname, options, cb) => cb(null, '127.0.0.1', 4);
      const result = await safeFetch(`http://safe-hop.test:${port}/`, { rawLookup, isBlockedIpFn });
      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(result.body.toString(), 'ok');
    } finally {
      server.close();
    }
  });

  await check('safeFetch: a redirect to a blocked hostname is refused BEFORE connecting, not followed', async () => {
    const server = await listen((req, res) => {
      res.writeHead(302, { Location: 'http://blocked-hop.test:9/secret' }); // port 9 (discard) — must never actually be dialed
      res.end();
    });
    try {
      const port = server.address().port;
      const rawLookup = (hostname, options, cb) => {
        if (hostname === 'safe-hop.test') return cb(null, '127.0.0.1', 4);
        if (hostname === 'blocked-hop.test') return cb(null, '203.0.113.7', 4);
        cb(new Error(`unexpected hostname in test: ${hostname}`));
      };
      const start = Date.now();
      await assert.rejects(
        () => safeFetch(`http://safe-hop.test:${port}/redirect-to-blocked`, { rawLookup, isBlockedIpFn, timeoutMs: 5000 }),
        /blocked address range/,
      );
      // If this were dialing the (unreachable) blocked target instead of refusing pre-connect,
      // it would hang until the socket timeout — asserting well under that proves refusal
      // happened at the lookup/validation step, not via a slow connection failure.
      assert.ok(Date.now() - start < 2000, 'expected the guard to refuse before attempting any connection');
    } finally {
      server.close();
    }
  });

  await check('safeFetch: redirect chain exceeding maxRedirects is refused, not followed forever', async () => {
    const server = await listen((req, res) => {
      res.writeHead(302, { Location: req.url }); // redirects to itself — an infinite loop if unguarded
      res.end();
    });
    try {
      const port = server.address().port;
      const rawLookup = (hostname, options, cb) => cb(null, '127.0.0.1', 4);
      await assert.rejects(
        () => safeFetch(`http://safe-hop.test:${port}/loop`, { rawLookup, isBlockedIpFn, maxRedirects: 3, timeoutMs: 5000 }),
        /exceeded 3 redirect hops/,
      );
    } finally {
      server.close();
    }
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
