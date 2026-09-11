const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/encryption');
const { parseWorkflow, authorize, invalid } = require('../contracts/workflow');
const { effectClass } = require('../engine/effectPolicy');

function createRunService(db, { execute, now = Date.now, maxActive = 4, maxPerOwner = 2, maxQueued = 100, leaseMs = 30000 } = {}) {
  const worker = crypto.randomUUID();
  const active = new Map();
  const listeners = new Map();
  let timer = null, stopped = false;
  const decode = value => JSON.parse(decrypt(value));
  const encode = value => encrypt(JSON.stringify(value));
  function emit(id, event, data) {
    if (event === 'analyticsAttempt') {
      require('../analytics/attempts').recordAttempt(db, id, data, now());
      return;
    }
    const payload = { ...data, runId: id };
    const inserted = db.prepare('INSERT INTO run_events(run_id,event,data,created_at) VALUES (?,?,?,?)').run(id, event, encode(payload), now());
    if (data.nodeId && ['nodeStart', 'nodeComplete', 'nodeError'].includes(event)) {
      if (event === 'nodeStart') db.prepare("UPDATE node_runs SET state='running', attempt=attempt+1 WHERE run_id=? AND node_id=?").run(id, data.nodeId);
      else db.prepare('UPDATE node_runs SET state=?, checkpoint=? WHERE run_id=? AND node_id=?')
        .run(event === 'nodeComplete' ? 'succeeded' : 'failed', event === 'nodeComplete' ? encode(data.outputs || {}) : null, id, data.nodeId);
    }
    for (const listener of listeners.get(id) || []) { try { listener(event, payload, Number(inserted.lastInsertRowid)); } catch { /* disconnected delivery cannot cancel a logical run */ } }
  }
  function get(id, owner) {
    const row = db.prepare('SELECT * FROM flow_runs WHERE id=? AND owner_id=?').get(id, owner);
    if (!row) throw invalid('Run not found', 404, 'NOT_FOUND');
    return row;
  }
  function submit({ workflow, startNodeId = null, resume = false }, user, { idempotencyKey = null, requestId = null, correlationId = null } = {}) {
    if (stopped) throw invalid('Worker is draining', 503, 'DRAINING');
    parseWorkflow(workflow); authorize(workflow, user, db);
    if (typeof resume !== 'boolean') throw invalid('resume must be a boolean');
    const artifactIds = require('./artifacts').assertReferences(workflow, user.id);
    if (startNodeId !== null && !workflow.nodes.some(n => n.id === startNodeId)) throw invalid('Unknown startNodeId');
    if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(idempotencyKey))) throw invalid('Invalid idempotency key');
    const intent = { workflow, startNodeId, resume: !!resume };
    const hash = crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (idempotencyKey) {
        const prior = db.prepare('SELECT * FROM flow_runs WHERE owner_id=? AND idempotency_key=?').get(user.id, idempotencyKey);
        if (prior) {
          if (prior.input_hash !== hash) throw invalid('Idempotency key reused with different input', 409, 'IDEMPOTENCY_CONFLICT');
          db.exec('COMMIT'); return prior;
        }
      }
      const queued = db.prepare("SELECT COUNT(*) AS n FROM flow_runs WHERE state='queued'").get().n;
      const own = db.prepare("SELECT COUNT(*) AS n FROM flow_runs WHERE state='queued' AND owner_id=?").get(user.id).n;
      if (queued >= maxQueued || own >= Math.max(1, Math.floor(maxQueued / 4))) throw invalid('Run queue is full', 429, 'QUEUE_FULL');
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO flow_runs(id,owner_id,idempotency_key,input_hash,intent,state,created_at,updated_at,request_id,correlation_id) VALUES (?,?,?,?,?,'queued',?,?,?,?)")
        .run(id, user.id, idempotencyKey, hash, encode(intent), now(), now(), requestId, correlationId || requestId);
      for (const node of workflow.nodes) db.prepare("INSERT INTO node_runs(run_id,node_id,effect_class,state) VALUES (?,?,?,'queued')").run(id, node.id, effectClass(node.type));
      for (const artifactId of artifactIds) db.prepare('INSERT INTO run_artifacts(run_id,artifact_id) VALUES(?,?)').run(id, artifactId);
      db.exec('COMMIT'); return get(id, user.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function recover() {
    const expired = db.prepare("SELECT * FROM flow_runs WHERE state='running' AND lease_until < ?").all(now());
    for (const row of expired) {
      const unsafe = db.prepare("SELECT 1 FROM node_runs WHERE run_id=? AND state='running' AND effect_class='external-side-effect'").get(row.id);
      const state = unsafe ? 'unknown' : row.cancel_requested ? 'cancelled' : 'queued';
      const changed = db.prepare('UPDATE flow_runs SET state=?, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=? AND state=\'running\' AND lease_until < ?').run(state, now(), row.id, now());
      if (changed.changes) {
        emit(row.id, 'reconciled', { state, reason: unsafe ? 'unsafe_attempt_outcome_unknown' : 'lease_expired' });
        if (state !== 'queued') emit(row.id, 'error', { success: false, state, error: unsafe ? 'Side effect outcome requires reconciliation' : 'Run cancelled' });
      }
    }
    return expired.length;
  }
  function claim() {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT COUNT(*) AS n FROM flow_runs WHERE state='running'").get().n >= maxActive) { db.exec('COMMIT'); return null; }
      const row = db.prepare(`SELECT r.* FROM flow_runs r WHERE r.state='queued' AND
        (SELECT COUNT(*) FROM flow_runs busy WHERE busy.state='running' AND busy.owner_id=r.owner_id) < ?
        ORDER BY r.created_at, r.id LIMIT 1`).get(maxPerOwner);
      if (row) db.prepare("UPDATE flow_runs SET state='running',lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND state='queued'").run(worker, now() + leaseMs, now(), row.id);
      db.exec('COMMIT'); return row;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function perform(row) {
    const controller = new AbortController();
    active.set(row.id, controller);
    const heartbeat = setInterval(() => {
      const current = db.prepare('SELECT cancel_requested,lease_owner,state FROM flow_runs WHERE id=?').get(row.id);
      if (!current || current.lease_owner !== worker || current.state !== 'running' || current.cancel_requested) controller.abort();
      else db.prepare("UPDATE flow_runs SET lease_until=? WHERE id=? AND lease_owner=? AND state='running'").run(now() + leaseMs, row.id, worker);
    }, Math.max(50, Math.floor(leaseMs / 3)));
    heartbeat.unref();
    try {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.owner_id);
      const intent = decode(row.intent); authorize(intent.workflow, user, db);
      require('./artifacts').assertReferences(intent.workflow, user.id);
      const checkpoints = db.prepare("SELECT node_id,checkpoint FROM node_runs WHERE run_id=? AND state='succeeded'").all(row.id);
      for (const checkpoint of checkpoints) {
        const node = intent.workflow.nodes.find(n => n.id === checkpoint.node_id);
        if (node) node.pinnedData = decode(checkpoint.checkpoint);
      }
      emit(row.id, 'runStarted', { requestId: row.request_id, correlationId: row.correlation_id });
      await execute(intent, user, (event, data) => {
        const lease = db.prepare('SELECT lease_owner,state FROM flow_runs WHERE id=?').get(row.id);
        if (lease?.lease_owner !== worker || lease.state !== 'running') { controller.abort(); throw new Error('Run lease lost'); }
        if (!['done', 'error'].includes(event)) emit(row.id, event, data);
      }, { signal: controller.signal, runId: row.id, requestId: row.request_id, correlationId: row.correlation_id });
      const state = controller.signal.aborted ? 'cancelled' : 'succeeded';
      const changed = db.prepare("UPDATE flow_runs SET state=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND state='running'").run(state, now(), row.id, worker);
      if (changed.changes) emit(row.id, state === 'succeeded' ? 'done' : 'error', { success: state === 'succeeded', state, ...(state === 'cancelled' ? { error: 'Run cancelled' } : {}) });
    } catch (error) {
      const unsafe = db.prepare("SELECT 1 FROM node_runs WHERE run_id=? AND state IN ('running','failed') AND effect_class='external-side-effect'").get(row.id);
      const state = unsafe ? 'unknown' : controller.signal.aborted ? 'cancelled' : 'failed';
      const changed = db.prepare("UPDATE flow_runs SET state=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND state='running'").run(state, now(), row.id, worker);
      if (changed.changes) emit(row.id, 'error', { success: false, state, error: error.message });
    } finally { clearInterval(heartbeat); active.delete(row.id); }
  }
  async function tick() {
    if (stopped) return;
    recover();
    let row;
    while (active.size < maxActive && (row = claim())) void perform(row);
  }
  function start() {
    stopped = false;
    if (timer) return;
    const poll = () => {
      if (stopped) return;
      tick().catch(error => console.error(JSON.stringify({ level: 'error', action: 'run.poll_failed', code: error.code || 'RUN_POLL_FAILED' })));
      timer = setTimeout(poll, 250); timer.unref();
    };
    poll();
  }
  async function stop(timeoutMs = 10000) {
    stopped = true; clearTimeout(timer); timer = null;
    const deadline = Date.now() + timeoutMs;
    while (active.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    for (const controller of active.values()) controller.abort();
    return active.size === 0;
  }
  function cancel(id, owner) {
    const prior = get(id, owner);
    db.prepare("UPDATE flow_runs SET cancel_requested=1, state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, updated_at=? WHERE id=? AND state IN ('queued','running')").run(now(), id);
    active.get(id)?.abort();
    if (prior.state === 'queued') emit(id, 'error', { success: false, state: 'cancelled', error: 'Run cancelled' });
    return get(id, owner);
  }
  function events(id, owner, after = 0) {
    get(id, owner);
    return db.prepare('SELECT * FROM run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 1000').all(id, after).map(row => ({ seq: row.seq, event: row.event, data: decode(row.data) }));
  }
  function subscribe(id, fn) {
    if (!listeners.has(id)) listeners.set(id, new Set()); listeners.get(id).add(fn);
    return () => { listeners.get(id)?.delete(fn); if (!listeners.get(id)?.size) listeners.delete(id); };
  }
  return { submit, get, recover, tick, start, stop, cancel, events, subscribe, emit };
}
module.exports = { createRunService };
