var a=Object.defineProperty;var E=(e,t)=>a(e,"name",{value:t,configurable:!0});const crypto=require("crypto"),sql=`
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), path TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'upload',
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
  created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_id, state);
`;function ensureReadinessSchema(e){e.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");const t=crypto.createHash("sha256").update(sql).digest("hex"),T=e.prepare("SELECT checksum FROM schema_migrations WHERE id = ?").get("001-readiness-artifacts");if(T&&T.checksum!==t)throw new Error("Migration checksum mismatch: 001-readiness-artifacts");if(!T){e.exec("BEGIN IMMEDIATE");try{e.exec(sql),e.prepare("INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)").run("001-readiness-artifacts",t),e.exec("COMMIT")}catch(s){throw e.exec("ROLLBACK"),s}}}E(ensureReadinessSchema,"ensureReadinessSchema"),module.exports={ensureReadinessSchema};
