// Video Editor Phase 1 (specs/space-flow-master-plan/04-video-editor.md): proves
// recoverProjectState()'s crash-recovery property directly against the DB — "kill server giữa
// lúc ghi command log → replay log+snapshot khôi phục đúng state cuối." Deliberately corrupts
// video_projects.payload (simulating a crash between inserting a command row and updating that
// cache column) and asserts recoverProjectState() still returns the CORRECT state — proving it
// never actually depends on that column, not just that a real crash happens to not occur in this
// test run.
//
// Run with: node backend/routes/video-projects.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../db');
const {
  recoverProjectState, batchCreateFromVideos, getTimelineCollectionProjection, applyCommand,
  archiveProject, restoreProject, permanentlyDeleteProject,
} = require('./video-projects');

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

function makeProject(ownerId, initialState) {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(initialState);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)')
    .run(id, ownerId, 'Test Project', payloadJson);
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
    .run(crypto.randomUUID(), id, payloadJson);
  return id;
}

function insertCommand(projectId, seq, type, args) {
  db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), projectId, seq, type, JSON.stringify(args));
}

function insertSnapshot(projectId, seq, state) {
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), projectId, seq, JSON.stringify(state));
}

// 08.2.4: a ready-to-use video_assets row for batchCreateFromVideos() preflight — `sourcePath`
// controls the basename batchCreateFromVideos() uses for one-video-one-timeline naming.
function makeVideoAsset(ownerId, { sourcePath = 'clip.mp4', durationMs = 5000, status = 'ok' } = {}) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO video_assets (id, owner_id, source_path, kind, status, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, sourcePath, 'video', status, status === 'ok' ? durationMs : null);
  return id;
}

const baseState = () => ({
  schemaVersion: 1, resolution: { width: 1920, height: 1080 }, fps: 30, colorSpace: 'sRGB', audioRate: 48000,
  sequence: { markers: [] },
  tracks: [{ id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [] }],
  transitions: [],
});

