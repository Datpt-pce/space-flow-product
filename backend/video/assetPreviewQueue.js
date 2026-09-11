const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The DB preserves pending work across restarts. One process executes at most
// two previews, and at most one per owner, independently of source readiness.
function createAssetPreviewQueue(db, uploadsDir) {
  const tasks = new Map(), waiting = [], owners = new Set();
  let active = 0;
  const current = row => db.prepare("SELECT * FROM video_assets WHERE id=? AND owner_id=? AND content_hash=? AND source_path=? AND status='ok'")
    .get(row.id, row.owner_id, row.content_hash, row.source_path);

  async function generate(row, runJob) {
    const token = crypto.randomUUID();
    const dir = path.join(uploadsDir, 'video-assets', row.id);
    const thumbnail = path.join(dir, `thumb-${token}.jpg`);
    const proxy = path.join(dir, `proxy-${token}.mp4`);
    let thumbnailPublished = false, proxyPublished = false;
    try {
      if (!current(row)) return;
      db.prepare("UPDATE video_assets SET preview_status='running', preview_progress=0, preview_error=NULL WHERE id=?").run(row.id);
      await runJob('thumbnail', { path: row.source_path, outPath: thumbnail, atSeconds: row.duration_ms ? Math.min(1, row.duration_ms / 2000) : 0 });
      if (!current(row)) return;
      db.prepare('UPDATE video_assets SET thumbnail_path=? WHERE id=?').run(thumbnail, row.id);
      thumbnailPublished = true;
      await runJob('proxy', { path: row.source_path, outPath: proxy, gopSeconds: 0.5, fps: row.fps || 30, durationMs: row.duration_ms, maxDimension: 1280 }, percent => {
        if (Number.isFinite(percent) && current(row)) db.prepare('UPDATE video_assets SET preview_progress=? WHERE id=?')
          .run(Math.max(0, Math.min(99, Math.floor(percent))), row.id);
      });
      if (!current(row)) return;
      db.prepare("UPDATE video_assets SET proxy_path=?, preview_status='done', preview_progress=100, preview_error=NULL WHERE id=?").run(proxy, row.id);
      proxyPublished = true;
    } catch (error) {
      if (current(row)) db.prepare("UPDATE video_assets SET preview_status='error', preview_error=? WHERE id=?").run(error.message, row.id);
    } finally {
      // Only this attempt's cache files; the original is never changed.
      if (!proxyPublished) fs.rmSync(proxy, { force: true });
      if (!thumbnailPublished || !current(row)) fs.rmSync(thumbnail, { force: true });
    }
  }

  function pump() {
    while (active < 2) {
      const index = waiting.findIndex(task => !owners.has(task.row.owner_id));
      if (index < 0) return;
      const task = waiting.splice(index, 1)[0];
      active++; owners.add(task.row.owner_id);
      generate(task.row, task.runJob).catch(error => console.error('[asset-preview]', error.message)).finally(() => {
        active--; owners.delete(task.row.owner_id); tasks.delete(task.row.id);
        task.resolve(); pump();
      });
    }
  }

  function enqueue(row, runJob) {
    if (tasks.has(row.id)) return tasks.get(row.id).promise;
    // A listing can finish after a job. Re-read before claiming work so its older
    // running snapshot cannot requeue an already completed preview.
    const requestedState = row.preview_status;
    row = db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(row.id, row.owner_id);
    if (!row || row.kind !== 'video' || row.status !== 'ok' || row.preview_status === 'done') return Promise.resolve();
    if (row.preview_status === 'error' && requestedState !== 'error') return Promise.resolve();
    db.prepare("UPDATE video_assets SET preview_status='queued', preview_progress=0, preview_error=NULL WHERE id=? AND owner_id=?").run(row.id, row.owner_id);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const task = { row, runJob, promise, resolve };
    tasks.set(row.id, task); waiting.push(task);
    setImmediate(pump);
    return promise;
  }

  return { enqueue, pending: id => tasks.get(id)?.promise };
}

module.exports = { createAssetPreviewQueue };
