const path = require('path');
const fs = require('fs');
const runner = require('./runner');

const NODES_DIR = path.join(__dirname, '..', '..', 'nodes');

function topoSort(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const inDegree = Object.fromEntries(ids.map(id => [id, 0]));
  const adj = Object.fromEntries(ids.map(id => [id, []]));

  for (const e of edges) {
    if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    if (adj[e.source]) adj[e.source].push(e.target);
  }

  const queue = ids.filter(id => inDegree[id] === 0);
  const sorted = [];

  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const next of adj[id]) {
      if (--inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length !== ids.length) {
    throw new Error('Cycle detected in workflow graph');
  }

  return sorted;
}

function getReachableSubgraph(nodes, edges, startNodeId) {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = {};
  for (const e of (edges || [])) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }

  const reachable = new Set();
  const queue = [startNodeId];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of (adj[id] || [])) queue.push(next);
  }

  return {
    nodes: nodes.filter(n => reachable.has(n.id)),
    edges: (edges || []).filter(e => reachable.has(e.source) && reachable.has(e.target)),
  };
}

async function run(workflow, uploadsDir, send, startNodeId = null) {
  const { nodes, edges } = workflow;

  // When startNodeId is given, only execute nodes reachable from it
  const sub = startNodeId ? getReachableSubgraph(nodes, edges, startNodeId) : null;
  const activeNodes = sub ? sub.nodes : nodes;
  const activeEdges = sub ? sub.edges : (edges || []);

  const order = topoSort(activeNodes, activeEdges);
  const nodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));
  const results = {};

  for (const nodeId of order) {
    const node = nodeMap[nodeId];
    const manifestPath = path.join(NODES_DIR, node.type, 'node.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Unknown node type: ${node.type}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Resolve inputs from upstream results
    const inputs = {};
    for (const edge of activeEdges) {
      if (edge.target === nodeId) {
        const upstream = results[edge.source];
        if (upstream && upstream[edge.sourceHandle] !== undefined) {
          inputs[edge.targetHandle] = upstream[edge.sourceHandle];
        }
      }
    }

    // Merge config: defaults from node.json → overrides from workflow node
    const configDefaults = Object.fromEntries(
      (manifest.config || []).filter(f => f.default !== undefined).map(f => [f.id, f.default])
    );
    const config = { ...configDefaults, ...(node.config || {}) };

    send('log', { nodeId, message: `Running ${manifest.name}...`, level: 'info' });

    const context = {
      uploadsDir,
      nodeId,
      log: (msg) => send('log', { nodeId, message: msg, level: 'debug' }),
      progress: (percent, message) => send('progress', { nodeId, percent, message }),
      rowResult: (data) => send('rowResult', { nodeId, ...data }),
    };

    const executorPath = path.join(NODES_DIR, node.type, 'execute.js');
    if (!fs.existsSync(executorPath)) {
      throw new Error(`No executor found for node type: ${node.type}`);
    }

    const executeFn = require(executorPath);
    const output = await executeFn(inputs, config, context);
    results[nodeId] = output || {};

    send('nodeComplete', { nodeId, outputs: output });
  }

  return results;
}

module.exports = { run };
