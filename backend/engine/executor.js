const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const runner = require('./runner');
const { NODES_DIR, getManifest } = require('../utils/nodeManifests');
const { getInstallation, getApprovedPaths } = require('../registry/install');
const { runInIsolate, bundleExecutor } = require('../sandbox/js-runtime');
const { runPythonSandboxed } = require('../sandbox/py-runtime');
const { pyVendorDir } = require('../registry/dependencies');
const { assertNotBlocked } = require('../registry/revocation-check');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Custom Node Platform Phase 5 wiring (specs/space-flow-master-plan/01-custom-node-platform.md):
// a workflow node.type of "packageId@version" addresses a locally-installed registry package
// (backend/registry-installs/<packageId>/<version>/, see backend/registry/install.js) instead of
// a built-in nodes/<type>/. Built-in resolution (below) is completely unchanged for every
// existing node.type string, none of which contain "@".
const REGISTRY_PACKAGE_RE = /^([a-z0-9][a-z0-9-]{1,63})@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

// resolveNode(nodeType) -> { manifest, installPath } — installPath is null for a built-in node
// (unchanged path) and non-null for a registry package. manifest.name is aliased from Manifest
// v2's `displayName` so the rest of this file (which only ever reads manifest.name/inputs/
// outputs/config, both schema versions agree on those 4) doesn't need to know which shape it got.
function resolveNode(nodeType) {
  const match = nodeType.match(REGISTRY_PACKAGE_RE);
  if (!match) {
    return { manifest: getManifest(nodeType), installPath: null };
  }
  const [, packageId, version] = match;
  const installation = getInstallation(packageId, version);
  if (!installation) return { manifest: null, installPath: null };
  const manifestPath = path.join(installation.install_path, 'node.json');
  if (!fs.existsSync(manifestPath)) return { manifest: null, installPath: null };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.name = manifest.name || manifest.displayName;
  return { manifest, installPath: installation.install_path };
}

// Runs a registry package's entry file through the Phase 3 Sandbox Host runtimes instead of
// require()'ing it in-process. capabilityGrants come straight from the package's own
// self-declared manifest.capabilities — this is the "Local Private" trust lane (§2 of the plan):
// no server-side review/grant step exists yet (that's Phase 6's capability_grants table), so a
// locally-installed package gets exactly what it declared, same default-deny posture already
// enforced elsewhere in this sandbox (SSRF domain allowlist, secret-handle scoping).
//
// filesystem:"user-approved-path" reads whatever a user has explicitly approved for THIS
// package+version via PUT /api/local-nodes/installed/:packageId/:version/approved-paths
// (backend/registry/install.js's getApprovedPaths, backed by node_installations.approved_paths —
// empty by default, so a package nobody has approved anything for still gets a clear filesystem
// error instead of silent trust). JS packages don't get an equivalent bridge yet — the isolated-vm
// track has no `context`/fs bridge into the isolate at all (see js-runtime.js), so this only
// matters for the Python track today.
async function runRegistryPackage(manifest, installPath, inputs, config, context) {
  // Custom Node Platform Phase 8: revocation gate, checked before every real execution (a
  // package that was never submitted to the registry — a pure Local Private draft/install — has
  // no node_versions row and this is always a no-op for it, see revocation-check.js).
  assertNotBlocked(manifest.packageId, manifest.version, manifest);

  const capabilities = manifest.capabilities || {};
  const limits = manifest.limits || {};
  const entryPath = path.join(installPath, manifest.runtime.entry);

  if (manifest.runtime.type === 'javascript') {
    const bundleSource = bundleExecutor(entryPath);
    return runInIsolate({
      bundleSource,
      inputs,
      config,
      memoryLimitMB: limits.memoryMB,
      timeoutMs: limits.timeoutSeconds * 1000,
    });
  }

  if (manifest.runtime.type === 'python') {
    return runPythonSandboxed({
      scriptPath: entryPath,
      payload: { inputs, config },
      capabilityGrants: {
        network: capabilities.network || [],
        filesystem: capabilities.filesystem || 'none',
        approvedPaths: capabilities.filesystem === 'user-approved-path'
          ? getApprovedPaths(manifest.packageId, manifest.version)
          : [],
      },
      limits: {
        timeoutSeconds: limits.timeoutSeconds,
        memoryMB: limits.memoryMB,
      },
      scratchDir: context.scratchDir(),
      pythonPath: pyVendorDir(installPath),
    });
  }

  throw new Error(`Unsupported runtime.type "${manifest.runtime.type}" for package ${manifest.packageId}@${manifest.version}`);
}

async function invokeExecutor(node, manifest, installPath, inputs, config, context) {
  if (installPath) {
    return runRegistryPackage(manifest, installPath, inputs, config, context);
  }
  const executorPath = path.join(NODES_DIR, node.type, 'execute.js');
  if (!fs.existsSync(executorPath)) {
    throw new Error(`No executor found for node type: ${node.type}`);
  }
  const executeFn = require(executorPath);
  return executeFn(inputs, config, context);
}

// Node IDs currently mid-execution across ALL in-flight run() calls in this process —
// lets 2 disjoint chains (e.g. A->B and C->D) run genuinely concurrently while rejecting
// a 2nd run that would touch a node another run already owns (would race on `results`).
const busyNodeIds = new Set();

