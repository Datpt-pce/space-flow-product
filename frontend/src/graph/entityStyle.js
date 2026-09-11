// Graph Library (specs/space-flow-master-plan/02-graph-library.md): entity id parsing + default
// per-type styling shared between LocalGraphPanel.jsx (Phase 4) and GlobalGraphView.jsx (Phase 6)
// — same entities, same visual vocabulary, so color/size/id-parsing live in exactly 1 place.

export const TYPE_COLOR = {
  workflow: '#3498db',
  node_instance: '#95a5a6',
  node_package: '#e74c3c',
  user: '#9b59b6',
};

export const TYPE_SIZE = {
  workflow: 8,
  node_instance: 4,
  node_package: 6,
  user: 5,
};

export function parseEntityId(id) {
  const i = id.indexOf(':');
  return { type: id.slice(0, i), localId: id.slice(i + 1) };
}
