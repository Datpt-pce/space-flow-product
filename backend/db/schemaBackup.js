const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function prepare(database) {
  const sources = ['index.js', 'readinessSchema.js', 'runSchema.js', 'artifactReferencesSchema.js', '../video/schema.js', '../sheet/schema.js', '../contributions/schema.js', '../analytics/schema.js'];
  const digest = crypto.createHash('sha256');
  for (const source of sources) digest.update(fs.readFileSync(path.join(__dirname, source)));
  const hash = digest.digest('hex');
  const marker = database + '.schema-sha256';
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === hash) return () => {};
  if (fs.existsSync(database) && fs.statSync(database).size > 0) {
    const source = new DatabaseSync(database);
    try {
      source.exec('PRAGMA busy_timeout = 5000');
      const destination = database + '.pre-migration-' + Date.now() + '-' + crypto.randomUUID() + '.sqlite';
      source.prepare('VACUUM INTO ?').run(destination);
      fs.chmodSync(destination, 0o600);
    } finally { source.close(); }
  }
  return () => fs.writeFileSync(marker, hash, { mode: 0o600 });
}
module.exports = { prepare };
