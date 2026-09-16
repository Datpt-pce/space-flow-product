import { resizeInputAction, recognizeResizeUploadV32 } from '../lib/api.js';
import { inputActionConfig, replaceInputPath, normalizedPath } from '../lib/resizeInputPaths.js';

const LIMIT = 50;
const volatile = new Set(['short_video_ack', 'sheet_label_ack', 'label_timestamp', 'normalized_groups']);
const equal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function diff(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !equal(before[key], after[key]));
  return { before: Object.fromEntries(keys.map(key => [key, before[key]])), after: Object.fromEntries(keys.map(key => [key, after[key]])) };
}
function apply(config, patch) {
  const next = { ...config, ...patch };
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete next[key];
  return next;
}

// Intercept immutable config changes, including List's item/table actions.
// Canvas snapshots are deliberately not another source of config history.
export const withNodeHistory = initializer => (set, get, api) => {
  let tick = 0, scheduled = false, lastFocus = null;
  const record = (state, nodeId, before, after, external) => {
    const patch = diff(before, after);
    if (!external && Object.keys(patch.after).every(key => volatile.has(key))) return state.nodeHistories || {};
    const histories = state.nodeHistories || {};
    const history = histories[nodeId] || { undo: [], redo: [] };
    const undo = [...history.undo], previous = undo.at(-1);
    const focus = typeof document === 'undefined' ? null : document.activeElement;
    const typing = focus?.matches('input:not([type=checkbox]):not([type=radio]), textarea');
    const now = Date.now();
    const merge = !external && !previous?.external && !history.redo.length && previous &&
      (previous.tick === tick || (typing && focus === lastFocus && previous.nodeId === nodeId && now - previous.time < 750 && equal(Object.keys(previous.after), Object.keys(patch.after))));
    if (merge) undo[undo.length - 1] = { ...previous, before: { ...patch.before, ...previous.before }, after: { ...previous.after, ...patch.after }, time: now };
    else undo.push({ ...patch, external, tick, time: now, nodeId });
    lastFocus = focus;
    if (!scheduled) { scheduled = true; queueMicrotask(() => { tick++; scheduled = false; }); }
    return { ...histories, [nodeId]: { undo: undo.slice(-LIMIT), redo: [] } };
  };
  const trackedSet = (update, replace) => set(state => {
    const patch = typeof update === 'function' ? update(state) : update;
    if (!patch) return patch;
    if (patch.currentUser !== undefined && patch.currentUser?.id !== state.currentUser?.id) return { ...patch, nodeHistories: {}, nodeHistoryError: '' };
    if (patch.activePageId !== undefined) return { ...patch, nodeHistories: {}, nodeHistoryError: '', activeNodeHistoryId: null };
    if (!patch.nodes || Object.hasOwn(patch, '_undoStack')) return patch;
    let histories = state.nodeHistories || {};
    for (const node of patch.nodes) {
      const old = state.nodes.find(item => item.id === node.id);
      if (old && old.data.config !== node.data.config) histories = record({ ...state, nodeHistories: histories }, node.id, old.data.config, node.data.config);
    }
    return { ...patch, nodeHistories: histories };
  }, replace);
  const replay = async (nodeId, direction) => {
    const state = get(), history = state.nodeHistories[nodeId];
    if (state.nodeHistoryBusy || state.nodeStatuses[nodeId] === 'running' || !history?.[direction].length) return;
    const entry = history[direction].at(-1), node = state.nodes.find(item => item.id === nodeId);
    if (!node) return;
    const owner = state.currentUser?.id, page = state.activePageId;
    set({ nodeHistoryBusy: nodeId, nodeHistoryError: '' });
    try {
      if (entry.external) await resizeInputAction(node.type, node.data.config, { action: direction, token: entry.external });
      if (get().currentUser?.id !== owner || get().activePageId !== page) return;
      const other = direction === 'undo' ? 'redo' : 'undo';
      set(current => ({
        nodes: current.nodes.map(item => item.id === nodeId ? { ...item, data: { ...item.data, config: apply(item.data.config, direction === 'undo' ? entry.before : entry.after) } } : item),
        nodeHistories: { ...current.nodeHistories, [nodeId]: { [direction]: history[direction].slice(0, -1), [other]: [...history[other], entry] } },
      }));
    } catch (error) { set({ nodeHistoryError: error.message }); }
    finally { tick++; lastFocus = null; set({ nodeHistoryBusy: null }); }
  };
  return {
    ...initializer(trackedSet, get, api),
    nodeHistories: {}, nodeHistoryBusy: null, nodeHistoryError: '', activeNodeHistoryId: null,
    undoNode: id => replay(id, 'undo'),
    redoNode: id => replay(id, 'redo'),
    performNodeInputAction: async (nodeId, action) => {
      const state = get(), node = state.nodes.find(item => item.id === nodeId);
      if (!node || state.nodeHistoryBusy || state.nodeStatuses[nodeId] === 'running') throw new Error('Node đang bận');
      const owner = state.currentUser?.id, page = state.activePageId;
      set({ nodeHistoryBusy: nodeId, nodeHistoryError: '' });
      try {
        const result = await resizeInputAction(node.type, node.data.config, action);
        if (get().currentUser?.id !== owner || get().activePageId !== page) throw new Error('Ngữ cảnh đã đổi. File đã được cập nhật; kiểm tra lại Input.');
        let recognition;
        if (node.type === 'resize-upload-v3-2' && action.recognition) {
          try { recognition = await recognizeResizeUploadV32(inputActionConfig(node.data.config, result), action.inputs || {}); }
          catch (error) { set({ nodeHistoryError: `File đã cập nhật; cần nhận diện lại: ${error.message}` }); }
        }
        if (get().currentUser?.id !== owner || get().activePageId !== page || !get().nodes.some(item => item.id === nodeId)) throw new Error('Ngữ cảnh đã đổi. File đã được cập nhật; kiểm tra lại Input.');
        set(current => {
          const before = current.nodes.find(item => item.id === nodeId).data.config;
          const after = inputActionConfig(before, result);
          if (recognition) {
            const groups = recognition.groups || [];
            const mapping = new Map((action.recognition.groups || []).map(group => {
              const paths = new Set(group.records.map(record => replaceInputPath(record.path, result.source, result.deleted ? null : result.destination)).filter(Boolean).map(normalizedPath));
              return [group.id, groups.filter(next => next.records.some(record => paths.has(normalizedPath(record.path)))).map(next => next.id)];
            }));
            after.rows = after.rows.map(row => {
              if (!row.input_folders.length) return row;
              const folders = [...new Set(row.input_folders.flatMap(id => mapping.get(id) || [id]))];
              return { ...row, input_folders: folders, selected: folders.length ? row.selected : false };
            });
            after.normalized_groups = groups.map(({ records, ...group }) => group);
          }
          return { nodes: current.nodes.map(item => item.id === nodeId ? { ...item, data: { ...item.data, config: after } } : item),
            nodeHistories: record(current, nodeId, before, after, result.token) };
        });
        tick++;
        return result;
      } finally { set({ nodeHistoryBusy: null }); }
    },
  };
};

export function preserveCurrentConfigs(snapshot, current) {
  return snapshot.map(node => {
    const live = current.find(item => item.id === node.id);
    return live ? { ...node, data: { ...node.data, config: live.data.config } } : node;
  });
}
