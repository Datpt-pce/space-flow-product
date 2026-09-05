// Video Editor Phase 2 (specs/space-flow-master-plan/04-video-editor.md §5): proves
// importAsset()/relinkAsset() against real ffmpeg/ffprobe + real fixture files (ref-item/1.mp4,
// ref-item/2.mp4), exercising the exact runVideoJob() path the route uses in SPACE_FLOW_MODE=agent
// (this dev server IS the agent) — not mocked, matching backend/video/assetService.test.js's
// convention. Calls importAsset()/relinkAsset() directly (not through Express/auth), same as
// backend/routes/video-projects.test.js does for recoverProjectState().
//
// Run with: node backend/routes/video-assets.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const { runVideoJob } = require('../agent/videoJobs');
const { importAsset, relinkAsset, deleteAsset, detectKind } = require('./video-assets');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIP_1 = path.join(REPO_ROOT, 'ref-item', '1.mp4');
const CLIP_2 = path.join(REPO_ROOT, 'ref-item', '2.mp4');
const runJob = (kind, payload) => runVideoJob(kind, payload, () => {});

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

async function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `video-assets-test-sub-${ownerId}`, `video-assets-test-${ownerId}@space-flow.local`, 'Video Assets Test User', 'member');

  const assetIds = [];
  const projectIds = [];
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-video-assets-test-'));

  try {
    check('detectKind: routes by extension into video/audio/image, unknown extension returns null', () => {
      assert.strictEqual(detectKind('C:/x/clip.MP4'), 'video');
      assert.strictEqual(detectKind('C:/x/song.mp3'), 'audio');
      assert.strictEqual(detectKind('C:/x/photo.png'), 'image');
      assert.strictEqual(detectKind('C:/x/doc.txt'), null);
    });

    await check('importAsset: video → status ok, real probed metadata, real thumbnail + proxy files on disk', async () => {
      const row = await importAsset(ownerId, CLIP_1, runJob, { skipPreflight: false });
      assetIds.push(row.id);
      assert.strictEqual(row.status, 'ok');
      assert.strictEqual(row.error_message, null);
      assert.strictEqual(row.kind, 'video');
      assert.match(row.content_hash, /^[0-9a-f]{64}$/);
      assert.ok(row.duration_ms > 0, `expected duration_ms > 0, got ${row.duration_ms}`);
      assert.ok(row.width > 0 && row.height > 0);
      assert.ok(fs.existsSync(row.thumbnail_path), 'expected a real thumbnail file on disk');
      assert.ok(fs.existsSync(row.proxy_path), 'expected a real proxy file on disk');
    });

    await check('importAsset: same source file twice → same content_hash both times (stable, not import-order-dependent)', async () => {
      const rowA = await importAsset(ownerId, CLIP_1, runJob);
      const rowB = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(rowA.id, rowB.id);
      assert.strictEqual(rowA.content_hash, rowB.content_hash);
    });

    await check('importAsset: unrecognized extension throws before any row is created', async () => {
      const before = db.prepare('SELECT COUNT(*) AS n FROM video_assets WHERE owner_id = ?').get(ownerId).n;
      await assert.rejects(() => importAsset(ownerId, 'C:/x/notes.txt', runJob), /Không nhận diện được loại file/);
      const after = db.prepare('SELECT COUNT(*) AS n FROM video_assets WHERE owner_id = ?').get(ownerId).n;
      assert.strictEqual(after, before, 'expected no new row for an unrecognized extension');
    });

    await check('importAsset: job failure (bad path) is recorded as status error on the row, not thrown', async () => {
      const missingPath = path.join(scratchDir, 'does-not-exist.mp4');
      const row = await importAsset(ownerId, missingPath, runJob, { skipPreflight: true });
      assetIds.push(row.id);
      assert.strictEqual(row.status, 'error');
      assert.ok(row.error_message && row.error_message.length > 0);
    });

    await check('relinkAsset: hash matches (same content, moved/renamed) → status back to ok, source_path updated, asset id unchanged', async () => {
      const original = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(original.id);
      const movedPath = path.join(scratchDir, 'clip-1-renamed.mp4');
      fs.copyFileSync(CLIP_1, movedPath);
      db.prepare("UPDATE video_assets SET status = 'offline' WHERE id = ?").run(original.id);

      const result = await relinkAsset(original.id, ownerId, movedPath, runJob);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.row.id, original.id, 'relink must never change the asset id');
      assert.strictEqual(result.row.status, 'ok');
      assert.strictEqual(result.row.source_path, movedPath);
      assert.strictEqual(result.row.content_hash, original.content_hash);
    });

    await check('relinkAsset: hash mismatch (different content) → rejected 409, row left untouched', async () => {
      const original = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(original.id);
      db.prepare("UPDATE video_assets SET status = 'offline' WHERE id = ?").run(original.id);

      const result = await relinkAsset(original.id, ownerId, CLIP_2, runJob);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 409);

      const row = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(original.id);
      assert.strictEqual(row.status, 'offline', 'a rejected relink must not silently mark the asset ok');
      assert.strictEqual(row.source_path, CLIP_1);
    });

    await check('relinkAsset: wrong owner → rejected 403', async () => {
      const original = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(original.id);
      const otherUserId = crypto.randomUUID();

      const result = await relinkAsset(original.id, otherUserId, CLIP_1, runJob);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 403);
    });

    // 08-C C5 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md) — deleteAsset().
    await check('deleteAsset: an unreferenced asset can be deleted, DB row and cache dir both removed', async () => {
      const row = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(row.id);
      const cacheDir = path.dirname(row.thumbnail_path);
      assert.ok(fs.existsSync(cacheDir), 'expected the thumbnail/proxy cache dir to exist before delete');

      const result = await deleteAsset(row.id, ownerId, runJob);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(db.prepare('SELECT * FROM video_assets WHERE id = ?').get(row.id), undefined);
      assert.ok(!fs.existsSync(cacheDir), 'expected the cache dir to be removed by the delete-cache job');
    });

    await check('deleteAsset: an asset referenced by a project\'s CURRENT clips is rejected 409, row left untouched', async () => {
      const row = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(row.id);

      const projectId = crypto.randomUUID();
      const clip = { id: 'clip-1', assetId: row.id, sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] };
      const payload = {
        schemaVersion: 1, resolution: { width: 1920, height: 1080 }, fps: 30, colorSpace: 'sRGB', audioRate: 48000,
        sequence: { markers: [] }, transitions: [],
        tracks: [{ id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [clip] }],
      };
      const payloadJson = JSON.stringify(payload);
      db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)').run(projectId, ownerId, 'Uses Asset', payloadJson);
      db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)').run(crypto.randomUUID(), projectId, payloadJson);
      projectIds.push(projectId);

      const result = await deleteAsset(row.id, ownerId, runJob);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.referencingProjects.length, 1);
      assert.strictEqual(result.referencingProjects[0].id, projectId);
      assert.ok(db.prepare('SELECT * FROM video_assets WHERE id = ?').get(row.id), 'asset row must still exist after a rejected delete');
    });

    await check('deleteAsset: wrong owner → rejected 403, row left untouched', async () => {
      const row = await importAsset(ownerId, CLIP_1, runJob);
      assetIds.push(row.id);
      const otherUserId = crypto.randomUUID();

      const result = await deleteAsset(row.id, otherUserId, runJob);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 403);
      assert.ok(db.prepare('SELECT * FROM video_assets WHERE id = ?').get(row.id));
    });

    await check('deleteAsset: nonexistent asset → rejected 404', async () => {
      const result = await deleteAsset(crypto.randomUUID(), ownerId, runJob);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 404);
    });
  } finally {
    for (const id of projectIds) db.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
    for (const id of assetIds) db.prepare('DELETE FROM video_assets WHERE id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL — unexpected error:', err.stack);
  process.exitCode = 1;
});
