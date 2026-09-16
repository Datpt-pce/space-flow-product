var n=Object.defineProperty;var o=(e,r)=>n(e,"name",{value:r,configurable:!0});const crypto=require("crypto"),sql=`
CREATE TABLE IF NOT EXISTS contribution_records (
 kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS contribution_records_updated ON contribution_records(kind,updated_at);
`;function ensureContributionSchema(e){const r="004-contribution-records",c=crypto.createHash("sha256").update(sql).digest("hex"),t=e.prepare("SELECT checksum FROM schema_migrations WHERE id=?").get(r);if(t){if(t.checksum!==c)throw new Error(`Migration checksum mismatch: ${r}`);return}e.exec("BEGIN IMMEDIATE");try{e.exec(sql),e.prepare("INSERT INTO schema_migrations(id,checksum) VALUES (?,?)").run(r,c),e.exec("COMMIT")}catch(i){throw e.exec("ROLLBACK"),i}}o(ensureContributionSchema,"ensureContributionSchema"),module.exports={ensureContributionSchema};
