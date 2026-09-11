// Offline, backup-first rotation. Keys are environment-only, never arguments or output.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { database } = require('../backend/utils/dataPaths');
const { encrypt, decrypt } = require('../backend/utils/encryption');
const nextKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
const oldKey = process.env.SF_PREVIOUS_CREDENTIALS_KEY || nextKey;
if (!/^[a-fA-F0-9]{64}$/.test(nextKey || '') || !/^[a-fA-F0-9]{64}$/.test(oldKey || '')) throw new Error('Valid current and previous encryption keys are required');
if (!fs.existsSync(database)) throw new Error('Existing database required');
const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--quiesced')) throw new Error('Stop application writers and pass --quiesced before applying rotation');
const db = new DatabaseSync(database, { readOnly: !apply });
const targets = [ ['credentials', 'data'], ['flow_runs', 'intent'], ['run_events', 'data'], ['node_runs', 'checkpoint'], ['workflow_schedules', 'intent'] ];
const updates = [];
try {
  for (const [table, column] of targets) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    for (const row of db.prepare(`SELECT rowid AS row_id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all()) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = oldKey;
      const plaintext = decrypt(row.value);
      // Parse before changing any row, so malformed or wrong-key records abort without partial updates.
      JSON.parse(plaintext);
      process.env.CREDENTIALS_ENCRYPTION_KEY = nextKey;
      updates.push({ table, column, id: row.row_id, old: row.value, value: encrypt(plaintext) });
    }
  }
  if (apply) {
    const snapshot = database + '.pre-key-rotation-' + Date.now() + '.sqlite';
    db.prepare('VACUUM INTO ?').run(snapshot); fs.chmodSync(snapshot, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of updates) {
        const changed = db.prepare(`UPDATE ${row.table} SET ${row.column}=? WHERE rowid=? AND ${row.column}=?`).run(row.value, row.id, row.old);
        if (changed.changes !== 1) throw new Error('Data changed during rotation; transaction rolled back');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', records: updates.length, backupRequired: apply }));
} finally { process.env.CREDENTIALS_ENCRYPTION_KEY = nextKey; db.close(); }