// Node types whose execute.js writes to shared paths not scoped by nodeId (fixed
// uploadsDir-root filenames keyed only by Date.now(), or — for capcut-generate — a
// TOCTOU-prone project-folder name scan) — see docs/issues/2026-08-26-scratch-dir-shared-across-nodes.md.
// Forced to run exclusively (never concurrently with any other node in the same run)
// until each is fixed individually; every other node type is free to run in parallel.
const EXCLUSIVE_NODE_TYPES = new Set(['edit-image', 'convert-to-file', 'compression', 'capcut-generate']);

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

  const conflict = activeNodes.find(n => busyNodeIds.has(n.id));
  if (conflict) {
    throw new Error(`Node "${conflict.id}" đang được một tiến trình khác chạy, đợi nó xong rồi thử lại.`);
  }
  for (const n of activeNodes) busyNodeIds.add(n.id);

  topoSort(activeNodes, activeEdges); // validates the graph is acyclic; throws otherwise
  const nodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));
  const results = {};

  // Per-run scratch root for throwaway intermediate files. Each node gets its own
  // subdirectory (scoped by nodeId, created lazily via context.scratchDir()) so sibling
  // nodes running concurrently never share filenames; the whole tree is cleaned up below.
  const runId = crypto.randomUUID();
  const scratchRoot = path.join(uploadsDir, '.scratch', runId);

  // Dependency-driven scheduler: a node becomes eligible to run as soon as every node
  // it depends on has finished, not "when its turn in a fixed order comes up" — so 2
  // independent branches fed by the same upstream node (e.g. a List fanning out to 2
  // unrelated downstream nodes) start together and actually run concurrently.
  const inDegree = {};
  const adj = {};
  for (const n of activeNodes) {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  }
  for (const e of activeEdges) {
    inDegree[e.target]++;
    adj[e.source].push(e.target);
  }

  async function runNode(nodeId) {
    const node = nodeMap[nodeId];
    const { manifest, installPath } = resolveNode(node.type);
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
      // Scoped by nodeId (not shared per-run) so 2 sibling nodes running concurrently
      // never write into the same directory.
      scratchDir: () => {
        const dir = path.join(scratchRoot, nodeId);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      },
    };

    // Pinned data (spec 06): wins over everything else, including disable — node
    // itself never executes. Does not propagate backward: upstream nodes above still
    // ran normally this pass, only this node's own output is frozen.
    if (node.pinnedData) {
      results[nodeId] = node.pinnedData;
      send('nodeComplete', { nodeId, outputs: results[nodeId], pinned: true });
      return;
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
      return;
    }

    // retryOnFail (default off): total attempts = maxTries (default 2), only
    // the final attempt's error falls through to continueOnFail/error-port/throw.
    const maxTries = node.retryOnFail ? Math.max(1, node.maxTries || 2) : 1;
    const retryDelay = node.retryDelay || 1000;

    let output;
    let outputWarnings = [];
    let lastErr = null;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      try {
        output = await invokeExecutor(node, manifest, installPath, inputs, config, context);
        // Part of the same attempt as executeFn() itself — a maxOutputMB violation is an
        // execution failure like any other and should get the same retry/continueOnFail
        // treatment, not a separate code path. See runner.js's validateOutput() for why
        // missing-port mismatches are warnings here while maxOutputMB throws.
        outputWarnings = runner.validateOutput(output, manifest).warnings;
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
        return;
      }
      throw lastErr;
    }

    for (const warning of outputWarnings) {
      send('log', { nodeId, message: warning, level: 'warn' });
    }

    results[nodeId] = output || {};

    send('nodeComplete', { nodeId, outputs: output });
  }

  // Dispatch loop: starts every ready-and-not-yet-started node it's allowed to, respecting
  // EXCLUSIVE_NODE_TYPES (an exclusive node only starts when nothing else is running, and
  // blocks anything else from starting while it runs). Re-entered after each node settles
  // (a dependent may have just become ready, or the exclusive "floor" may have freed up).
  const ready = new Set(activeNodes.filter(n => inDegree[n.id] === 0).map(n => n.id));
  const started = new Set();
  const pending = [];
  let runningCount = 0;
  let exclusiveRunning = false;
  let aborted = false;
  let abortError = null;

  function dispatch() {
    if (aborted) return;
    for (const nodeId of ready) {
      const isExclusive = EXCLUSIVE_NODE_TYPES.has(nodeMap[nodeId].type);
      if (exclusiveRunning) continue;
      if (isExclusive && runningCount > 0) continue;
      ready.delete(nodeId);
      started.add(nodeId);
      runningCount++;
      if (isExclusive) exclusiveRunning = true;
      const p = runNode(nodeId)
        .then(() => {
          runningCount--;
          if (isExclusive) exclusiveRunning = false;
          for (const next of adj[nodeId]) {
            if (--inDegree[next] === 0) ready.add(next);
          }
          dispatch();
        })
        .catch(err => {
          runningCount--;
          if (isExclusive) exclusiveRunning = false;
          if (!aborted) { aborted = true; abortError = err; }
        });
      pending.push(p);
    }
  }

  try {
    dispatch();
    // Drains as more promises get pushed onto `pending` from within dispatch() above —
    // once aborted, dispatch() stops starting new nodes, so this converges. Waiting out
    // already-in-flight siblings (rather than rejecting the instant one fails) means the
    // scratch-dir cleanup below never races a sibling still writing into it.
    for (let i = 0; i < pending.length; i++) {
      await pending[i];
    }
    if (aborted) throw abortError;
  } finally {
    for (const n of activeNodes) busyNodeIds.delete(n.id);
    if (fs.existsSync(scratchRoot)) {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  return results;
}

function isBusy() {
  return busyNodeIds.size > 0;
}

module.exports = { run, isBusy, runRegistryPackage };
