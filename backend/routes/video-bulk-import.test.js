// 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md): BulkTimelineImportOperation — proves the
// real per-target command path (shared/video-commands/BulkInsertClips.js via applyCommand(), same
// as a manual edit — acceptance §6 "Manual edit và bulk operation dùng cùng invariants/command
// path"), zone-based new-track creation, operation-level idempotency (08-D's existing per-command
// idempotency key, reused rather than inventing a second mechanism), and retry-only-failed-targets.
//
// Run with: node backend/routes/video-bulk-import.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const { recoverProjectState } = require('./video-projects');
const {
  planBulkInsertForTimeline, previewBulkImport, createBulkImportOperation, getBulkImportOperation, retryBulkImportOperation,
} = require('./video-bulk-import');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

const baseState = () => ({
  schemaVersion: 1, resolution: { width: 1920, height: 1080 }, fps: 30, colorSpace: 'sRGB', audioRate: 48000,
  sequence: { markers: [] },
  tracks: [{ id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [] }],
  transitions: [],
});

function makeProject(ownerId, initialState, { withSnapshot = true } = {}) {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(initialState);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)')
    .run(id, ownerId, 'Bulk Import Test Target', payloadJson);
  // withSnapshot:false deliberately leaves this project with NO video_project_snapshots row — a
  // stand-in for a genuinely broken/inconsistent target, used below to exercise the
  // completed_with_errors / retry path deterministically without needing real concurrency.
  if (withSnapshot) {
    db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
      .run(crypto.randomUUID(), id, payloadJson);
  }
  return id;
}

function makeAsset(ownerId, { kind = 'video', durationMs = 4000, status = 'ok' } = {}) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO video_assets (id, owner_id, source_path, kind, status, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, `${kind}.file`, kind, status, kind === 'image' ? null : durationMs);
  return id;
}

