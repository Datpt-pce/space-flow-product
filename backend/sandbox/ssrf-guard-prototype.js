// SSRF blocklist prototype — Platform Core Phase 0.3 security-corpus seed.
// Real guard (DNS resolution before connect, re-validation on every redirect hop — see
// Custom Node Platform Phase 4, specs/space-flow-master-plan/01-custom-node-platform.md)
// is not implemented here. This is only the IP-classification piece, extracted early so it
// has a starting test corpus (backend/sandbox/security-corpus/ssrf-guard.test.js) before the
// full context.http() guard is built.

const { isIP } = require('net');

// RFC1918 + special-use IPv4 ranges, including the cloud metadata endpoint (169.254.169.254
// falls inside 169.254.0.0/16, link-local).
const BLOCKED_V4_CIDRS = [
  ['0.0.0.0', 8],       // "this" network
  ['10.0.0.0', 8],      // RFC1918
  ['100.64.0.0', 10],   // carrier-grade NAT
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local (includes cloud metadata 169.254.169.254)
  ['172.16.0.0', 12],   // RFC1918
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.168.0.0', 16],  // RFC1918
  ['198.18.0.0', 15],   // benchmarking
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reserved
];

function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isBlockedV4(ip) {
  const target = ipToInt(ip);
  return BLOCKED_V4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipToInt(base) & mask) === (target & mask);
  });
}

// Fails closed: anything not confidently classified as a safe public address is blocked.
function isBlockedIp(ip) {
  const version = isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — unwrap and re-check as v4 instead of letting it slip through
      // as "not v4/not a recognized v6 special range".
      const v4 = lower.slice('::ffff:'.length);
      return isIP(v4) === 4 ? isBlockedV4(v4) : true;
    }
    return false;
  }
  return true; // not a valid IP literal at all — fail closed
}

module.exports = { isBlockedIp, isBlockedV4 };
