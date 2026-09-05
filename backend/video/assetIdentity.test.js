const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const { importAsset } = require('../routes/video-assets');
let probes = 0;
const run = async kind => {
  if (kind === 'hash') return { contentHash: 'same-bytes', sizeBytes: 100 };
  if (kind === 'probe') { probes++; await new Promise(resolve => setTimeout(resolve, 20)); return { metadata: { sizeBytes: 100, durationMs: 1000 } }; }
  throw new Error(kind);
};
(async () => {
  const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => importAsset('owner', `copy${i}.mp3`, run, { skipPreflight: true })));
  assert.equal(new Set(rows.map(r => r.id)).size, 1);
  assert.equal(probes, 1, 'concurrent content copies share one probe pipeline');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_assets').get().n, 1);
  const other = await importAsset('other', 'other.mp3', run, { skipPreflight: true });
  const server = await importAsset('owner', 'server.mp3', run, { skipPreflight: true, sourceLocality: 'server' });
  assert.notEqual(other.id, rows[0].id); assert.notEqual(server.id, rows[0].id);
  console.log('PASS concurrent import: 12 copies share identity/probe, owner and locality stay separate');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
