// Real SSRF guard for context.http() — Custom Node Platform Phase 4
// (specs/space-flow-master-plan/01-custom-node-platform.md). Extends
// ssrf-guard-prototype.js's IP-classification-only piece (kept as-is, still what decides
// "is this address blocked") with the two things the plan calls out as still missing there:
// DNS resolution BEFORE connecting (not connect-then-check, which is too late) and
// re-validation on every redirect hop (not follow-then-check, which defeats the point of
// checking at all).
//
// THE LITERAL-IP BYPASS THIS GUARDS AGAINST: Node's http/https `lookup` option is only invoked
// when the target hostname actually needs DNS resolution — a request to a bare IP literal
// (`http://127.0.0.1/...`) never calls `lookup` at all, so a guard that ONLY hooks `lookup`
// would let straight-IP SSRF attempts sail right through. assertHostnameAllowed() below is
// called unconditionally before every connection attempt (hostname OR literal IP), and
// createGuardedLookup() additionally covers the DNS-resolution path (including DNS rebinding —
// the resolved address is validated in the same callback that hands it to the socket, not in a
// separate earlier step an attacker's DNS server could answer differently for).
//
// DEPENDENCY INJECTION: createGuardedLookup(rawLookup, isBlockedIpFn) takes the underlying
// resolver and blocklist predicate as parameters (defaulting to the real dns.lookup and
// ssrf-guard-prototype's isBlockedIp) specifically so ssrf-guard.test.js can exercise the
// redirect re-validation logic against real local HTTP servers with a fake resolver, instead of
// depending on real DNS/external network access in a test (flaky, slow, and would make the test
// suite depend on the internet being reachable at all).

const http = require('http');
const https = require('https');
const dns = require('dns');
const { isIP } = require('net');
const { URL } = require('url');
const { isBlockedIp } = require('./ssrf-guard-prototype');

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function assertHostnameAllowed(hostname, isBlockedIpFn) {
  if (isIP(hostname) && isBlockedIpFn(hostname)) {
    throw new Error(`SSRF guard: refusing to connect directly to blocked address ${hostname}`);
  }
}

// Wraps a raw dns.lookup-shaped resolver so the address it hands back to Node's http/https
// client is validated in the SAME callback that resolution happens in — no gap between
// "resolve" and "connect" for a DNS-rebinding attacker to exploit by answering differently on a
// second lookup.
function createGuardedLookup(rawLookup = dns.lookup, isBlockedIpFn = isBlockedIp) {
  return function guardedLookup(hostname, options, callback) {
    // dns.lookup()'s options param is optional (2-arg legacy form) — normalize like Node itself does.
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    rawLookup(hostname, options, (err, address, family) => {
      if (err) return callback(err);
      if (isBlockedIpFn(address)) {
        return callback(new Error(`SSRF guard: refusing to connect to ${hostname} -> ${address} (blocked address range)`));
      }
      callback(null, address, family);
    });
  };
}

function requestOnce(targetUrl, { method, headers, body, timeoutMs, lookup, isBlockedIpFn }) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch (err) {
      return reject(new Error(`SSRF guard: invalid URL: ${err.message}`));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return reject(new Error(`SSRF guard: unsupported protocol "${u.protocol}"`));
    }

    try {
      assertHostnameAllowed(u.hostname, isBlockedIpFn); // literal-IP fast path, see file header
    } catch (err) {
      return reject(err);
    }

    const mod = u.protocol === 'https:' ? https : http;
    // autoSelectFamily:false — Node's default "Happy Eyeballs" multi-address connect logic
    // calls a custom `lookup` with options.all=true, expecting an array of {address,family}
    // back instead of a single (address, family) pair; forcing it off keeps `lookup` on the
    // simple single-address callback shape this guard validates against.
    const req = mod.request(u, { method, headers, timeout: timeoutMs, lookup, autoSelectFamily: false }, (res) => {
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error(`SSRF guard: request to ${u.hostname} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function drain(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// safeFetch(url, options) -> Promise<{ statusCode, headers, body: Buffer }>
// Drop-in-shaped replacement for a plain fetch() call from within context.http(), with DNS
// resolution + redirect hops both validated against the SSRF blocklist. rawLookup/isBlockedIpFn
// are test-only overrides — production callers should never pass them.
async function safeFetch(url, {
  method = 'GET',
  headers = {},
  body,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rawLookup = dns.lookup,
  isBlockedIpFn = isBlockedIp,
} = {}) {
  const lookup = createGuardedLookup(rawLookup, isBlockedIpFn);
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(currentUrl, { method: currentMethod, headers, body: currentBody, timeoutMs, lookup, isBlockedIpFn });

    if (REDIRECT_STATUS_CODES.has(res.statusCode) && res.headers.location) {
      res.resume(); // drain and discard — we're not returning this hop's body
      currentUrl = new URL(res.headers.location, currentUrl).toString(); // resolve relative Location against the current hop
      if (res.statusCode === 303) {
        // 303 See Other always downgrades to GET per HTTP semantics, dropping any request body.
        currentMethod = 'GET';
        currentBody = undefined;
      }
      continue; // next loop iteration re-resolves + re-validates currentUrl from scratch
    }

    const responseBody = await drain(res);
    return { statusCode: res.statusCode, headers: res.headers, body: responseBody };
  }

  throw new Error(`SSRF guard: exceeded ${maxRedirects} redirect hops fetching ${url}`);
}

module.exports = { safeFetch, createGuardedLookup, assertHostnameAllowed };
