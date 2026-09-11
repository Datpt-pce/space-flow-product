function alerts(snapshot) {
  const found = [];
  const add = (id, symptom, action) => found.push({ id, symptom, owner: 'deployment operator', action, runbook: 'docs/product/operations.md' });
  if (snapshot.dependencies.database !== 'ok') add('db-unavailable', 'Database probe unavailable', 'Inspect writer lock and disk; stop admission before recovery');
  if (snapshot.dependencies.disk !== 'ok') add('disk-pressure', 'Free disk below configured floor or probe unavailable', 'Pause intake; inspect protected artifact retention and volume capacity');
  if (snapshot.dependencies.backup !== 'ok') add('backup-freshness', 'Backup missing, stale or unverified', 'Quiesce writers; create and restore a new backup into a clean path');
  if (snapshot.queueOldestAgeMs > 60000) add('queue-age', 'Oldest queued run exceeds 60 seconds', 'Inspect offline agents and provider circuits; reduce admission');
  if (snapshot.provider?.openCircuits) add('provider-circuit', 'Provider circuit is open', 'Respect Retry-After; verify quota and provider availability before resuming');
  if (snapshot.runs?.some(row => row.state === 'unknown' && row.count)) add('unknown-outcome', 'Interrupted side effect needs reconciliation', 'Check provider or output receipt; do not blindly submit another run');
  return found;
}
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function render(snapshot) {
  const cards = ['runs', 'nodes', 'render', 'agents'].map(name => `<section><h2>${name}</h2><table><tr><th>State</th><th>Count</th></tr>${snapshot[name].map(row => `<tr><td>${escape(row.state)}</td><td>${row.count}</td></tr>`).join('') || '<tr><td colspan="2">No records</td></tr>'}</table></section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="15"><title>Space Flow operations</title>
<style>body{margin:32px;font:16px system-ui;background:#10161f;color:#ecf0f7}h1{margin-bottom:4px}p{color:#b2bed0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}section{background:#1a2432;padding:20px;border-radius:12px}h2{text-transform:capitalize;margin-top:0}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:8px;border-bottom:1px solid #354255}.alerts{margin-top:24px}.alert{border-left:4px solid #f3bc5a;padding:12px 16px;margin:12px 0;background:#1a2432}</style>
<h1>Space Flow operations</h1><p>Refreshes every 15 seconds · ${escape(new Date().toISOString())}</p>
<p>Database: ${escape(snapshot.dependencies.database)} · Disk: ${escape(snapshot.dependencies.disk)} · Backup: ${escape(snapshot.dependencies.backup)} · Oldest queue: ${Math.round(snapshot.queueOldestAgeMs / 1000)}s</p>
<main>${cards}</main><div class="alerts"><h2>Operator actions</h2>${alerts(snapshot).map(alert => `<div class="alert"><strong>${escape(alert.symptom)}</strong><p>${escape(alert.action)}</p><small>Owner: ${escape(alert.owner)} · ${escape(alert.runbook)}</small></div>`).join('') || '<p>No active alerts</p>'}</div></html>`;
}
module.exports = { alerts, render };
