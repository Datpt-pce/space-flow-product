const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const runner = require('./runner');
const { NODES_DIR, getManifest } = require('../utils/nodeManifests');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

// Reverse of getReachableSubgraph: nodes startNodeId depends on (directly or
// transitively), so running a single downstream node also runs whatever upstream
// data it needs instead of silently receiving undefined inputs.
function getAncestors(nodes, edges, startNodeId) {
  const nodeIds = new Set(nodes.map(n => n.id));
  const revAdj = {};
  for (const e of (edges || [])) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!revAdj[e.target]) revAdj[e.target] = [];
    revAdj[e.target].push(e.source);
  }

  const reachable = new Set();
  const queue = [startNodeId];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const prev of (revAdj[id] || [])) queue.push(prev);
  }

  return {
    nodes: nodes.filter(n => reachable.has(n.id)),
    edges: (edges || []).filter(e => reachable.has(e.source) && reachable.has(e.target)),
  };
}

async function run(workflow, uploadsDir, send, startNodeId = null, resume = false, userId = null) {
  const { nodes, edges } = workflow;

  // When startNodeId is given, execute it plus everything downstream of it (existing
  // "run from here" behavior) UNION everything it depends on upstream (so a node
  // wired to e.g. a List node gets real input instead of undefined when run alone).
  let sub = null;
  if (startNodeId) {
    const descendants = getReachableSubgraph(nodes, edges, startNodeId);
    const ancestors = getAncestors(nodes, edges, startNodeId);
    const nodeIds = new Set([...descendants.nodes, ...ancestors.nodes].map(n => n.id));
    const edgeKeys = new Set();
    const mergedEdges = [];
    for (const e of [...descendants.edges, ...ancestors.edges]) {
      const key = `${e.source}->${e.target}->${e.targetHandle}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      mergedEdges.push(e);
    }
    sub = {
      nodes: nodes.filter(n => nodeIds.has(n.id)),
      edges: mergedEdges,
    };
  }
  const activeNodes = sub ? sub.nodes : nodes;
  const activeEdges = sub ? sub.edges : (edges || []);

  const order = topoSort(activeNodes, activeEdges);
  const nodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));
  const results = {};

  // Per-run scratch dir for throwaway intermediate files — created lazily via
  // context.scratchDir(), always cleaned up below regardless of success/failure.
  const runId = crypto.randomUUID();
  const scratchRoot = path.join(uploadsDir, '.scratch', runId);
  let scratchCreated = false;

  try {
    for (const nodeId of order) {
      const node = nodeMap[nodeId];
      const manifest = getManifest(node.type);
      if (!manifest) {
        throw new Error(`Unknown node type: ${node.type}`);
      }

      // Resolve inputs from upstream results. A target handle can have more than one
      // edge (e.g. several static Text nodes feeding 1 "System Prompt" port) — collect
      // all values per handle, flattening any array-valued source by one level so
      // multi-connect reads the same as "N items" would. A single edge still yields a
      // bare value (unchanged from before), keeping every existing 1-edge node wired.
      const inputGroups = {};
      const connectedInputPorts = new Set();
      for (const edge of activeEdges) {
        if (edge.target === nodeId) {
          connectedInputPorts.add(edge.targetHandle);
          const upstream = results[edge.source];
          if (upstream && upstream[edge.sourceHandle] !== undefined) {
            (inputGroups[edge.targetHandle] || (inputGroups[edge.targetHandle] = [])).push(upstream[edge.sourceHandle]);
          }
        }
      }
      const inputs = {};
      for (const [handle, values] of Object.entries(inputGroups)) {
        if (values.length === 1) {
          inputs[handle] = values[0];
        } else {
          inputs[handle] = values.flatMap(v => (Array.isArray(v) ? v : [v]));
        }
      }

      // Mock input (docs/product/node-spec/DISCUSSION.md mục 13, spec 06): only for
      // input ports with zero edges at all — a real connection always wins even if it
      // hasn't produced data yet. Priority: Pin > real Run Data > Mock > null.
      if (node.mockInput) {
        for (const port of (manifest.inputs || [])) {
          if (!connectedInputPorts.has(port.id) && node.mockInput[port.id] !== undefined) {
            inputs[port.id] = node.mockInput[port.id];
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
        resume,
        userId,
        log: (msg) => send('log', { nodeId, message: msg, level: 'debug' }),
        progress: (percent, message) => send('progress', { nodeId, percent, message }),
        rowResult: (data) => send('rowResult', { nodeId, ...data }),
        scratchDir: () => {
          if (!scratchCreated) {
            fs.mkdirSync(scratchRoot, { recursive: true });
            scratchCreated = true;
          }
          return scratchRoot;
        },
      };

      // Pinned data (spec 06): wins over everything else, including disable — node
      // itself never executes. Does not propagate backward: upstream nodes above still
      // ran normally this pass, only this node's own output is frozen.
      if (node.pinnedData) {
        results[nodeId] = node.pinnedData;
        send('nodeComplete', { nodeId, outputs: results[nodeId], pinned: true });
        continue;
      }

      // Disabled node (node.active === false): don't execute it at all — pass its
      // first input straight through to its first output, unchanged. Other declared
      // output ports stay absent (undefined downstream), matching "port never written".
      if (node.active === false) {
        const firstInputId = (manifest.inputs || [])[0]?.id;
        const firstOutputId = (manifest.outputs || [])[0]?.id;
        const passthroughValue = firstInputId ? inputs[firstInputId] : undefined;
        results[nodeId] = firstOutputId ? { [firstOutputId]: passthroughValue } : {};
        send('nodeComplete', { nodeId, outputs: results[nodeId], disabled: true });
        continue;
      }

      const executorPath = path.join(NODES_DIR, node.type, 'execute.js');
      if (!fs.existsSync(executorPath)) {
        throw new Error(`No executor found for node type: ${node.type}`);
      }

      const executeFn = require(executorPath);

      // retryOnFail (default off): total attempts = maxTries (default 2), only
      // the final attempt's error falls through to continueOnFail/error-port/throw.
      const maxTries = node.retryOnFail ? Math.max(1, node.maxTries || 2) : 1;
      const retryDelay = node.retryDelay || 1000;

      let output;
      let lastErr = null;
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        try {
          output = await executeFn(inputs, config, context);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < maxTries) {
            send('log', { nodeId, message: `Retry ${attempt}/${maxTries - 1} after error: ${err.message}`, level: 'warn' });
            await sleep(retryDelay);
          }
        }
      }

      if (lastErr) {
        if (node.continueOnFail) {
          send('nodeError', { nodeId, message: lastErr.message });
          const hasErrorPort = (manifest.outputs || []).some(o => o.id === 'error');
          results[nodeId] = hasErrorPort ? { error: { message: lastErr.message } } : {};
          continue;
        }
        throw lastErr;
      }

      results[nodeId] = output || {};

      send('nodeComplete', { nodeId, outputs: output });
    }
  } finally {
    if (scratchCreated) {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  return results;
}

module.exports = { run };
