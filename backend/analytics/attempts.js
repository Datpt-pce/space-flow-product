function recordAttempt(db, runId, data, now=Date.now()) {
  if (process.env.SF_ANALYTICS_ENABLED === '0') return;
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_attempts'").get();
  if(!exists)return; // Legacy focused fixtures and old database consumers.
  if(!data || !/^[a-f0-9-]{36}$/.test(data.id) || !['started','succeeded','failed','cancelled'].includes(data.state) ||
    !['agent','server'].includes(data.location) || typeof data.nodeType!=='string' || data.nodeType.length>160 ||
    !Number.isInteger(data.attempt) || data.attempt<1 || data.attempt>100) return;
  const owner=db.prepare('SELECT owner_id FROM flow_runs r JOIN node_runs n ON r.id=n.run_id WHERE r.id=? AND n.node_id=?').get(runId,data.nodeId);
  if(!owner)return;
  if(data.state==='started') {
    db.prepare('INSERT OR IGNORE INTO analytics_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(data.id,runId,owner.owner_id,data.nodeId,data.nodeType,data.attempt,data.location,now,null,null,'running');
  } else if(Number.isFinite(data.durationMs) && data.durationMs>=0 && data.durationMs<=7*86400000) {
    db.prepare("UPDATE analytics_attempts SET ended_at=?,duration_ms=?,state=? WHERE id=? AND run_id=? AND node_id=? AND state='running'")
      .run(now,data.durationMs,data.state,data.id,runId,data.nodeId);
  }
}
module.exports={recordAttempt};
