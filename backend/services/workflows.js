const crypto = require('crypto');
const db = require('../db');
const { parseDocument, invalid } = require('../contracts/workflow');
const { enqueueReindex } = require('../graph/reindexQueue');
const { reindexWorkflow } = require('../graph/indexer');

function get(id, owner, write = false) {
  const row = db.prepare('SELECT w.*,u.name AS owner_name FROM workflows w JOIN users u ON u.id=w.owner_id WHERE w.id=?').get(id);
  if (!row) throw invalid('Workflow not found', 404, 'NOT_FOUND');
  if (row.owner_id !== owner && (write || row.visibility !== 'team')) throw invalid('Workflow access denied', 403, 'FORBIDDEN');
  return row;
}
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Invalid workflow document');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 240)) throw invalid('Invalid workflow name');
  if (body.visibility !== undefined && !['private', 'team'].includes(body.visibility)) throw invalid('Invalid visibility');
  if (body.payload !== undefined) parseDocument(body.payload);
}
function checkRevision(row, ifMatch) {
  if (ifMatch === undefined) return; // Existing clients retain the documented compatibility window.
  if (ifMatch !== `"${row.revision}"`) throw invalid('Workflow changed; reload before saving', 412, 'REVISION_CONFLICT');
}
function create(body, owner) {
  validate(body); if (!body.name || !body.payload) throw invalid('Name and payload required');
  const refs = require('./artifacts').assertReferences(body.payload, owner);
  const id = crypto.randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO workflows(id,owner_id,name,visibility,payload) VALUES(?,?,?,?,?)').run(id, owner, body.name, body.visibility || 'private', JSON.stringify(body.payload));
    for (const artifactId of refs) db.prepare('INSERT INTO workflow_artifacts(workflow_id,artifact_id) VALUES(?,?)').run(id, artifactId);
    enqueueReindex(id); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  reindexWorkflow(id); return get(id, owner);
}
function update(id, body, owner, ifMatch) {
  validate(body); const row = get(id, owner, true); checkRevision(row, ifMatch);
  const refs = body.payload ? require('./artifacts').assertReferences(body.payload, owner) : null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const changed = db.prepare("UPDATE workflows SET name=?,visibility=?,payload=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND owner_id=? AND revision=?")
    .run(body.name ?? row.name, body.visibility ?? row.visibility, body.payload === undefined ? row.payload : JSON.stringify(body.payload), id, owner, row.revision);
    if (!changed.changes) throw invalid('Workflow changed; reload before saving', 412, 'REVISION_CONFLICT');
    if (refs) {
      db.prepare('DELETE FROM workflow_artifacts WHERE workflow_id=?').run(id);
      for (const artifactId of refs) db.prepare('INSERT INTO workflow_artifacts(workflow_id,artifact_id) VALUES(?,?)').run(id, artifactId);
    }
    enqueueReindex(id); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  reindexWorkflow(id); return get(id, owner);
}
function remove(id, owner, ifMatch) {
  const row = get(id, owner, true); checkRevision(row, ifMatch);
  db.prepare('DELETE FROM workflows WHERE id=? AND owner_id=? AND revision=?').run(id, owner, row.revision);
  enqueueReindex(id); reindexWorkflow(id);
}
function list(owner, query = {}) {
  if (query.limit === undefined && query.cursor === undefined) {
    return db.prepare("SELECT w.*,u.name AS owner_name FROM workflows w JOIN users u ON u.id=w.owner_id WHERE w.visibility='team' OR w.owner_id=? ORDER BY w.updated_at DESC,w.id DESC").all(owner);
  }
  const limit = Number(query.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit must be an integer from 1 to 100');
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 400) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || typeof cursor[1] !== 'string') throw new Error();
    } catch { throw invalid('Invalid workflow cursor'); }
  }
  const rows = db.prepare(`SELECT w.*,u.name AS owner_name FROM workflows w JOIN users u ON u.id=w.owner_id
    WHERE (w.visibility='team' OR w.owner_id=?) ${cursor ? 'AND (w.updated_at < ? OR (w.updated_at = ? AND w.id < ?))' : ''}
    ORDER BY w.updated_at DESC,w.id DESC LIMIT ?`).all(owner, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), limit + 1);
  const more = rows.length > limit; if (more) rows.pop();
  const last = rows.at(-1);
  return { rows, nextCursor: more ? Buffer.from(JSON.stringify([last.updated_at, last.id])).toString('base64url') : null };
}
module.exports = { get, create, update, remove, list };
