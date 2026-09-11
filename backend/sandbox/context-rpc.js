// Capability-mediated context SDK — Custom Node Platform Phase 4
// (specs/space-flow-master-plan/01-custom-node-platform.md). Replaces the Platform Core
// Phase 0.2 skeleton (every method threw "not implemented yet") with real enforcement, now that
// the pieces it depends on exist: backend/sandbox/ssrf-guard.js (real DNS+redirect-hop-validated
// fetch), backend/sandbox/secret-handle.js (opaque credential tokens), and Phase 3's
// js-runtime.js/py-runtime.js (which actually create a per-run scratchDir this module can be
// pointed at).
//
// capabilityGrants shape matches backend/registry/manifest-schema.json's `capabilities` block:
// { network: string[], filesystem: 'none'|'scratch'|'user-approved-path', secrets: string[],
//   process: boolean, gpu: boolean }, plus an approvedPaths: string[] runtime addition (the
// concrete paths a user approved at install time for a 'user-approved-path' grant — the manifest
// only declares the CAPABILITY TYPE, not which paths; see backend/sandbox/py-runtime.js's
// identical approvedPaths convention from Phase 3).
//
// STILL A STUB: cancellationToken. Real cancellation needs a mid-run cancel signal plumbed
// through js-runtime.js's isolate.dispose()/py-runtime.js's SIGKILL — genuinely separate,
// non-trivial plumbing Phase 4's task checklist doesn't actually ask for (it lists ssrf-guard,
// secret-handle, scratchDir, output validation, output/log size limits — cancellation isn't
// among them). Left as notImplemented rather than half-built.

const path = require('path');
const { safeFetch } = require('./ssrf-guard');
const { createSecretStore } = require('./secret-handle');

function notImplemented(method) {
  throw new Error(
    `context.${method}() is not implemented yet — see backend/sandbox/context-rpc.js's file ` +
    'header for why (real mid-run cancellation needs runtime plumbing this Phase didn\'t add).'
  );
}

// True if `child` (an absolute path) is inside `parent` (an absolute path), including
// child === parent. path.relative()-based rather than a raw startsWith() string check, which
// would wrongly treat "/approved-foo" as inside "/approved" — a real path-traversal-adjacent
// footgun for this exact kind of "is this path within that directory" check.
function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveScopedPath(requestedPath, { capabilityGrants, scratchDir }) {
  const fsGrant = capabilityGrants.filesystem || 'none';
  if (fsGrant === 'none') {
    throw new Error('context.fs: this node has no filesystem capability granted.');
  }
  if (fsGrant === 'scratch') {
    // requestedPath is always relative to scratchDir in this mode — path.resolve() against it
    // (not against process.cwd()) so a caller can't step outside via an absolute path either.
    const resolved = path.resolve(scratchDir, requestedPath);
    if (!isWithin(scratchDir, resolved)) {
      throw new Error(`context.fs: path "${requestedPath}" escapes the scratch directory — not allowed.`);
    }
    return resolved;
  }
  // 'user-approved-path'
  const resolved = path.resolve(requestedPath);
  const approvedPaths = capabilityGrants.approvedPaths || [];
  const allowed = approvedPaths.some((p) => isWithin(path.resolve(p), resolved));
  if (!allowed) {
    throw new Error(`context.fs: path "${requestedPath}" is outside every user-approved path for this node.`);
  }
  return resolved;
}

// createContextRpc({ capabilityGrants, send, scratchDir, userId, secretStore, fetchImpl }) -> context
// send: (type, payload) => void — the worker's IPC write function, e.g.
// (type, payload) => writeMessage(process.stdout, type, payload) from ipc-protocol.js.
// scratchDir: this run's per-node scratch directory (see executor.js's identical
// scratchDir-per-nodeId convention) — must already exist, this module doesn't create it.
// secretStore: injectable for tests; defaults to a fresh createSecretStore() per call.
// fetchImpl: injectable for tests (default safeFetch) — lets context-rpc.test.js verify the
// domain-allowlist gate runs (or doesn't) without needing a real network call for every case;
// production callers should never override this.
function createContextRpc({ capabilityGrants = {}, send, scratchDir, userId, secretStore = createSecretStore(), fetchImpl = safeFetch }) {
  const fsModule = require('fs');

  return {
    log: (message) => send('log', { message, level: 'debug' }),
    progress: (percent, message) => send('progress', { percent, message }),

    scratchDir: () => {
      if (!scratchDir) throw new Error('context.scratchDir(): no scratch directory was provisioned for this run.');
      return scratchDir;
    },

    // http(url, options) -> { statusCode, headers, body }. Two layers of enforcement, both
    // required: (1) the domain allowlist below (this node specifically declared+was granted
    // this domain), (2) ssrf-guard.js's DNS/redirect-hop validation (that domain doesn't
    // resolve to a private/metadata address right now, regardless of what it's *called*).
    // options.secretToken (from context.secret()) gets injected as auth via applyAuthByToken —
    // the real credential value never passes through node code or this function's return value.
    http: async (url, options = {}) => {
      const allowedDomains = capabilityGrants.network || [];
      if (allowedDomains.length === 0) {
        throw new Error('context.http(): this node has no network capability granted.');
      }
      let hostname;
      try {
        hostname = new URL(url).hostname;
      } catch (err) {
        throw new Error(`context.http(): invalid URL: ${err.message}`);
      }
      if (!allowedDomains.includes(hostname)) {
        throw new Error(`context.http(): domain "${hostname}" is not in this node's allowlisted capabilities.network (${allowedDomains.join(', ') || '(none)'}).`);
      }

      const headers = { ...(options.headers || {}) };
      const qs = {};
      if (options.secretToken) {
        secretStore.applyAuthByToken(options.secretToken, { headers, qs });
      }
      let finalUrl = url;
      if (Object.keys(qs).length > 0) {
        const u = new URL(url);
        for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
        finalUrl = u.toString();
      }

      return fetchImpl(finalUrl, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        maxRedirects: options.maxRedirects,
        timeoutMs: options.timeoutMs,
      });
    },

    // secret(name) -> opaque token. Only issuable for names this node's manifest actually
    // declared in capabilities.secrets — same default-deny posture as network/filesystem.
    secret: (name) => {
      const allowedSecrets = capabilityGrants.secrets || [];
      if (!allowedSecrets.includes(name)) {
        throw new Error(`context.secret(): "${name}" is not in this node's allowlisted capabilities.secrets.`);
      }
      return secretStore.issue(name, userId);
    },

    // Both marked `async` deliberately, not just "returns a Promise" — resolveScopedPath()'s
    // capability check throws synchronously, and without `async` here that throw would escape
    // as a synchronous exception instead of a Promise rejection, an inconsistent contract for
    // an API every other method on this object returns a Promise from.
    fs: {
      readFile: async (relativePath, encoding = 'utf8') => {
        const resolved = resolveScopedPath(relativePath, { capabilityGrants, scratchDir });
        return fsModule.promises.readFile(resolved, encoding);
      },
      writeFile: async (relativePath, data) => {
        const resolved = resolveScopedPath(relativePath, { capabilityGrants, scratchDir });
        return fsModule.promises.writeFile(resolved, data);
      },
    },

    cancellationToken: {
      get cancelled() { return false; },
      onCancel: (_callback) => notImplemented('cancellationToken.onCancel'),
    },

    capabilityGrants,
  };
}

module.exports = { createContextRpc, isWithin, resolveScopedPath };
