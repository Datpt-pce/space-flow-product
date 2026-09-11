// Graph renderer spike — Platform Core Phase 0.3 (specs/space-flow-master-plan/00-platform-core.md),
// informing Graph Library Phase 3 (specs/space-flow-master-plan/02-graph-library.md). Not a real
// UI — loads the synthetic 20k/50k fixture (generate-dataset.js), runs ForceAtlas2 on the main
// thread once (timing feeds the Phase 9 worker-vs-main-thread decision), then runs a scripted
// pan/zoom camera animation while measuring real frame times via requestAnimationFrame. Exposes
// window.__spikeResult / window.__spikeDone for the Playwright driver (measure.mjs) to read.

import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

async function main() {
  const params = new URLSearchParams(location.search);
  const lod = params.get('lod') !== '0'; // default: LOD on

  const res = await fetch('./dataset-20k-50k.json');
  const data = await res.json();

  const graph = new Graph();
  for (const n of data.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      size: n.type === 'node_package' ? 8 : 2,
      color: n.type === 'node_package' ? '#e74c3c' : n.type === 'workflow' ? '#3498db' : '#95a5a6',
      x: Math.random(),
      y: Math.random(),
    });
  }
  for (const e of data.edges) {
    if (!graph.hasEdge(e.source, e.target)) graph.addEdge(e.source, e.target);
  }

  // ForceAtlas2 on the main thread — timing is the Phase 9 input for "does this block the
  // main thread badly enough to need graphology-layout-forceatlas2/worker".
  // barnesHutOptimize is NOT optional at this node count: FA2's default pairwise repulsion
  // is O(n^2) per iteration (~4*10^8 ops/iteration at 20k nodes) and never finishes in
  // reasonable time; Barnes-Hut approximation makes it O(n log n).
  console.log('fa2:start');
  const fa2Start = performance.now();
  forceAtlas2.assign(graph, { iterations: 50, settings: { barnesHutOptimize: true } });
  const fa2DurationMs = performance.now() - fa2Start;
  console.log(`fa2:done ${fa2DurationMs}ms`);

  const container = document.getElementById('container');
  const renderer = new Sigma(graph, container, lod ? {
    labelRenderedSizeThreshold: 12,
    hideLabelsOnMove: true,
    hideEdgesOnMove: true,
  } : {
    labelRenderedSizeThreshold: 0,
    hideLabelsOnMove: false,
    hideEdgesOnMove: false,
  });

  const frameTimes = [];
  let lastTime = performance.now();
  let rafId = requestAnimationFrame(function measureFrame(t) {
    frameTimes.push(t - lastTime);
    lastTime = t;
    rafId = requestAnimationFrame(measureFrame);
  });

  const camera = renderer.getCamera();
  const duration = 4000;
  const start = performance.now();

  function animate() {
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / duration, 1);
    camera.setState({
      x: 0.5 + 0.3 * Math.sin(t * Math.PI * 2),
      y: 0.5 + 0.3 * Math.cos(t * Math.PI * 2),
      ratio: 0.3 + 1.2 * Math.abs(Math.sin(t * Math.PI * 3)),
    });
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(rafId);
      finish();
    }
  }
  requestAnimationFrame(animate);

  function finish() {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    window.__spikeResult = {
      lod,
      nodeCount: graph.order,
      edgeCount: graph.size,
      fa2DurationMs: Math.round(fa2DurationMs),
      frameCount: frameTimes.length,
      frameTimeAvgMs: Math.round(avgMs * 100) / 100,
      frameTimeP50Ms: Math.round(pct(0.5) * 100) / 100,
      frameTimeP95Ms: Math.round(pct(0.95) * 100) / 100,
      avgFps: Math.round((1000 / avgMs) * 10) / 10,
    };
    window.__spikeDone = true;
  }
}

main().catch((err) => {
  window.__spikeError = err.message + '\n' + err.stack;
  window.__spikeDone = true;
});
