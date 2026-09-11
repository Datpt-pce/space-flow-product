function recordOutputUsage(db, owner, id) {
  if(process.env.SF_ANALYTICS_ENABLED==='0')return;
  // Called only after the protected render download completes successfully.
  db.prepare("INSERT OR IGNORE INTO analytics_output_usage VALUES ('render-download',?,?,?)").run(id,owner,Date.now());
}
module.exports={recordOutputUsage};
