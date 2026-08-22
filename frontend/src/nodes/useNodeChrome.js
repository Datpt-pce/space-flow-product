import { useState } from 'react';
import { useStore } from '../store.js';
import { resolveDropPaths } from '../lib/dropResolve.js';
import { resolveDynamicPorts } from '../lib/dynamicPorts.js';
import { getNodeIcon } from '../lib/nodeIcons.jsx';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';

// Trích từ BaseNode.jsx gốc — logic phi-hình-ảnh dùng chung cho BaseNodeLTS.jsx (giữ nguyên 100%,
// đóng băng) và BaseNodeBeta.jsx (bố cục mới). Không đổi bất kỳ phép tính nào ở đây so với bản gốc.

export const STATUS_COLORS = {
  running: '#f59e0b',
  done: '#22c55e',
  error: '#ef4444',
};

function getIncomingCount(nodeId, nodes, edges, nodeOutputs) {
  const inEdges = edges.filter(e => e.target === nodeId);
  let total = 0;
  for (const e of inEdges) {
    const outputs = nodeOutputs[e.source];
    if (outputs && outputs[e.sourceHandle] !== undefined) {
      const val = outputs[e.sourceHandle];
      if (Array.isArray(val)) total += val.length;
      else if (val !== null && val !== undefined) total += 1;
    } else {
      const srcNode = nodes.find(n => n.id === e.source);
      if (srcNode?.type === 'list') {
        total += (srcNode.data?.config?.files || []).length;
      } else if (srcNode?.type === 'text') {
        total += 1;
      }
    }
  }
  return total;
}

function countReachable(nodes, edges, startId) {
  // Mirrors backend/engine/executor.js run(): a single-node run now executes
  // ancestors (to supply real input) union descendants (existing "run from here"),
  // so the displayed count must include both directions, not just downstream.
  const adj = {};
  const revAdj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
    if (!revAdj[e.target]) revAdj[e.target] = [];
    revAdj[e.target].push(e.source);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of (adj[id] || [])) queue.push(next);
    for (const prev of (revAdj[id] || [])) queue.push(prev);
  }
  return visited.size;
}

export function useNodeChrome(id, data) {
  const { manifest } = data;
  const Icon = getNodeIcon(manifest.icon);
  const categoryColor = CATEGORY_COLORS[manifest.category] || '#6b7280';

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const nodeErrorInfo = useStore(s => s.nodeErrorInfo);
  const nodeProgress = useStore(s => s.nodeProgress);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const openNodeDetail = useStore(s => s.openNodeDetail);
  const duplicateNode = useStore(s => s.duplicateNode);
  const nodeActive = useStore(s => s.nodeActive);
  const nodePinnedData = useStore(s => s.nodePinnedData);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);

  const [isDragOver, setIsDragOver] = useState(false);

  // Node có field config kiểu "file" (vd. load-image) → thả file từ Explorer thẳng lên node để
  // set path thật, không upload. Field nào khai type "file" trong node.json tự động có drop-zone.
  const fileField = (manifest.config || []).find(f => f.type === 'file');

  const handleDragOver = (e) => {
    if (!fileField || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleFileDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!fileField || e.dataTransfer.types.includes('space-flow-file')) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const paths = await resolveDropPaths(e);
    if (paths && paths.length) updateNodeConfig(id, fileField.id, paths[0]);
  };

  const status = nodeStatuses[id] || 'idle';
  const isRunning = status === 'running';
  // continueOnFail: node lỗi nhưng workflow vẫn chạy tiếp → tô màu khác với lỗi dừng hẳn
  const errorContinued = status === 'error' && nodeErrorInfo[id]?.continued === true;
  const dotColor = status === 'error'
    ? (errorContinued ? '#f97316' : STATUS_COLORS.error)
    : STATUS_COLORS[status];
  const incomingCount = getIncomingCount(id, nodes, edges, nodeOutputs);
  // Merge/Switch (and any future node) opt into config-driven port count/labels via
  // node.json's dynamicInputs/dynamicOutputs — see frontend/src/lib/dynamicPorts.js.
  const inputs = resolveDynamicPorts(manifest.inputs || [], manifest.dynamicInputs, data.config);
  const outputs = resolveDynamicPorts(manifest.outputs || [], manifest.dynamicOutputs, data.config);
  const reachableCount = countReachable(nodes, edges, id);
  const isActive = nodeActive[id] !== false;
  const isPinned = !!nodePinnedData[id];

  const portRows = Math.max(inputs.length, outputs.length, 1);
  const defaultContentHeight = Math.max(80, portRows * 32 + 32);

  const handleDelete = () => deleteNode(id);

  return {
    manifest, Icon, categoryColor,
    status, isRunning, errorContinued, dotColor, progress: nodeProgress[id],
    incomingCount, inputs, outputs, reachableCount, isActive, isPinned,
    defaultContentHeight, nodesCount: nodes.length,
    isDragOver, handleDragOver, handleDragLeave, handleFileDrop,
    handleDelete, runWorkflow, selectNode, openNodeDetail, duplicateNode,
  };
}