function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `video-bulk-import-test-sub-${ownerId}`, `video-bulk-import-test-${ownerId}@space-flow.local`, 'Bulk Import Test User', 'member');

  try {
    check('planBulkInsertForTimeline: video appends to the existing visual track, audio creates a new track', () => {
      const state = baseState();
      state.tracks[0].clips.push({ id: 'existing', assetId: 'a0', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] });
      const assets = [
        { id: 'v1', kind: 'video', duration_ms: 3000 },
        { id: 'a1', kind: 'audio', duration_ms: 1000 },
      ];
      const { newTracks, insertions, placements } = planBulkInsertForTimeline(state, assets, {});
      assert.strictEqual(newTracks.length, 1); // only the audio track is new
      assert.strictEqual(newTracks[0].type, 'audio');
      assert.strictEqual(insertions.length, 2);
      const videoInsertion = insertions.find((i) => i.clip.assetId === 'v1');
      assert.strictEqual(videoInsertion.trackId, 'track-v1');
      assert.strictEqual(videoInsertion.clip.timelineInMs, 2000); // appended after the existing clip
      assert.strictEqual(placements.find((p) => p.assetId === 'v1').isNewTrack, false);
      assert.strictEqual(placements.find((p) => p.assetId === 'a1').isNewTrack, true);
    });

    check('planBulkInsertForTimeline: an image asset uses options.imageDurationMs, sequential clips do not overlap', () => {
      const state = baseState();
      const assets = [
        { id: 'i1', kind: 'image' },
        { id: 'i2', kind: 'image' },
      ];
      const { insertions } = planBulkInsertForTimeline(state, assets, { imageDurationMs: 2500 });
      assert.strictEqual(insertions[0].clip.timelineInMs, 0);
      assert.strictEqual(insertions[0].clip.timelineOutMs, 2500);
      assert.strictEqual(insertions[1].clip.timelineInMs, 2500);
      assert.strictEqual(insertions[1].clip.timelineOutMs, 5000);
    });

    check('planBulkInsertForTimeline: a locked visual track is skipped in favor of a fresh one', () => {
      const state = baseState();
      state.tracks[0].locked = true;
      const { newTracks, insertions } = planBulkInsertForTimeline(state, [{ id: 'v1', kind: 'video', duration_ms: 1000 }], {});
      assert.strictEqual(newTracks.length, 1);
      assert.notStrictEqual(insertions[0].trackId, 'track-v1');
    });

    check('createBulkImportOperation: 3 timelines all succeed -> completed, each gets its own command transaction under the same operation id', () => {
      const t1 = makeProject(ownerId, baseState());
      const t2 = makeProject(ownerId, baseState());
      const t3 = makeProject(ownerId, baseState());
      const asset = makeAsset(ownerId, { kind: 'video', durationMs: 4000 });

      const op = createBulkImportOperation(ownerId, { timelineIds: [t1, t2, t3], orderedAssetIds: [asset], options: {} });
      assert.strictEqual(op.status, 'completed');
      assert.strictEqual(op.results.length, 3);
      assert.ok(op.results.every((r) => r.status === 'success'));

      for (const t of [t1, t2, t3]) {
        const state = recoverProjectState(t);
        assert.strictEqual(state.tracks[0].clips.length, 1);
        assert.strictEqual(state.tracks[0].clips[0].assetId, asset);
      }
    });

    check('createBulkImportOperation: idempotencyKey replay does not duplicate the insert', () => {
      const t1 = makeProject(ownerId, baseState());
      const asset = makeAsset(ownerId, { kind: 'video', durationMs: 2000 });
      const idempotencyKey = crypto.randomUUID();

      const op1 = createBulkImportOperation(ownerId, { timelineIds: [t1], orderedAssetIds: [asset], options: {}, idempotencyKey });
      const op2 = createBulkImportOperation(ownerId, { timelineIds: [t1], orderedAssetIds: [asset], options: {}, idempotencyKey });
      assert.deepStrictEqual(op1, op2);

      const state = recoverProjectState(t1);
      assert.strictEqual(state.tracks[0].clips.length, 1); // not 2
    });

    check('createBulkImportOperation + retry: a broken target fails without touching the healthy ones, retry fixes only the failed target and leaves the succeeded one untouched', () => {
      const healthy = makeProject(ownerId, baseState());
      const broken = makeProject(ownerId, baseState(), { withSnapshot: false }); // recoverProjectState() will throw for this one
      const asset = makeAsset(ownerId, { kind: 'video', durationMs: 1500 });

      const op = createBulkImportOperation(ownerId, { timelineIds: [healthy, broken], orderedAssetIds: [asset], options: {} });
      assert.strictEqual(op.status, 'completed_with_errors');
      const healthyResult = op.results.find((r) => r.timelineId === healthy);
      const brokenResult = op.results.find((r) => r.timelineId === broken);
      assert.strictEqual(healthyResult.status, 'success');
      assert.strictEqual(brokenResult.status, 'error');
      assert.strictEqual(recoverProjectState(healthy).tracks[0].clips.length, 1);

      // "Fix" the broken target the same way a real recovery would (give it back its seq=0 anchor),
      // then retry — only `broken` should change.
      db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
        .run(crypto.randomUUID(), broken, JSON.stringify(baseState()));

      const retried = retryBulkImportOperation(ownerId, op.id);
      assert.strictEqual(retried.status, 'completed');
      assert.strictEqual(recoverProjectState(broken).tracks[0].clips.length, 1);
      assert.strictEqual(recoverProjectState(healthy).tracks[0].clips.length, 1); // still 1, retry did not re-touch it

      const fetched = getBulkImportOperation(ownerId, op.id);
      assert.deepStrictEqual(fetched, retried);
    });

    check('previewBulkImport: read-only, never touches any timeline state', () => {
      const t1 = makeProject(ownerId, baseState());
      const asset = makeAsset(ownerId, { kind: 'audio', durationMs: 1000 });
      const before = recoverProjectState(t1);
      const preview = previewBulkImport(ownerId, { timelineIds: [t1], orderedAssetIds: [asset], options: {} });
      assert.strictEqual(preview.targets.length, 1);
      assert.strictEqual(preview.targets[0].placements[0].isNewTrack, true);
      assert.deepStrictEqual(recoverProjectState(t1), before);
    });

    check('createBulkImportOperation: rejects an asset the owner does not own before touching any timeline', () => {
      const t1 = makeProject(ownerId, baseState());
      const otherOwnerId = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
        .run(otherOwnerId, `video-bulk-import-test-sub-other-${otherOwnerId}`, `video-bulk-import-test-other-${otherOwnerId}@space-flow.local`, 'Other Owner', 'member');
      const foreignAsset = makeAsset(otherOwnerId, { kind: 'video' });

      assert.throws(() => createBulkImportOperation(ownerId, { timelineIds: [t1], orderedAssetIds: [foreignAsset], options: {} }), /Không có quyền dùng asset/);
      assert.strictEqual(recoverProjectState(t1).tracks[0].clips.length, 0);
    });
  } finally {
    console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
    if (fail) process.exitCode = 1;
  }
}

main();
