// Secret-handle mediation — Custom Node Platform Phase 4
// (specs/space-flow-master-plan/01-custom-node-platform.md). context.secret(name) must return
// an opaque token, never the real credential value — the real value is only ever resolved
// host-side (this module runs in the trusted Sandbox Host process, never inside the sandboxed
// child), at the exact point something actually needs it (e.g. context.http() injecting an
// Authorization header). Reuses backend/utils/credentials.js's existing getCredential/applyAuth
// rather than reimplementing credential resolution — this only adds the token indirection layer
// in front of it.

const crypto = require('crypto');
const { getCredential, applyAuth } = require('../utils/credentials');

// createSecretStore() is scoped to ONE run/context instance (see context-rpc.js) — tokens don't
// need to survive past that, and keeping the store per-run means a token leaked in a log line
// from one run is meaningless noise in any other run, not a reusable key.
function createSecretStore() {
  const tokens = new Map(); // token -> { name, userId }

  return {
    // issue(): called from context.secret(name) — the ONLY thing that ever crosses back into
    // node code. Never returns credential data itself.
    issue(name, userId) {
      const token = `sfsecret_${crypto.randomUUID()}`;
      tokens.set(token, { name, userId });
      return token;
    },

    // resolveCredential(): host-side only, never exposed to node code — used internally by
    // whatever mediates an actual side effect (e.g. ssrf-guard-wrapped context.http()).
    resolveCredential(token) {
      const entry = tokens.get(token);
      if (!entry) {
        throw new Error('Unknown secret handle — it may be from a different run or was never issued.');
      }
      return getCredential(entry.name, entry.userId);
    },

    // applyAuthByToken(): convenience wrapper matching backend/utils/credentials.js's existing
    // applyAuth(credential, {headers, qs}) signature, resolving the token first.
    applyAuthByToken(token, target) {
      applyAuth(this.resolveCredential(token), target);
    },
  };
}

module.exports = { createSecretStore };
