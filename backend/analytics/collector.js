const { dayOf, union, splitDays } = require('./math');
const FEATURES = ['canvas', 'video', 'batch', 'sheet', 'graph', 'assistant', 'admin'];
const ACTIONS = ['session_started', 'feature_opened', 'page_reload', 'node_added', 'node_deleted', 'node_config_committed',
  'connection_added', 'connection_rejected', 'undo', 'redo', 'run_clicked', 'cancel_clicked', 'data_refresh_clicked',
  'agent_update_requested', 'command_requested', 'command_completed', 'command_failed', 'output_downloaded', 'repeat_action'];
const COMMANDS = ['prepare', 'generate', 'render', 'delivery', 'import', 'export', 'sync', 'save', 'preview', 'update'];
const CLOCKS = ['visible', 'focused', 'pointer', 'engaged', 'viewing', 'waiting'];
const fail = () => { throw Object.assign(new Error('Invalid analytics event'), { status: 400 }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function validate(body, now) {
  if (!plain(body) || Object.keys(body).some(k => k !== 'events') || !Array.isArray(body.events) || !body.events.length || body.events.length > 50) fail();
  if (Buffer.byteLength(JSON.stringify(body)) > 32768) throw Object.assign(new Error('Analytics batch too large'), { status: 413 });
  for (const e of body.events) {
    if (!plain(e) || Object.keys(e).some(k => !['id','at','name','feature','sessionId','nodeType','props'].includes(k)) ||
      !id(e.id) || !id(e.sessionId) || !FEATURES.includes(e.feature) || !Number.isSafeInteger(e.at) ||
      e.at < now - 86400000 || e.at > now + 120000 || (e.nodeType !== undefined && !id(e.nodeType)) || !plain(e.props)) fail();
    const p = e.props;
    if (e.name === 'presence') {
      if (Object.keys(p).some(k => !['start','end',...CLOCKS].includes(k)) || !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) ||
        p.start < now - 86400000 || p.end > now + 120000 || p.end > e.at || p.end <= p.start || p.end - p.start > 20000 ||
        CLOCKS.some(k => typeof p[k] !== 'boolean') || (p.focused && !p.visible) ||
        (p.engaged && !p.focused) || (p.pointer && !p.focused) || (p.waiting && !p.focused) || (p.viewing && !p.focused)) fail();
    } else if (e.name === 'performance') {
      if (Object.keys(p).some(k => !['heapBytes','longTaskMs','interactionMs','frameMs','samples','dropped'].includes(k)) ||
        Object.values(p).some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > 2 ** 40))) fail();
    } else {
      if (!ACTIONS.includes(e.name) || Object.keys(p).some(k => !['command','durationMs','target','runKey'].includes(k)) ||
        (p.command !== undefined && !COMMANDS.includes(p.command)) || (p.target !== undefined && !id(p.target)) ||
        (p.runKey !== undefined && !id(p.runKey)) || (p.durationMs !== undefined && (!Number.isFinite(p.durationMs) || p.durationMs < 0 || p.durationMs > 86400000))) fail();
    }
  }
  return body.events;
}
function createCollector(db, now = Date.now) {
  const insert = db.prepare('INSERT OR IGNORE INTO analytics_events VALUES (?,?,?,?,?,?,?,?,?)');
  const get = db.prepare('SELECT * FROM analytics_daily WHERE day=? AND owner_id=? AND feature=?');
  const put = db.prepare(`INSERT INTO analytics_daily VALUES (?,?,?,?,?,?,?) ON CONFLICT(day,owner_id,feature)
    DO UPDATE SET actions=excluded.actions,spans=excluded.spans,sessions=excluded.sessions,last_at=MAX(last_at,excluded.last_at)`);
  function daily(owner, e) {
    const parts = e.name === 'presence' ? splitDays(e.props.start, e.props.end) : [[dayOf(e.at), e.at, e.at]];
    for (const [day, start, end] of parts) {
      const row = get.get(day, owner, e.feature);
      const actions = JSON.parse(row?.actions || '{}'), spans = JSON.parse(row?.spans || '{}'), sessions = JSON.parse(row?.sessions || '[]');
      if (e.name === 'presence') {
        for (const clock of CLOCKS) if (e.props[clock]) spans[clock] = union([...(spans[clock] || []), [start, end]]);
      } else if (e.name !== 'performance') {
        actions[e.name] = (actions[e.name] || 0) + 1;
        if (e.props.command) actions[`${e.name}:${e.props.command}`] = (actions[`${e.name}:${e.props.command}`] || 0) + 1;
        // Session/open/reload alone is not an active user: these may follow automated restoration.
        const human = !['session_started','feature_opened','page_reload','command_completed','command_failed'].includes(e.name);
        if (human) actions.human = (actions.human || 0) + 1;
        if (human && !sessions.includes(e.sessionId) && sessions.length < 1000) sessions.push(e.sessionId);
      }
      put.run(day, owner, e.feature, JSON.stringify(actions), JSON.stringify(spans), JSON.stringify(sessions), e.at);
    }
  }
  function ingest(owner, body) {
    const events = validate(body, now()); let accepted = 0;
    db.exec('SAVEPOINT analytics_ingest');
    try {
      for (const e of events) {
        if (insert.run(owner, e.id, e.at, now(), e.feature, e.name, e.sessionId, e.nodeType || null, JSON.stringify(e.props)).changes) {
          daily(owner, e); accepted++;
        }
      }
      db.exec('RELEASE analytics_ingest');
    } catch (error) { db.exec('ROLLBACK TO analytics_ingest; RELEASE analytics_ingest'); throw error; }
    return { accepted, duplicates: events.length - accepted };
  }
  return { ingest };
}
module.exports = { createCollector, validate, FEATURES, ACTIONS, COMMANDS, CLOCKS };
