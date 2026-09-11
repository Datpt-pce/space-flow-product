const fs = require('fs');
const { uploads, database } = require('../utils/dataPaths');

function dependencies(db, { disk = fs.statfsSync, now = Date.now(), backupAt = null } = {}) {
  const signals = {};
  try { signals.database = db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get().n > 0 ? 'ok' : 'unavailable'; }
  catch { signals.database = 'unavailable'; }
  try {
    const stat = disk(uploads);
    signals.disk = stat.bavail * stat.bsize < Number(process.env.SF_MIN_FREE_BYTES ?? 1024 ** 3) ? 'low' : 'ok';
  } catch { signals.disk = 'unavailable'; }
  signals.backup = backupAt == null ? 'unknown' : now - backupAt > Number(process.env.SF_BACKUP_MAX_AGE_MS || 86400000) ? 'stale' : 'ok';
  return signals;
}
function installHealth(app, db, telemetry, auth, admin) {
  let draining = false;
  app.get('/live', (req, res) => res.json({ status: 'live' }));
  app.get('/ready', (req, res) => {
    const status = dependencies(db);
    const ready = !draining && status.database === 'ok' && status.disk === 'ok';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });
  const snapshot = () => {
    let backupAt = null;
    try { backupAt = JSON.parse(fs.readFileSync(database + '.backup-status.json', 'utf8')).completedAt; } catch { /* unknown */ }
    const grouped = (table, column) => db.prepare(`SELECT ${column} AS state,COUNT(*) AS count FROM ${table} GROUP BY ${column}`).all();
    const oldest = db.prepare("SELECT MIN(created_at) AS oldest FROM flow_runs WHERE state='queued'").get().oldest;
    return { requests: telemetry.snapshot(), dependencies: dependencies(db, { backupAt }), uptime_seconds: process.uptime(), draining,
      runs: grouped('flow_runs', 'state'), nodes: grouped('node_runs', 'state'), render: grouped('video_render_jobs', 'status'),
      agents: grouped('agents', 'status'), queueOldestAgeMs: oldest == null ? 0 : Date.now() - oldest,
      provider: require('../services/providerRequest').snapshot(),
      databaseBytes: fs.statSync(database).size,
      databaseOperations: require('./database').snapshot(),
      artifactBytes: db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM artifacts WHERE state='active'").get().bytes,
    };
  };
  app.get('/api/operations/metrics', auth, admin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const data = snapshot();
    res.json({ ...data, alerts: require('./dashboard').alerts(data) });
  });
  app.get('/api/operations/dashboard', auth, admin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res.type('html').send(require('./dashboard').render(snapshot()));
  });
  return { drain: () => { draining = true; } };
}
module.exports = { dependencies, installHealth };
