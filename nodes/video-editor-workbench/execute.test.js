// 08-E E1/E6 minimal (specs/.../08-v2/08-e-editor-node-and-workbench.md). Runs against the real
// dev DB (same convention as nodes/sheet-range-input/execute.test.js) — creates its own user+
// project rows, cleans up after itself.
//
// Run with: node nodes/video-editor-workbench/execute.test.js

const crypto = require('crypto');
const assert = require('assert');
const db = require('../../backend/db');
const execute = require('./execute');
const versions = require('../../backend/routes/video-versions').service;

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

function makeUser() {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_sub, email, name, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, `video-workbench-test-${id}`, `video-workbench-test-${id}@space-flow.local`, 'Test', 'member');
  return id;
}

function makeProject(ownerId) {
  const id = crypto.randomUUID();
  const payload = {
    schemaVersion: 1, resolution: { width: 1920, height: 1080 }, fps: 30, colorSpace: 'sRGB', audioRate: 48000, sequence: { markers: [] },
    tracks: [{ id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips: [] }],
    transitions: [],
  };
  const payloadJson = JSON.stringify(payload);
  db.prepare('INSERT INTO video_projects (id, owner_id, name, payload) VALUES (?, ?, ?, ?)')
    .run(id, ownerId, 'Test Project', payloadJson);
  db.prepare('INSERT INTO video_project_snapshots (id, project_id, seq, payload) VALUES (?, ?, 0, ?)')
    .run(crypto.randomUUID(), id, payloadJson);
  return id;
}

const cleanupUserIds = [];
const cleanupProjectIds = [];

async function run() {
  const owner = makeUser();
  cleanupUserIds.push(owner);
  const projectId = makeProject(owner);
  cleanupProjectIds.push(projectId);
  const versionId = versions.create(owner, projectId, { name: 'Pinned original', baseRevision: 0 }).id;

  await check('config.projectId rỗng -> timeline_collection null, không throw', async () => {
    const result = await execute({}, {}, { userId: owner });
    assert.strictEqual(result.timeline_collection, null);
  });

  await check('config.projectId hợp lệ, đúng chủ -> trả projection thật', async () => {
    const result = await execute({}, { projectId, versionId }, { userId: owner });
    assert.strictEqual(result.timeline_collection.timeline.id, projectId);
    assert.strictEqual(result.timeline_collection.collection.activeTimelineId, projectId);
  });

  await check('projectId không tồn tại -> throw', async () => {
    await assert.rejects(() => execute({}, { projectId: crypto.randomUUID() }, { userId: owner }), /không tồn tại/);
  });

  await check('project của người khác -> throw, không đọc lén', async () => {
    const stranger = makeUser();
    cleanupUserIds.push(stranger);
    await assert.rejects(
      () => execute({}, { projectId }, { userId: stranger }),
      /chủ sở hữu/
    );
  });

  // 08-E E6 minimal: Run luôn đọc lại state đã persist trong DB tại thời điểm gọi, không có buffer
  // riêng nào bị "kẹt" ở state cũ — execute() không tự cache gì giữa 2 lần gọi.
  await check('Run giữ nguyên bản ghim; chọn bản mới mới nhận chỉnh sửa mới', async () => {
    const before = await execute({}, { projectId, versionId }, { userId: owner });
    assert.strictEqual(before.timeline_collection.version.documentRef.tracks[0].clips.length, 0);
    db.prepare('INSERT INTO video_project_commands (id, project_id, seq, type, args_json) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(), projectId, 1, 'InsertClip',
      JSON.stringify({ trackId: 'track-v1', index: 0, clip: { id: 'clip-1', assetId: 'a1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] } }),
    );
    const pinned = await execute({}, { projectId, versionId }, { userId: owner });
    assert.strictEqual(pinned.timeline_collection.version.documentRef.tracks[0].clips.length, 0);
    assert.strictEqual(pinned.timeline_collection.staleDraft, true);
    const nextId = versions.create(owner, projectId, { name: 'Pinned edit', baseRevision: 1 }).id;
    const after = await execute({}, { projectId, versionId: nextId }, { userId: owner });
    assert.strictEqual(after.timeline_collection.version.documentRef.tracks[0].clips.length, 1);
  });

  for (const id of cleanupProjectIds) db.prepare('DELETE FROM video_projects WHERE id = ?').run(id);
  for (const id of cleanupUserIds) db.prepare('DELETE FROM users WHERE id = ?').run(id);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
