import assert from 'node:assert/strict';
import { readBatchDrop } from './folderDrop.js';

const file = name => ({ name, isFile:true, file: resolve => queueMicrotask(() => resolve({ name })) });
const directory = (name, children, size = 100) => ({ name, isDirectory:true, createReader() {
  let offset = 0;
  return { readEntries(resolve) { const batch = children.slice(offset, offset + size); offset += size; queueMicrotask(() => resolve(batch)); } };
} });
const transfer = entries => ({ items: entries.map(entry => ({ kind:'file', webkitGetAsEntry:() => entry, getAsFile:() => null })), files:[] });

const root = directory('Cảnh tiếng Việt', [...Array.from({ length: 105 }, (_, n) => file(`clip-${n}.MP4`)),
  file('notes.txt'), directory('Ảnh con', [file('Ảnh.png'), file('Thumbs.db')])]);
const drag = transfer([root, directory('Nhạc', [file('Voice.wav')]), directory('Rỗng', []), file('loose.mp4')]);
const reading = readBatchDrop(drag);
// Access to the event's DataTransfer expires before asynchronous reads finish.
drag.items.forEach(item => { item.webkitGetAsEntry = () => { throw new Error('protected event'); }; });
const result = await reading;
assert.deepEqual(result.folders.map(f => f.name), ['Cảnh tiếng Việt', 'Nhạc', 'Rỗng']);
assert.equal(result.folders[0].files.length, 106);
assert.ok(result.folders[0].files.some(f => f.name === 'clip-104.MP4'));
assert.ok(result.folders[0].files.some(f => f.name === 'Ảnh.png'));
assert.equal(result.folders[2].files.length, 0);
assert.deepEqual(result.files, [{ name:'loose.mp4' }]);
assert.deepEqual(result.folders[0].files.filter(f => f.name.startsWith('clip-')).slice(0, 3).map(f => f.name), ['clip-0.MP4', 'clip-1.MP4', 'clip-2.MP4']);
const sameNames = await readBatchDrop(transfer([directory('Same', [file('one.png')]), directory('Same', [file('two.png')])]));
assert.equal(sameNames.folders.length, 2, 'duplicate folder names never merge distinct lists');
assert.deepEqual(await readBatchDrop({ files:[{name:'loose.webm'}] }), { folders:[], files:[{name:'loose.webm'}] });
assert.deepEqual(await readBatchDrop({ items:[{kind:'file',getAsFile:() => ({name:'loose.png'})}], files:[] }), { folders:[], files:[{name:'loose.png'}] });
await assert.rejects(readBatchDrop(transfer([root]), { maxFiles:105 }), /1000 item/);
await assert.rejects(readBatchDrop(transfer([root]), { maxFolders:0 }), /50 list/);
await assert.rejects(readBatchDrop(transfer([directory('x'.repeat(121), [])])), /120 ký tự/);
await assert.rejects(readBatchDrop(transfer([{name:'Không đọc được',isDirectory:true,createReader:() => ({ readEntries:(_, reject) => reject(new Error('permission denied')) })}])), /Không đọc được.*permission denied/);
await assert.rejects(readBatchDrop(transfer([directory('Broken', [{name:'bad.png',isFile:true,file:(_, reject) => reject(new Error('file removed'))}])])), /Broken.*file removed/);
console.log('PASS folder drop: recursive Unicode folders, complete batched reads, event capture, loose files, natural order, separate roots, limits and read errors');
