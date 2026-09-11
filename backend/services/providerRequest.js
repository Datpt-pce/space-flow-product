const circuits = new Map();
const totals = { requests: 0, errors: 0, rateLimited: 0, timeouts: 0, durationMs: 0, rejected: 0 };
async function requestText(url, options = {}, { signal, timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const origin = new URL(url).origin;
  if (!circuits.has(origin)) {
    if (circuits.size >= 100) throw Object.assign(new Error('Provider admission limit reached'), { code: 'PROVIDER_LIMIT' });
    circuits.set(origin, { active: 0, failures: 0, openUntil: 0 });
  }
  const circuit = circuits.get(origin);
  if (circuit.active >= 4 || circuit.openUntil > Date.now()) {
    totals.rejected++;
    throw Object.assign(new Error('Provider temporarily unavailable'), { code: 'PROVIDER_BACKPRESSURE', retryable: true });
  }
  circuit.active++; totals.requests++; const started = Date.now();
  const deadline = AbortSignal.timeout(Math.min(120000, Math.max(10, timeoutMs)));
  try {
    const response = await fetchImpl(url, { ...options, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (response.status === 429) {
      totals.rateLimited++;
      const retry = response.headers.get('retry-after');
      const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      circuit.openUntil = Date.now() + Math.min(300000, Math.max(1000, Number.isFinite(delay) ? delay : 30000));
    }
    if (response.status >= 500) circuit.failures++; else if (response.status !== 429) circuit.failures = 0;
    if (response.status >= 400) totals.errors++;
    if (circuit.failures >= 5) circuit.openUntil = Date.now() + 30000;
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.byteLength;
      if (size > 16 * 1024 * 1024) throw Object.assign(new Error('Provider response exceeds 16 MiB'), { code: 'PROVIDER_RESPONSE_LIMIT' });
      chunks.push(Buffer.from(chunk));
    }
    return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
  } catch (error) {
    totals.errors++; circuit.failures++;
    if (deadline.aborted) totals.timeouts++;
    if (circuit.failures >= 5) circuit.openUntil = Date.now() + 30000;
    throw error;
  } finally { circuit.active--; totals.durationMs += Date.now() - started; }
}
module.exports = { requestText, snapshot: () => ({ ...totals, active: [...circuits.values()].reduce((n, c) => n + c.active, 0), openCircuits: [...circuits.values()].filter(c => c.openUntil > Date.now()).length }) };
