import assert from 'node:assert/strict';
import { retainResizeOutput, persistedResizeOutputs, restoredResizeOutputs } from './resizeRetainedOutputs.js';

const output = { rows: { row: { status: 'done', unc_links: ['C:/result'] } } };
const state = { currentUser: { id: 'owner' }, activePageId: 'one',
  nodes: [{ id: 'resize', type: 'resize-upload-v3' }, { id: 'text', type: 'text' }],
  pages: [{ id: 'one', nodes: [{ id: 'deleted', type: 'resize-upload-v3' }] },
    { id: 'two', nodes: [{ id: 'other-page', type: 'resize-upload-v3-2' }] }],
  retainedResizeOutputs: {} };
state.retainedResizeOutputs = retainResizeOutput(state, 'resize', output);
state.retainedResizeOutputs = retainResizeOutput(state, 'other-page', output);
state.retainedResizeOutputs = retainResizeOutput(state, 'text', { text: 'not retained' });
assert.deepEqual(Object.keys(persistedResizeOutputs(state)), ['resize', 'other-page']);
assert.deepEqual(restoredResizeOutputs(state), { resize: output, 'other-page': output });
assert.deepEqual(restoredResizeOutputs({ ...state, currentUser: { id: 'different' } }), {});
assert.deepEqual(restoredResizeOutputs({ ...state, currentUser: null }), {});
assert.deepEqual(persistedResizeOutputs({ ...state, nodes: [] }), { 'other-page': state.retainedResizeOutputs['other-page'] });
assert.equal(restoredResizeOutputs({ ...state, nodes: [...state.nodes, { id: 'copy', type: 'resize-upload-v3' }] }).copy, undefined);
console.log('Resize retained output ownership, pages, deletion and copy checks passed');
