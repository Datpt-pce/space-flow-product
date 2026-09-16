import assert from 'node:assert/strict';
import { queuedDriveFolders, prepareResizeDriveInputs, resizeDriveRowError } from './resizeDrivePreparation.js';

const url = 'https://drive.google.com/drive/folders/example';
const skipped = 'https://drive.google.com/drive/folders/skipped';
const config = { rows: [{ id: 'a', selected: true, input_folders: [url, url] }, { id: 'b', selected: false, input_folders: [skipped] }], wiring_folders: [url, skipped] };
assert.deepEqual(queuedDriveFolders('resize-upload-v3-1', config), [url]);
assert.deepEqual(queuedDriveFolders('resize-upload-v3-2', { ...config, source_folders: [url] }), [url]);
assert.deepEqual(queuedDriveFolders('resize-upload-v2', config), []);

function store() {
  let state = { currentUser: { id: 'owner' }, nodes: [{ id: 'node', type: 'resize-upload-v3-1', data: { config: structuredClone(config) } }],
    updateNodeConfig(id, key, value) { state.nodes = state.nodes.map(node => node.id === id ? { ...node, data: { config: { ...node.data.config, [key]: value } } } : node); } };
  return { get: () => state, set: patch => { state = { ...state, ...patch }; } };
}

const s = store();
const pending = prepareResizeDriveInputs('node', s.get, s.set);
const request = s.get().resizeDriveRequest;
request.saveSession({ importId: 'session', status: 'partial' });
assert.equal(s.get().nodes[0].data.config.drive_imports[url].importId, 'session');
assert.deepEqual(s.get().nodes[0].data.config.rows[0].input_folders, [url, url], 'partial does not replace inputs');
request.finish({ folder: '/download/complete' });
const prepared = await pending;
assert.deepEqual(prepared.rows[0].input_folders, ['/download/complete']);
assert.deepEqual(prepared.rows[1].input_folders, [skipped]);
assert.deepEqual(prepared.wiring_folders, ['/download/complete', skipped]);
assert.equal(prepared.short_video_ack, '');
assert.deepEqual(prepared.drive_imports, {});
request.saveSession({ status: 'interrupted' });
assert.deepEqual(s.get().nodes[0].data.config.drive_imports, {}, 'late events cannot restore stale state');

const cancelled = store();
const run = prepareResizeDriveInputs('node', cancelled.get, cancelled.set);
cancelled.get().resizeDriveRequest.finish(null);
assert.equal(await run, null);
assert.deepEqual(cancelled.get().nodes[0].data.config.rows[0].input_folders, [url, url]);
const changedOwner = store();
const otherRun = prepareResizeDriveInputs('node', changedOwner.get, changedOwner.set);
const previous = changedOwner.get().resizeDriveRequest;
changedOwner.set({ currentUser: { id: 'other' } });
previous.finish({ folder: '/download/complete' });
assert.equal(await otherRun, null);
console.log('Resize Drive preparation: selection, session persistence, replacement, cancellation and owner change passed');

for (const type of ['resize-upload-v3', 'resize-upload-v3-1', 'resize-upload-v3-2']) {
  const batch = store();
  const urls = Array.from({ length: 5 }, (_, i) => `${url}${i}`);
  const rows = urls.map((path, i) => ({ id: String(i), selected: true, input_folders: [path] }));
  batch.set({ nodes: [{ id: 'node', type, data: { config: { rows, source_folders: urls } } }] });
  const pendingBatch = prepareResizeDriveInputs('node', batch.get, batch.set);
  for (let i = 0; i < 5; i++) {
    const next = batch.get().resizeDriveRequest;
    assert.equal(next.url, urls[i]);
    assert.equal(next.recovery, false);
    const result = i === 0 ? { status: 'partial', message: 'Tải lỗi', importId: 'failed' }
      : { status: 'complete', folder: `/download/${i}` };
    next.saveSession(result);
    next.finish(result);
    await new Promise(resolve => setImmediate(resolve));
  }
  const recovery = batch.get().resizeDriveRequest;
  assert.equal(recovery.url, urls[0]);
  assert.equal(recovery.recovery, true, 'recovery starts only after all five downloads');
  const saved = batch.get().nodes[0].data.config;
  assert.equal(resizeDriveRowError(type, saved, saved.rows[0]), 'Tải lỗi');
  assert.equal(resizeDriveRowError(type, saved, saved.rows[1]), type === 'resize-upload-v3-2' ? 'Tải lỗi' : '');
  assert.deepEqual(saved.rows.slice(1).map(row => row.input_folders[0]), ['/download/1', '/download/2', '/download/3', '/download/4']);
  recovery.finish({ status: 'complete', folder: '/download/0' });
  const finished = await pendingBatch;
  assert.equal(resizeDriveRowError(type, finished, finished.rows[0]), '');
  assert.deepEqual(finished.drive_imports, {});
}
console.log('Resize Drive batch: all selected inputs finish before recovery; errors follow active sources across all versions');
