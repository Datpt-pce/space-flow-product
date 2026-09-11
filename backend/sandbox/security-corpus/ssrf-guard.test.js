// Initial SSRF security corpus — Platform Core Phase 0.3
// (specs/space-flow-master-plan/00-platform-core.md). Run with:
//   node backend/sandbox/security-corpus/ssrf-guard.test.js
// Seeds the fuller corpus Custom Node Platform Phase 9 will run in CI against the real
// context.http() guard (DNS rebinding, redirect re-validation) — this only exercises the
// IP-classification prototype in ssrf-guard-prototype.js.

const assert = require('assert');
const { isBlockedIp } = require('../ssrf-guard-prototype');

const cases = [
  // [ip, expectedBlocked, label]
  ['169.254.169.254', true, 'cloud metadata endpoint'],
  ['127.0.0.1', true, 'IPv4 loopback'],
  ['10.0.0.1', true, 'RFC1918 10.0.0.0/8'],
  ['172.16.0.1', true, 'RFC1918 172.16.0.0/12'],
  ['192.168.1.1', true, 'RFC1918 192.168.0.0/16'],
  ['0.0.0.0', true, '"this" network'],
  ['100.64.0.1', true, 'carrier-grade NAT'],
  ['224.0.0.1', true, 'multicast'],
  ['::1', true, 'IPv6 loopback'],
  ['fe80::1', true, 'IPv6 link-local'],
  ['fd00::1', true, 'IPv6 unique-local'],
  ['::ffff:127.0.0.1', true, 'IPv4-mapped IPv6 loopback (encoding bypass attempt)'],
  ['::ffff:169.254.169.254', true, 'IPv4-mapped IPv6 metadata endpoint (encoding bypass attempt)'],
  ['not-an-ip', true, 'unparseable input — must fail closed'],
  ['8.8.8.8', false, 'public IPv4 (Google DNS)'],
  ['1.1.1.1', false, 'public IPv4 (Cloudflare DNS)'],
  ['2606:4700:4700::1111', false, 'public IPv6 (Cloudflare DNS)'],
];

let pass = 0;
let fail = 0;
for (const [ip, expected, label] of cases) {
  try {
    assert.strictEqual(isBlockedIp(ip), expected, `${label} (${ip}): expected blocked=${expected}`);
    pass++;
  } catch (err) {
    fail++;
    console.error('FAIL —', err.message);
  }
}

console.log(`${pass}/${cases.length} passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exitCode = 1;
