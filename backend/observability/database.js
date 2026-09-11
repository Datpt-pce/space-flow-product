const { performance } = require('perf_hooks');
const metrics = { operations: 0, writes: 0, busy: 0, errors: 0, durationMs: 0, maxDurationMs: 0 };
const attached = new WeakSet();
function attach(db) {
  if (attached.has(db)) return db;
  attached.add(db);
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    return new Proxy(statement, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!['run', 'get', 'all'].includes(property)) return value.bind(target);
      return (...args) => {
        const start = performance.now(); metrics.operations++;
        if (property === 'run') metrics.writes++;
        try { return value.apply(target, args); }
        catch (error) { metrics.errors++; if (/locked|busy/i.test(error.message)) metrics.busy++; throw error; }
        finally { const duration = performance.now() - start; metrics.durationMs += duration; metrics.maxDurationMs = Math.max(metrics.maxDurationMs, duration); }
      };
    } });
  };
  return db;
}
module.exports = { attach, snapshot: () => ({ ...metrics }) };
