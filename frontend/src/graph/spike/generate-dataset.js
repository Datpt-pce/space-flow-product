// Synthetic dataset generator for the Graph renderer spike — Platform Core Phase 0.3
// (specs/space-flow-master-plan/00-platform-core.md), informing Graph Library Phase 3
// (specs/space-flow-master-plan/02-graph-library.md).
//
// Mimics the real skew called out in 02-graph-library.md §2: a handful of `node_package`
// entities (built-in nodes like "set"/"filter") are reused by a very large number of
// workflows/node_instances — a small set of very-high-degree hubs, not a uniform random
// graph. Deterministic (fixed seed) so this fixture is stable across runs — see Phase 9
// requirement "fixture dataset 20k/50k cố định trong repo test (không random mỗi lần)".
//
// Run with: node src/graph/spike/generate-dataset.js
// Writes src/graph/spike/dataset-20k-50k.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NODE_COUNT = 20000;
const EDGE_COUNT = 50000;
const HUB_COUNT = 40; // small number of node_package "hub" entities reused everywhere
const SEED = 0xC0FFEE;

// mulberry32 — tiny deterministic PRNG, no new dependency needed for a fixture generator.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const randInt = (max) => Math.floor(rand() * max);

function buildDataset() {
  const nodes = [];
  const edges = [];

  // Hubs: node_package entities (built-in node types), high degree by construction.
  for (let i = 0; i < HUB_COUNT; i++) {
    nodes.push({ id: `node_package:hub-${i}`, type: 'node_package', label: `hub-node-type-${i}` });
  }

  // Remaining nodes: workflow / node_instance / user, matching entity ID scheme
  // (docs/decisions/0009-entity-id-scheme.md).
  const remaining = NODE_COUNT - HUB_COUNT;
  const workflowCount = Math.floor(remaining * 0.3);
  const nodeInstanceCount = Math.floor(remaining * 0.65);
  const userCount = remaining - workflowCount - nodeInstanceCount;

  for (let i = 0; i < workflowCount; i++) {
    nodes.push({ id: `workflow:wf-${i}`, type: 'workflow', label: `Workflow ${i}` });
  }
  for (let i = 0; i < nodeInstanceCount; i++) {
    const wf = randInt(workflowCount);
    nodes.push({ id: `node_instance:wf-${wf}:ni-${i}`, type: 'node_instance', label: `Node ${i}` });
  }
  for (let i = 0; i < userCount; i++) {
    nodes.push({ id: `user:u-${i}`, type: 'user', label: `User ${i}` });
  }

  const nodeIds = nodes.map((n) => n.id);
  const nodeInstanceIds = nodes.filter((n) => n.type === 'node_instance').map((n) => n.id);
  const hubIds = nodes.filter((n) => n.type === 'node_package').map((n) => n.id);

  // 60% of edges: node_instance --uses--> hub (this is what produces the high-degree hubs).
  const hubEdgeCount = Math.floor(EDGE_COUNT * 0.6);
  for (let i = 0; i < hubEdgeCount; i++) {
    const source = nodeInstanceIds[randInt(nodeInstanceIds.length)];
    const target = hubIds[randInt(hubIds.length)];
    edges.push({ id: `e-${edges.length}`, source, target, relation: 'uses' });
  }

  // Remaining 40%: generic low-degree edges among any two nodes (contains/references-ish).
  while (edges.length < EDGE_COUNT) {
    const source = nodeIds[randInt(nodeIds.length)];
    const target = nodeIds[randInt(nodeIds.length)];
    if (source === target) continue;
    edges.push({ id: `e-${edges.length}`, source, target, relation: 'contains' });
  }

  return { nodes, edges };
}

const dataset = buildDataset();
const outPath = path.join(__dirname, 'dataset-20k-50k.json');
fs.writeFileSync(outPath, JSON.stringify(dataset));
console.log(`Wrote ${dataset.nodes.length} nodes / ${dataset.edges.length} edges to ${outPath}`);

const degree = {};
for (const e of dataset.edges) {
  degree[e.source] = (degree[e.source] || 0) + 1;
  degree[e.target] = (degree[e.target] || 0) + 1;
}
const maxDegree = Math.max(...Object.values(degree));
const hubDegrees = dataset.nodes.filter((n) => n.type === 'node_package').map((n) => degree[n.id] || 0);
console.log(`Max degree: ${maxDegree}; hub node_package degree range: ${Math.min(...hubDegrees)}-${Math.max(...hubDegrees)}`);
