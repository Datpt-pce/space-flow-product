// Pure, synchronous and shared by browser/server. Media readiness is resolved by
// the caller; no filesystem, clocks, IDs or provider effects in the planner.
const { canonicalJson } = require('./video-document-diff');
const MAX_OUTPUTS = 100;
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function orderedCandidates(list, kind) {
  const minimum = list.minRating ?? 0;
  return list.items.filter(item => item.enabled !== false && item.status === 'ok'
    && (item.rating ?? 0) >= minimum && (!kind || (kind === 'visual' ? ['video', 'image'].includes(item.kind) : item.kind === kind)))
    .slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)
      || (a.manualOrder ?? 0) - (b.manualOrder ?? 0) || compareId(a.id, b.id));
}

function slotCandidates(list, slot) {
  if (slot.selectedItemIds !== undefined && (!Array.isArray(slot.selectedItemIds)
    || slot.fixedItemId || new Set(slot.selectedItemIds).size !== slot.selectedItemIds.length
    || slot.selectedItemIds.some(id => typeof id !== 'string' || !list.items.some(i => i.id === id)))) throw new Error(`Vị trí ${slot.id}: nhóm asset đã chọn không hợp lệ.`);
  return orderedCandidates(list, slot.kind).filter(i => (!slot.fixedItemId || i.id === slot.fixedItemId)
    && (slot.selectedItemIds === undefined || slot.selectedItemIds.includes(i.id)));
}

function planBatch(snapshot, { offset = 0, limit = 20 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OUTPUTS) throw new Error('Trang ma trận không hợp lệ.');
  const { lists, slots } = snapshot;
  if (!Array.isArray(lists) || !Array.isArray(slots) || !slots.length) throw new Error('Thêm ít nhất một vị trí vào công thức.');
  if (new Set(lists.map(l => l.id)).size !== lists.length || new Set(slots.map(s => s.id)).size !== slots.length) throw new Error('ID list/vị trí phải duy nhất.');
  for (const list of lists) {
    if (!Array.isArray(list.items) || new Set(list.items.map(i => i.id)).size !== list.items.length) throw new Error('ID item phải duy nhất trong list.');
    if (!Number.isInteger(list.minRating ?? 0) || (list.minRating ?? 0) < 0 || (list.minRating ?? 0) > 5) throw new Error('Filter sao phải từ 0 đến 5.');
    for (const item of list.items) if (!Number.isInteger(item.rating ?? 0) || (item.rating ?? 0) < 0 || (item.rating ?? 0) > 5 || !Number.isSafeInteger(item.manualOrder ?? 0) || (item.manualOrder ?? 0) < 0 || typeof item.id !== 'string') throw new Error('Rating/order/item không hợp lệ.');
  }
  const axes = slots.map(slot => {
    const list = lists.find(l => l.id === slot.listId);
    if (!list) throw new Error(`Vị trí ${slot.id}: không tìm thấy list.`);
    const candidates = slotCandidates(list, slot);
    if (!candidates.length) throw new Error(`Vị trí ${slot.id} (${list.name || list.id}): không có item sẵn sàng sau filter.`);
    return { slotId: slot.id, playlist:slot.playlist===true, vary: slot.vary === true && !slot.fixedItemId && !slot.playlist, candidates };
  });
  let totalCount = 1;
  for (const axis of axes) if (axis.vary) {
    // Division check precedes multiplication and allocation, including overflow.
    if (axis.candidates.length > Math.floor(MAX_OUTPUTS / totalCount)) throw new Error(`Tổ hợp vượt giới hạn ${MAX_OUTPUTS} timeline. Giảm số trục hoặc filter list.`);
    totalCount *= axis.candidates.length;
  }
  const rows = [];
  for (let k = offset; k < Math.min(totalCount, offset + limit); k++) {
    let cursor = k;
    const indexes = Array(axes.length);
    for (let i = axes.length - 1; i >= 0; i--) {
      indexes[i] = axes[i].vary ? cursor % axes[i].candidates.length : axes[i].playlist ? 0 : k % axes[i].candidates.length;
      if (axes[i].vary) cursor = Math.floor(cursor / axes[i].candidates.length);
    }
    rows.push({ rowIndex: k, assignments: axes.map((axis, i) => ({ slotId: axis.slotId, itemId: axis.candidates[indexes[i]].id,...(axis.playlist?{playlistItemIds:axis.candidates.map(c=>c.id)}:{}) })) });
  }
  return { plannerVersion: 1, totalCount, rows, axes: axes.map(axis => ({ slotId: axis.slotId, vary: axis.vary, itemIds: axis.candidates.map(i => i.id) })), inputCanonical: canonicalJson(snapshot) };
}

module.exports = { MAX_OUTPUTS, orderedCandidates, slotCandidates, planBatch };
