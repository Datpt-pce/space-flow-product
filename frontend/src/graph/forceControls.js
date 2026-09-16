// Graph Library Phase 6 (specs/space-flow-master-plan/02-graph-library.md): the 4 force-control
// sliders map directly to graphology-layout-forceatlas2 settings — the plan calls for "map thẳng
// settings graphology-layout-forceatlas2", not d3-force's vocabulary. FA2 has no literal distance
// target between linked nodes, so "link distance" is UI shorthand for `slowDown` (how far nodes
// actually move per iteration, the closest FA2 has to a spacing knob).

export const FORCE_SLIDERS = [
  { key: 'gravity', label: 'Center (gravity)', min: 0, max: 5, step: 0.1 },
  { key: 'scalingRatio', label: 'Repel (scaling ratio)', min: 0.1, max: 20, step: 0.1 },
  { key: 'edgeWeightInfluence', label: 'Link force (edge weight influence)', min: 0, max: 3, step: 0.1 },
  { key: 'slowDown', label: 'Link distance (slow down)', min: 0.1, max: 10, step: 0.1 },
];

export const DEFAULT_FORCE_SETTINGS = Object.freeze({
  gravity: 1,
  scalingRatio: 1,
  edgeWeightInfluence: 1,
  slowDown: 1,
});

// barnesHutOptimize: true is not a slider — required at Global Graph scale (00-platform-core.md's
// renderer spike: FA2's default pairwise repulsion is O(n^2) per iteration and never finishes in
// reasonable time above a few thousand nodes; Barnes-Hut approximation makes it O(n log n)).
export function buildFA2Settings(sliderValues) {
  return { ...DEFAULT_FORCE_SETTINGS, ...sliderValues, barnesHutOptimize: true };
}
