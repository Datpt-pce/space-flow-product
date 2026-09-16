var i=Object.defineProperty;var t=(r,e)=>i(r,"name",{value:e,configurable:!0});const crypto=require("crypto"),sql=`
CREATE TABLE IF NOT EXISTS workflow_artifacts (
 workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), PRIMARY KEY(workflow_id,artifact_id)
);
CREATE TABLE IF NOT EXISTS run_artifacts (
 run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES artifacts(id), PRIMARY KEY(run_id,artifact_id)
);
`;function ensureArtifactReferencesSchema(r){const e=crypto.createHash("sha256").update(sql).digest("hex"),E=r.prepare("SELECT checksum FROM schema_migrations WHERE id=?").get("003-artifact-references");if(E){if(E.checksum!==e)throw new Error("Migration checksum mismatch: 003-artifact-references");return}r.exec("BEGIN IMMEDIATE");try{r.exec(sql),r.prepare("INSERT INTO schema_migrations(id,checksum) VALUES(?,?)").run("003-artifact-references",e),r.exec("COMMIT")}catch(c){throw r.exec("ROLLBACK"),c}}t(ensureArtifactReferencesSchema,"ensureArtifactReferencesSchema"),module.exports={ensureArtifactReferencesSchema};