function main() {
  const ownerId = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, `video-projects-test-sub-${ownerId}`, `video-projects-test-${ownerId}@space-flow.local`, 'Video Test User', 'member');

  const projectIds = [];
  const assetIds = [];
  const collectionIds = [];
  const renderJobIds = [];
  try {
    check('recoverProjectState(): replays commands after seq=0 with no other snapshot yet', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });

      const state = recoverProjectState(projectId);
      assert.strictEqual(state.tracks[0].clips.length, 1);
      assert.strictEqual(state.tracks[0].clips[0].id, 'clip-1');
    });

    check('recoverProjectState(): jumps straight to the latest snapshot instead of replaying the whole history', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clipA = { id: 'clip-a', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] };
      const clipB = { id: 'clip-b', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 1000, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip: clipA });

      const stateAfterA = require('../../shared/video-commands').runCommand(baseState(), 'InsertClip', { trackId: 'track-v1', index: 0, clip: clipA });
      insertSnapshot(projectId, 1, stateAfterA);
      // A command logged BEFORE the snapshot (seq 0->1, already folded into the snapshot) would
      // break correctness if recoverProjectState() double-applied it — this proves it doesn't,
      // by only having commands AFTER seq=1 for it to replay.
      insertCommand(projectId, 2, 'InsertClip', { trackId: 'track-v1', index: 1, clip: clipB });

      const state = recoverProjectState(projectId);
      assert.strictEqual(state.tracks[0].clips.length, 2);
      assert.deepStrictEqual(state.tracks[0].clips.map((c) => c.id), ['clip-a', 'clip-b']);
    });

    check('recoverProjectState(): CORRECT even when video_projects.payload is corrupted/stale — never trusted for reads', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });

      // Simulate a crash between "command row inserted" and "payload cache column updated" —
      // this is exactly the window a real crash could land in, deliberately forced here instead
      // of hoping to catch it happening for real.
      db.prepare('UPDATE video_projects SET payload = ? WHERE id = ?')
        .run(JSON.stringify({ corrupted: true, this: 'should never be read' }), projectId);

      const state = recoverProjectState(projectId);
      assert.strictEqual(state.corrupted, undefined, 'recoverProjectState() read the corrupted payload column instead of reconstructing from the log');
      assert.strictEqual(state.tracks[0].clips.length, 1);
      assert.strictEqual(state.tracks[0].clips[0].id, 'clip-1');
    });

    // 08-B B2/B3 (ADR 0030): getTimelineCollectionProjection() — legacy adapter shape.
    check('getTimelineCollectionProjection(): wraps a fresh project as a single-timeline legacy collection', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);

      const projection = getTimelineCollectionProjection(projectId);
      assert.deepStrictEqual(projection.collection.timelineIds, [projectId]);
      assert.strictEqual(projection.collection.activeTimelineId, projectId);
      assert.strictEqual(projection.timeline.id, projectId);
      assert.strictEqual(projection.timeline.collectionId, projection.collection.id);
      assert.strictEqual(projection.version.timelineId, projectId);
      assert.strictEqual(projection.version.parentVersionId, null, 'a project with no commands yet has no parent version');
      assert.strictEqual(projection.version.documentRef.schemaVersion, 1);
    });

    check('getTimelineCollectionProjection(): deterministic — same seq state produces the same version id across calls', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);

      const a = getTimelineCollectionProjection(projectId);
      const b = getTimelineCollectionProjection(projectId);
      assert.strictEqual(a.version.id, b.version.id);
      assert.deepStrictEqual(a.version.documentRef, b.version.documentRef);
    });

    check('getTimelineCollectionProjection(): version id advances and chains parentVersionId after a new command', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const before = getTimelineCollectionProjection(projectId);

      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });

      const after = getTimelineCollectionProjection(projectId);
      assert.notStrictEqual(after.version.id, before.version.id);
      assert.strictEqual(after.version.parentVersionId, before.version.id, 'the new version must chain back to the previous one');
      assert.strictEqual(after.version.documentRef.tracks[0].clips.length, 1);
    });

    check('getTimelineCollectionProjection(): inherits recoverProjectState()\'s recovery guarantee — ignores a corrupted payload cache column', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });
      db.prepare('UPDATE video_projects SET payload = ? WHERE id = ?')
        .run(JSON.stringify({ corrupted: true }), projectId);

      const projection = getTimelineCollectionProjection(projectId);
      assert.strictEqual(projection.version.documentRef.corrupted, undefined);
      assert.strictEqual(projection.version.documentRef.tracks[0].clips[0].id, 'clip-1');
    });

    // 08-E E6 minimal: renderState on the projection — reuses video_render_jobs (08-B B4's
    // pinned_seq), no named-version/review concept invented.
    check('getTimelineCollectionProjection(): renderState.isStale=true and no lastJobId when no render job exists yet', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const projection = getTimelineCollectionProjection(projectId);
      assert.strictEqual(projection.renderState.lastJobId, null);
      assert.strictEqual(projection.renderState.lastJobStatus, null);
      assert.strictEqual(projection.renderState.isStale, true);
    });

    check('getTimelineCollectionProjection(): renderState.isStale=false when the latest render job was pinned at the current seq', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });
      const jobId = crypto.randomUUID();
      renderJobIds.push(jobId);
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status, pinned_seq) VALUES (?, ?, ?, ?, ?)')
        .run(jobId, projectId, ownerId, 'done', 1);

      const projection = getTimelineCollectionProjection(projectId);
      assert.strictEqual(projection.renderState.lastJobId, jobId);
      assert.strictEqual(projection.renderState.lastJobStatus, 'done');
      assert.strictEqual(projection.renderState.isStale, false);
    });

    check('getTimelineCollectionProjection(): renderState.isStale=true when a NEW command lands after the last render was pinned', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });
      const jobId = crypto.randomUUID();
      renderJobIds.push(jobId);
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status, pinned_seq) VALUES (?, ?, ?, ?, ?)')
        .run(jobId, projectId, ownerId, 'done', 1);
      const clip2 = { id: 'clip-2', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 5000, timelineOutMs: 6000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 2, 'InsertClip', { trackId: 'track-v1', index: 1, clip: clip2 });

      const projection = getTimelineCollectionProjection(projectId);
      assert.strictEqual(projection.renderState.lastJobId, jobId, 'still reports the most recent job even though it is now stale');
      assert.strictEqual(projection.renderState.isStale, true, 'an edit after the last render pin must mark render state stale');
    });

    check('getTimelineCollectionProjection(): renderState.isStale=true when the last job has no pinned_seq (retry/legacy job) — never a false "up to date"', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      insertCommand(projectId, 1, 'InsertClip', { trackId: 'track-v1', index: 0, clip });
      const jobId = crypto.randomUUID();
      renderJobIds.push(jobId);
      db.prepare('INSERT INTO video_render_jobs (id, project_id, owner_id, status) VALUES (?, ?, ?, ?)')
        .run(jobId, projectId, ownerId, 'done');

      const projection = getTimelineCollectionProjection(projectId);
      assert.strictEqual(projection.renderState.isStale, true);
    });

    // 08-D D2 (idempotency key + base revision / no last-write-wins) — applyCommand().
    check('applyCommand(): no idempotencyKey/baseRevision behaves exactly like pre-08-D (backward compat)', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };

      const result = applyCommand(projectId, { type: 'InsertClip', args: { trackId: 'track-v1', index: 0, clip } });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.seq, 1);
      assert.strictEqual(result.idempotent, undefined);
    });

    check('applyCommand(): retrying the same idempotencyKey returns the original result and does not insert a second command row', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      const args = { trackId: 'track-v1', index: 0, clip };

      const first = applyCommand(projectId, { type: 'InsertClip', args, idempotencyKey: 'retry-key-1' });
      const retry = applyCommand(projectId, { type: 'InsertClip', args, idempotencyKey: 'retry-key-1' });

      assert.strictEqual(retry.seq, first.seq);
      assert.strictEqual(retry.idempotent, true);
      const rowCount = db.prepare('SELECT COUNT(*) AS n FROM video_project_commands WHERE project_id = ?').get(projectId).n;
      assert.strictEqual(rowCount, 1, 'a retried idempotencyKey must not create a second command row');
      assert.strictEqual(recoverProjectState(projectId).tracks[0].clips.length, 1, 'the clip must not be inserted twice');
    });

    check('applyCommand(): a stale baseRevision throws a 409 conflict instead of silently overwriting (no last-write-wins)', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clipA = { id: 'clip-a', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] };
      applyCommand(projectId, { type: 'InsertClip', args: { trackId: 'track-v1', index: 0, clip: clipA } }); // seq -> 1, "session B" committed first

      const clipB = { id: 'clip-b', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 1000, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] };
      assert.throws(
        () => applyCommand(projectId, { type: 'InsertClip', args: { trackId: 'track-v1', index: 1, clip: clipB }, baseRevision: 0 }), // "session A" still thinks revision is 0
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.body.reason, 'base_revision_mismatch');
          assert.strictEqual(err.body.currentRevision, 1);
          return true;
        }
      );
      assert.strictEqual(recoverProjectState(projectId).tracks[0].clips.length, 1, 'the conflicting command must not have been applied');
    });

    check('applyCommand(): a correct (up-to-date) baseRevision applies normally', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };

      const result = applyCommand(projectId, { type: 'InsertClip', args: { trackId: 'track-v1', index: 0, clip }, baseRevision: 0 });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.seq, 1);
    });

    // 08-D D4 (durable undo, specs/.../08-v2/08-d-durable-editing-transactions.md §5 acceptance
    // "Reload sau undo/redo trả đúng state đã commit"): posting an Undo command through the SAME
    // path as any other command must survive a reload — recoverProjectState() replays the full log
    // from scratch, exactly what a real reload does, so this is not testing CommandStack's local
    // (in-memory) undo, it's testing the durable server-side record of it.
    check('applyCommand(): posting an Undo command durably reverts an InsertClip — recoverProjectState() (= a reload) reflects it', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      const clip = { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: {}, effects: [], keyframes: [] };
      const insertArgs = { trackId: 'track-v1', index: 0, clip };

      applyCommand(projectId, { type: 'InsertClip', args: insertArgs }); // seq 1
      assert.strictEqual(recoverProjectState(projectId).tracks[0].clips.length, 1);

      const undoResult = applyCommand(projectId, { type: 'Undo', args: { originalType: 'InsertClip', originalArgs: insertArgs } }); // seq 2
      assert.strictEqual(undoResult.success, true);
      assert.strictEqual(undoResult.seq, 2);

      // The exact scenario a reload triggers: replay snapshot + full command log from scratch.
      const afterReload = recoverProjectState(projectId);
      assert.strictEqual(afterReload.tracks[0].clips.length, 0, 'the Undo command row must be replayed on reload, not just applied once in memory');
    });

    // 08.2.4 §3: batchCreateFromVideos() — both create-timeline modes.
    check('batchCreateFromVideos(): all-selected-one-timeline appends clips sequentially onto Track 1, in orderedAssetIds order', () => {
      const a1 = makeVideoAsset(ownerId, { durationMs: 4000 });
      const a2 = makeVideoAsset(ownerId, { durationMs: 6000 });
      assetIds.push(a1, a2);

      const result = batchCreateFromVideos(ownerId, { mode: 'all-selected-one-timeline', orderedAssetIds: [a1, a2], baseName: 'Batch A' });
      projectIds.push(...result.createdTimelineIds);

      assert.strictEqual(result.createdTimelineIds.length, 1);
      assert.strictEqual(result.assetToTimelineIds[a1], result.createdTimelineIds[0]);
      assert.strictEqual(result.assetToTimelineIds[a2], result.createdTimelineIds[0]);

      const state = recoverProjectState(result.createdTimelineIds[0]);
      assert.strictEqual(state.tracks.length, 1);
      assert.strictEqual(state.tracks[0].type, 'video');
      const [clip1, clip2] = state.tracks[0].clips;
      assert.strictEqual(clip1.assetId, a1);
      assert.strictEqual(clip1.timelineInMs, 0);
      assert.strictEqual(clip1.timelineOutMs, 4000);
      assert.strictEqual(clip2.assetId, a2);
      assert.strictEqual(clip2.timelineInMs, 4000);
      assert.strictEqual(clip2.timelineOutMs, 10000);
    });

    check('batchCreateFromVideos(): one-video-one-timeline creates N timelines, each with its own single clip at 0ms', () => {
      const a1 = makeVideoAsset(ownerId, { sourcePath: 'first.mp4', durationMs: 2000 });
      const a2 = makeVideoAsset(ownerId, { sourcePath: 'second.mp4', durationMs: 3000 });
      assetIds.push(a1, a2);

      const result = batchCreateFromVideos(ownerId, { mode: 'one-video-one-timeline', orderedAssetIds: [a1, a2] });
      projectIds.push(...result.createdTimelineIds);

      assert.strictEqual(result.createdTimelineIds.length, 2);
      assert.notStrictEqual(result.assetToTimelineIds[a1], result.assetToTimelineIds[a2]);

      const state1 = recoverProjectState(result.assetToTimelineIds[a1]);
      assert.strictEqual(state1.tracks[0].clips.length, 1);
      assert.strictEqual(state1.tracks[0].clips[0].timelineInMs, 0);
      assert.strictEqual(state1.tracks[0].clips[0].timelineOutMs, 2000);
    });

    // 08-B B2 / ADR 0033 (docs/decisions/0033-native-timeline-collection-minimal-slice.md)
    check('batchCreateFromVideos(): one-video-one-timeline with no collectionId auto-creates ONE shared collection for all created timelines', () => {
      const a1 = makeVideoAsset(ownerId, { sourcePath: 'first.mp4', durationMs: 2000 });
      const a2 = makeVideoAsset(ownerId, { sourcePath: 'second.mp4', durationMs: 3000 });
      assetIds.push(a1, a2);

      const result = batchCreateFromVideos(ownerId, { mode: 'one-video-one-timeline', orderedAssetIds: [a1, a2] });
      projectIds.push(...result.createdTimelineIds);
      collectionIds.push(result.collectionId);

      assert.ok(result.collectionId);
      const rows = result.createdTimelineIds.map((id) => db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(id));
      assert.strictEqual(rows[0].collection_id, result.collectionId);
      assert.strictEqual(rows[1].collection_id, result.collectionId);
    });

    check('batchCreateFromVideos(): all-selected-one-timeline (only ONE timeline, no grouping value) stays standalone — collection_id null', () => {
      const a1 = makeVideoAsset(ownerId, { durationMs: 2000 });
      assetIds.push(a1);
      const result = batchCreateFromVideos(ownerId, { mode: 'all-selected-one-timeline', orderedAssetIds: [a1] });
      projectIds.push(...result.createdTimelineIds);
      assert.strictEqual(result.collectionId, null);
      const row = db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(result.createdTimelineIds[0]);
      assert.strictEqual(row.collection_id, null);
    });

    check('batchCreateFromVideos(): an explicit collectionId adds the new timeline into that EXISTING collection instead of creating a new one', () => {
      const existingCollectionId = crypto.randomUUID();
      db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)').run(existingCollectionId, ownerId, 'My Collection');
      collectionIds.push(existingCollectionId);

      const a1 = makeVideoAsset(ownerId, { durationMs: 2000 });
      assetIds.push(a1);
      const result = batchCreateFromVideos(ownerId, { mode: 'all-selected-one-timeline', orderedAssetIds: [a1], collectionId: existingCollectionId });
      projectIds.push(...result.createdTimelineIds);
      assert.strictEqual(result.collectionId, existingCollectionId);
      const row = db.prepare('SELECT collection_id FROM video_projects WHERE id = ?').get(result.createdTimelineIds[0]);
      assert.strictEqual(row.collection_id, existingCollectionId);
    });

    check('batchCreateFromVideos(): rejects a collectionId owned by a different user — creates nothing', () => {
      const otherOwnerId = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
        .run(otherOwnerId, `video-projects-test-sub-${otherOwnerId}`, `video-projects-test-${otherOwnerId}@space-flow.local`, 'Other User', 'member');
      const foreignCollectionId = crypto.randomUUID();
      db.prepare('INSERT INTO video_timeline_collections (id, owner_id, name) VALUES (?, ?, ?)').run(foreignCollectionId, otherOwnerId, 'Not Yours');
      try {
        const a1 = makeVideoAsset(ownerId, { durationMs: 2000 });
        assetIds.push(a1);
        const before = db.prepare('SELECT COUNT(*) AS n FROM video_projects WHERE owner_id = ?').get(ownerId).n;
        assert.throws(() => batchCreateFromVideos(ownerId, { mode: 'all-selected-one-timeline', orderedAssetIds: [a1], collectionId: foreignCollectionId }), /quyền/);
        const after = db.prepare('SELECT COUNT(*) AS n FROM video_projects WHERE owner_id = ?').get(ownerId).n;
        assert.strictEqual(after, before, 'rejected collectionId must not leak a project row from the aborted attempt');
      } finally {
        db.prepare('DELETE FROM video_timeline_collections WHERE id = ?').run(foreignCollectionId);
        db.prepare('DELETE FROM users WHERE id = ?').run(otherOwnerId);
      }
    });

    check('batchCreateFromVideos(): naming collision gets a deterministic " (2)" suffix, both against existing projects and within the same batch', () => {
      const dup = makeProject(ownerId, baseState()); // pre-existing project named 'Test Project'
      projectIds.push(dup);
      const a1 = makeVideoAsset(ownerId, { sourcePath: 'Test Project.mp4', durationMs: 1000 });
      const a2 = makeVideoAsset(ownerId, { sourcePath: 'Test Project.mp4', durationMs: 1000 }); // same basename again
      assetIds.push(a1, a2);

      const result = batchCreateFromVideos(ownerId, { mode: 'one-video-one-timeline', orderedAssetIds: [a1, a2] });
      projectIds.push(...result.createdTimelineIds);

      const names = result.createdTimelineIds.map((id) => db.prepare('SELECT name FROM video_projects WHERE id = ?').get(id).name);
      assert.deepStrictEqual([...names].sort(), ['Test Project (2)', 'Test Project (3)']);
    });

    check('batchCreateFromVideos(): one offline asset in the batch rejects the WHOLE batch — creates nothing', () => {
      const a1 = makeVideoAsset(ownerId, { durationMs: 1000 });
      const a2 = makeVideoAsset(ownerId, { status: 'offline' });
      assetIds.push(a1, a2);

      const before = db.prepare('SELECT COUNT(*) AS n FROM video_projects WHERE owner_id = ?').get(ownerId).n;
      assert.throws(() => batchCreateFromVideos(ownerId, { mode: 'one-video-one-timeline', orderedAssetIds: [a1, a2] }), /chưa sẵn sàng/);
      const after = db.prepare('SELECT COUNT(*) AS n FROM video_projects WHERE owner_id = ?').get(ownerId).n;
      assert.strictEqual(after, before, 'a rejected batch must not create ANY project, not even for the valid asset');
    });

    check('batchCreateFromVideos(): rejects an asset owned by a different user', () => {
      const otherOwnerId = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
        .run(otherOwnerId, `video-projects-test-sub-${otherOwnerId}`, `video-projects-test-${otherOwnerId}@space-flow.local`, 'Other User', 'member');
      try {
        const foreignAsset = makeVideoAsset(otherOwnerId);
        assetIds.push(foreignAsset);
        assert.throws(() => batchCreateFromVideos(ownerId, { mode: 'one-video-one-timeline', orderedAssetIds: [foreignAsset] }), /quyền/);
      } finally {
        db.prepare('DELETE FROM users WHERE id = ?').run(otherOwnerId);
      }
    });

    check('archiveProject(): sets archived_at; project row still exists', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      archiveProject(projectId);
      const row = db.prepare('SELECT archived_at FROM video_projects WHERE id = ?').get(projectId);
      assert.ok(row.archived_at, 'archived_at should be set after archiveProject()');
    });

    check('restoreProject(): clears archived_at', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      archiveProject(projectId);
      restoreProject(projectId);
      const row = db.prepare('SELECT archived_at FROM video_projects WHERE id = ?').get(projectId);
      assert.strictEqual(row.archived_at, null, 'archived_at should be cleared after restoreProject()');
    });

    check('permanentlyDeleteProject(): rejects a project that is not archived first', () => {
      const projectId = makeProject(ownerId, baseState());
      projectIds.push(projectId);
      assert.throws(() => permanentlyDeleteProject(projectId), /thùng rác/);
      const row = db.prepare('SELECT id FROM video_projects WHERE id = ?').get(projectId);
      assert.ok(row, 'project must still exist after a rejected permanent-delete attempt');
    });

    check('permanentlyDeleteProject(): deletes an archived project for real', () => {
      const projectId = makeProject(ownerId, baseState());
      archiveProject(projectId);
      permanentlyDeleteProject(projectId);
      const row = db.prepare('SELECT id FROM video_projects WHERE id = ?').get(projectId);
      assert.strictEqual(row, undefined, 'project row should be gone after permanentlyDeleteProject()');
    });
  } finally {
    for (const id of renderJobIds) db.prepare('DELETE FROM video_render_jobs WHERE id = ?').run(id); // cascades with the project row too, but explicit for clarity
    for (const id of projectIds) db.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
    for (const id of assetIds) db.prepare('DELETE FROM video_assets WHERE id = ?').run(id);
    for (const id of collectionIds) db.prepare('DELETE FROM video_timeline_collections WHERE id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(ownerId);
  }

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
