const crypto = require('crypto');
const { performance } = require('perf_hooks');

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
const secretKey = /password|passphrase|token|secret|authorization|cookie|credential|api.?key|__resolved/i;
function redact(value, depth = 0) {
  if (depth > 12) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretKey.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  return value;
}

function createTelemetry({ write = line => process.stdout.write(line + '\n') } = {}) {
  const metrics = new Map();
  const middleware = (req, res, next) => {
    const start = performance.now();
    req.requestId = validId(req.headers['x-request-id']) ? req.headers['x-request-id'] : crypto.randomUUID();
    req.correlationId = validId(req.headers['x-correlation-id']) ? req.headers['x-correlation-id'] : req.requestId;
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Correlation-Id', req.correlationId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.secure && process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400 && body && typeof body.error === 'string') {
        body = { code: `HTTP_${res.statusCode}`, message: body.error, fieldErrors: [],
          retryable: [429, 502, 503, 504].includes(res.statusCode), ...body, requestId: req.requestId };
      }
      return json(body);
    };
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const duration = performance.now() - start;
      // Templates only: no path/query/body values, tokens, provider payloads or raw errors.
      const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
      const key = `${req.method} ${route}`;
      if (!metrics.has(key) && metrics.size < 300) metrics.set(key, { count: 0, errors: 0, duration_ms: 0, buckets: [0, 0, 0, 0, 0, 0] });
      const m = metrics.get(key);
      const status = res.writableFinished ? res.statusCode : 499;
      if (m) {
        m.count++; m.errors += status >= 500 ? 1 : 0; m.duration_ms += duration;
        [10, 50, 100, 500, 2000, Infinity].forEach((bound, i) => { if (duration <= bound) m.buckets[i]++; });
      }
      write(JSON.stringify({ timestamp: new Date().toISOString(), level: status >= 500 ? 'error' : 'info',
        request_id: req.requestId, correlation_id: req.correlationId, user_id: req.user?.id || null,
        action: key, duration_ms: Math.round(duration * 100) / 100, status_code: status, message: 'request completed' }));
    };
    res.once('finish', record); res.once('close', record);
    next();
  };
  return { middleware, snapshot: () => Object.fromEntries(metrics) };
}

module.exports = { createTelemetry, redact, validId };
