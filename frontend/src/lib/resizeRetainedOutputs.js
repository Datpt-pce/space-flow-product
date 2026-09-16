const resizeTypes = new Set(['resize-upload-v3', 'resize-upload-v3-1', 'resize-upload-v3-2']);

function resizeNodeIds(state) {
  const nodes = [...state.nodes, ...state.pages.filter(page => page.id !== state.activePageId).flatMap(page => page.nodes || [])];
  return new Set(nodes.filter(node => resizeTypes.has(node.type)).map(node => node.id));
}

export function retainResizeOutput(state, nodeId, output) {
  if (!resizeNodeIds(state).has(nodeId)) return state.retainedResizeOutputs;
  return { ...state.retainedResizeOutputs, [nodeId]: { ownerId: state.currentUser?.id, output } };
}

export function persistedResizeOutputs(state) {
  const ids = resizeNodeIds(state);
  return Object.fromEntries(Object.entries(state.retainedResizeOutputs).filter(([id]) => ids.has(id)));
}

export function restoredResizeOutputs(state) {
  return Object.fromEntries(Object.entries(persistedResizeOutputs(state))
    .filter(([, value]) => value.ownerId && value.ownerId === state.currentUser?.id)
    .map(([id, value]) => [id, value.output]));
}
