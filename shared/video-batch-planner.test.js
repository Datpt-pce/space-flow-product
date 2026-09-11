const assert = require('node:assert/strict');
const { planBatch } = require('./video-batch-planner');
const fixture = selected => ({
  lists: [3, 1, 5].map((n, i) => ({ id: 'ABC'[i], name: 'ABC'[i], items: Array.from({ length: n }, (_, j) => ({ id: `${'ABC'[i]}${j + 1}`, rating: 0, manualOrder: j, kind: 'video', status: 'ok' })) })),
  slots: ['A', 'B', 'C'].map(id => ({ id, listId: id, vary: selected.includes(id), kind: 'visual' })),
});
const tuples = snapshot => planBatch(snapshot, { limit: 100 }).rows.map(r => r.assignments.map(a => a.itemId).join('/'));
assert.deepEqual(tuples(fixture('A')), ['A1/B1/C1', 'A2/B1/C2', 'A3/B1/C3']);
assert.deepEqual(tuples(fixture('B')), ['A1/B1/C1']);
assert.deepEqual(tuples(fixture('C')), ['A1/B1/C1', 'A2/B1/C2', 'A3/B1/C3', 'A1/B1/C4', 'A2/B1/C5']);
assert.deepEqual(tuples(fixture('AC')), Array.from({ length: 15 }, (_, k) => `A${Math.floor(k / 5) + 1}/B1/C${k % 5 + 1}`));
assert.deepEqual(tuples(fixture('')), ['A1/B1/C1']);
const empty = fixture(''); empty.lists[1].items = [];
assert.throws(() => tuples(empty), /B.*không có item/);
const filtered = fixture('A'); filtered.lists[0].minRating = 4;
filtered.lists[0].items.forEach(i => { i.rating = 4; i.manualOrder = 0; });
filtered.lists[0].items[1].status = 'offline'; filtered.lists[0].items.reverse();
assert.deepEqual(tuples(filtered), ['A1/B1/C1', 'A3/B1/C2']);
const before = planBatch(filtered).inputCanonical;
filtered.lists[0].items[0].rating = 5;
assert.notEqual(planBatch(filtered).inputCanonical, before);
assert.equal(tuples(filtered)[0], 'A3/B1/C1');
const multi = fixture('A'); multi.slots.push({ id: 'A2', listId: 'A', vary: true, trackId: 'other' });
assert.equal(tuples(multi).length, 9);
assert.equal(new Set(tuples(multi).map(t => { const a = t.split('/'); return `${a[0]}/${a[3]}`; })).size, 9);
for (const n of [100, 101]) {
  const data = fixture('A'); data.lists[0].items = Array.from({ length: n }, (_, i) => ({ id: String(i), status: 'ok', kind: 'video' }));
  if (n === 100) assert.equal(tuples(data).length, 100);
  else assert.throws(() => tuples(data), /100/);
}
const large = fixture('A'); large.slots = Array.from({ length: 200 }, (_, i) => ({ id: `slot${i}`, listId: 'A', vary: true }));
assert.throws(() => tuples(large), /100/);
const stable = fixture('AC'), json = JSON.stringify(stable);
assert.deepEqual(planBatch(stable), planBatch(JSON.parse(json)));
assert.equal(JSON.stringify(stable), json);
assert.deepEqual(planBatch(stable, { offset: 10, limit: 5 }).rows, planBatch(stable, { limit: 100 }).rows.slice(10));
const playlist={lists:[{id:'music',items:['song1','song2'].map(id=>({id,kind:'audio',status:'ok'}))}],slots:[{id:'bgm',listId:'music',kind:'audio',vary:true,playlist:true}]};
assert.equal(planBatch(playlist).totalCount,1);
assert.deepEqual(planBatch(playlist).rows[0].assignments[0].playlistItemIds,['song1','song2']);
delete playlist.slots[0].playlist;assert.equal(planBatch(playlist).totalCount,2);
const subsets = fixture('AC');
subsets.slots[0].selectedItemIds = ['A3', 'A1']; subsets.slots[2].selectedItemIds = ['C4', 'C2'];
assert.deepEqual(tuples(subsets), ['A1/B1/C2', 'A1/B1/C4', 'A3/B1/C2', 'A3/B1/C4'], 'checkbox click order does not change rating/manual ordering');
subsets.slots.push({ id: 'repeat', listId: 'A', kind: 'visual', vary: false, selectedItemIds: ['A2'] });
assert.ok(tuples(subsets).every(row => row.endsWith('/A2')), 'repeated list keeps independent selection');
const subsetBefore = JSON.stringify(subsets); planBatch(subsets); assert.equal(JSON.stringify(subsets), subsetBefore);
for (const ids of [null, 'A1', ['A1', 'A1'], ['C1'], [42]]) {
  const invalid = structuredClone(subsets); invalid.slots[0].selectedItemIds = ids;
  assert.throws(() => planBatch(invalid), /nhóm asset/);
}
const noSelection = structuredClone(subsets); noSelection.slots[0].selectedItemIds = [];
assert.throws(() => planBatch(noSelection), /không có item/);
const mixedSelection = structuredClone(subsets); mixedSelection.slots[0].fixedItemId = 'A1';
assert.throws(() => planBatch(mixedSelection), /nhóm asset/);
playlist.slots[0].playlist = true; playlist.slots[0].selectedItemIds = ['song2'];
assert.deepEqual(planBatch(playlist).rows[0].assignments[0].playlistItemIds, ['song2']);
console.log('PASS batch planner P01-P08: exact assignments, independent axes, filters, stable ties, pagination, cap and purity');
