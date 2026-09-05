// A real child-process crash after durable lease acquisition, followed by a fresh
// process rendering the same pinned job; no application database is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const mode = process.argv[2];
if (mode) {
  const db = new DatabaseSync(process.argv[3]);
  require.cache[require.resolve('../db')] = { exports: db };
  const job = db.prepare('SELECT * FROM video_render_jobs LIMIT 1').get();
  if (mode === 'crash') {
    const token = require('./renderLifecycle').createRenderLifecycle(db).claim(job.id);
    const dir = path.resolve(__dirname, '../uploads/video-renders', job.id, token);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'output.partial.mp4'), 'interrupted bytes');
    process.send({ token });
    setInterval(() => {}, 1000);
  } else {
    const life = require('./renderLifecycle').createRenderLifecycle(db);
    assert.equal(life.recoverExpired(), 1);
    require('../routes/video-render').runRenderJobAsync(job.id, job.project_id, job.owner_id)
      .then(() => { db.close(); process.disconnect(); });
  }
} else {
  (async () => {
    const root = fs.mkdtempSync(path.resolve(__dirname, '../../logs/render-restart-'));
    const dbPath = path.join(root, 'test.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner')");
    require('./schema').ensureVideoSchema(db);
    const jobId = crypto.randomUUID();
    const out = path.resolve(__dirname, '../uploads/video-renders', jobId);
    let child;
    try {
      const state = { schemaVersion: 1, resolution: { width: 160, height: 284 }, fps: 24, audioRate: 48000,
        tracks: [{ id: 'v', type: 'video', order: 0, visible: true, clips: [{ id: 'c', assetId: 'a', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1 }] }], transitions: [] };
      db.prepare('INSERT INTO video_projects(id,owner_id,name,payload) VALUES (?,?,?,?)').run('p', 'owner', 'Crash proof', JSON.stringify(state));
      db.prepare('INSERT INTO video_project_snapshots(id,project_id,seq,payload) VALUES (?,?,0,?)').run('s', 'p', JSON.stringify(state));
      db.prepare('INSERT INTO video_assets(id,owner_id,source_path,kind,status) VALUES (?,?,?,?,?)').run('a', 'owner', path.resolve(__dirname, '../../ref-item/1.mp4'), 'video', 'ok');
      db.prepare('UPDATE video_assets SET content_hash = ? WHERE id = ?').run(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../ref-item/1.mp4'))).digest('hex'), 'a');
      db.prepare('INSERT INTO video_render_jobs(id,project_id,owner_id,pinned_seq) VALUES (?,?,?,0)').run(jobId, 'p', 'owner');
      const start = (operation) => spawn(process.execPath, [__filename, operation, dbPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, SPACE_FLOW_MODE: 'agent' } });
      child = start('crash');
      const [{ token }] = await once(child, 'message');
      const exited = once(child, 'exit'); child.kill(); await exited;
      assert.equal(db.prepare('SELECT status FROM video_render_jobs').get().status, 'running');
      // Advance the persisted expiry instead of sleeping 45 seconds. Recovery itself
      // still runs in a newly started process with a newly opened disk database.
      db.exec('UPDATE video_render_jobs SET lease_until = 0');
      child = start('recover');
      let errors = ''; child.stderr.on('data', data => { errors += data; });
      const [code] = await once(child, 'exit'); assert.equal(code, 0, errors);
      const result = db.prepare('SELECT * FROM video_render_jobs').get();
      assert.equal(result.status, 'done', result.error_message);
      assert.equal(result.attempt_count, 2);
      assert.notEqual(result.attempt_token, token);
      assert.equal(JSON.parse(result.manifest_json).pinnedSeq, 0);
      assert.ok(result.output_path.endsWith('output.mp4'));
      assert.equal(JSON.parse(result.manifest_json).outputHash, await require('./assetService').hashFile(result.output_path));
      assert.equal(fs.readFileSync(path.join(out, token, 'output.partial.mp4'), 'utf8'), 'interrupted bytes');
      console.log('PASS actual process kill/restart, durable pin/attempt fencing, isolated interrupted output, real FFmpeg recovery');
    } finally {
      if (child?.exitCode === null) child.kill(); db.close();
      assert.equal(path.dirname(root), path.resolve(__dirname, '../../logs'));
      assert.equal(path.dirname(out), path.resolve(__dirname, '../uploads/video-renders'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      fs.rmSync(out, { recursive: true, force: true, maxRetries: 3 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
