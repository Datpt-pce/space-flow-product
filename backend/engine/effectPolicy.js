// Deliberately vetted built-ins only. A caller/third-party manifest cannot self-declare safety.
const pure = new Set(['text', 'list', 'set', 'if', 'switch', 'merge', 'filter', 'sort', 'limit',
  'aggregate', 'summarize', 'split-out', 'remove-duplicates', 'compare-datasets', 'rename-keys', 'stop-and-error', 'wait']);
function effectClass(type) { return pure.has(type) ? 'pure' : 'external-side-effect'; }
function retryPolicy(node) {
  const safe = effectClass(node.type) === 'pure';
  return { safe, maxAttempts: safe && node.retryOnFail ? Math.min(5, Math.max(1, Math.floor(Number(node.maxTries) || 2))) : 1,
    delayMs: Math.min(30000, Math.max(10, Number(node.retryDelay) || 1000)) };
}
module.exports = { effectClass, retryPolicy };
