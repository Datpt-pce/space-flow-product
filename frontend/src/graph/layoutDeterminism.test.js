// Graph Library Phase 9 (specs/space-flow-master-plan/02-graph-library.md): "layout determinism
// tolerance" — 2 runs seeded identically must settle within a small tolerance of each other. Uses
// the REAL 20k-node/50k-edge fixture (src/graph/spike/dataset-20k-50k.json, already built for
// Phase 3/9 — see that file's generate-dataset.js header) and the SYNC forceatlas2 algorithm
// directly (no Worker/DOM needed — the worker build runs the exact same algorithm off-thread; this
// tests the algorithm's own determinism property, not the postMessage plumbing around it).
//
// Run with: node frontend/src/graph/layoutDeterminism.test.js (~10-15s — full 20k/50k FA2 pass x2)

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'spike', 'dataset-20k-50k.json');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

// mulberry32 — same tiny deterministic PRNG as generate-dataset.js, used here only to seed
// STARTING positions identically across both runs (FA2 itself has no internal randomness once
// positions are fixed — the only non-determinism a caller could introduce is the starting scatter).
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeededGraph(data, seed) {
  const rand = mulberry32(seed);
  const graph = new Graph();
  for (const n of data.nodes) graph.addNode(n.id, { x: rand(), y: rand() });
  for (const e of data.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      graph.addEdge(e.source, e.target);
    }
  }
  return graph;
}

function main() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    console.error(`FAIL — fixture dataset missing: ${FIXTURE_PATH} (run generate-dataset.js first)`);
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const FA2_SETTINGS = { barnesHutOptimize: true, gravity: 1, scalingRatio: 1, edgeWeightInfluence: 1, slowDown: 1 };
  const ITERATIONS = 50;
  const SEED = 0xC0FFEE;

  check(`FA2 (50 iterations, ${data.nodes.length} node / ${data.edges.length} edge fixture, cùng seed) — 2 lần chạy lệch trong dung sai`, () => {
    const graphA = buildSeededGraph(data, SEED);
    const graphB = buildSeededGraph(data, SEED);

    forceAtlas2.assign(graphA, { iterations: ITERATIONS, settings: FA2_SETTINGS });
    forceAtlas2.assign(graphB, { iterations: ITERATIONS, settings: FA2_SETTINGS });

    // Bounding-box diagonal as the distance scale — tolerance is relative to how spread out the
    // layout actually is, not an absolute pixel number that means nothing without that context.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graphA.forEachNode((_, attrs) => {
      minX = Math.min(minX, attrs.x); maxX = Math.max(maxX, attrs.x);
      minY = Math.min(minY, attrs.y); maxY = Math.max(maxY, attrs.y);
    });
    const scale = Math.hypot(maxX - minX, maxY - minY);
    const TOLERANCE_RATIO = 0.01; // 1% of the layout's own spread

    let maxDelta = 0;
    let sumDelta = 0;
    let count = 0;
    graphA.forEachNode((id, attrsA) => {
      const attrsB = graphB.getNodeAttributes(id);
      const delta = Math.hypot(attrsA.x - attrsB.x, attrsA.y - attrsB.y);
      maxDelta = Math.max(maxDelta, delta);
      sumDelta += delta;
      count++;
    });
    const avgDelta = sumDelta / count;

    console.log(`    scale=${scale.toFixed(2)} avgDelta=${avgDelta.toFixed(4)} maxDelta=${maxDelta.toFixed(4)} tolerance=${(scale * TOLERANCE_RATIO).toFixed(4)}`);
    assert.ok(
      avgDelta <= scale * TOLERANCE_RATIO,
      `avgDelta ${avgDelta.toFixed(4)} vượt quá ${TOLERANCE_RATIO * 100}% của scale ${scale.toFixed(4)} — layout không deterministic trong dung sai`
    );
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
