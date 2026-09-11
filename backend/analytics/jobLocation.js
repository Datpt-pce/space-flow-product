function recordJobLocation(db, kind, id, location) {
  if(process.env.SF_ANALYTICS_ENABLED==='0')return;
  try {
    // Standalone domain consumers may initialize only their own schema.
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='analytics_jobs'").get())return;
    db.prepare('UPDATE analytics_jobs SET location=? WHERE kind=? AND id=?').run(location,kind,id);
  } catch { console.warn('[analytics] job location observation unavailable'); }
}
module.exports={recordJobLocation};
