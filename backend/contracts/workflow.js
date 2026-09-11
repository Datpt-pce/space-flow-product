function invalid(message, status = 400, code = 'INVALID_WORKFLOW') {
  return Object.assign(new Error(message), { status, code });
}
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_@.+-]{0,199}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
function parseWorkflow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw invalid('Workflow requires nodes and edges arrays');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw invalid('Unsupported workflow schemaVersion', 400, 'UNSUPPORTED_SCHEMA_VERSION');
  if (value.nodes.length > 1000 || value.edges.length > 5000 || Buffer.byteLength(JSON.stringify(value)) > 10 * 1024 * 1024) throw invalid('Workflow exceeds admission limits', 413, 'WORKFLOW_TOO_LARGE');
  const ids = new Set();
  for (const node of value.nodes) {
    if (!node || !validId(node.id) || ids.has(node.id) || typeof node.type !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_@.+-]{0,160}$/.test(node.type)) throw invalid('Invalid or duplicate workflow node');
    if (node.config !== undefined && (!node.config || typeof node.config !== 'object' || Array.isArray(node.config))) throw invalid('Node config must be an object');
    ids.add(node.id);
  }
  const degree = new Map([...ids].map(id => [id, 0]));
  const edges = new Map([...ids].map(id => [id, []]));
  for (const edge of value.edges) {
    if (!edge || !ids.has(edge.source) || !ids.has(edge.target) || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string') throw invalid('Invalid workflow edge');
    degree.set(edge.target, degree.get(edge.target) + 1); edges.get(edge.source).push(edge.target);
  }
  const queue = [...ids].filter(id => degree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) for (const target of edges.get(queue[i])) {
    degree.set(target, degree.get(target) - 1); if (degree.get(target) === 0) queue.push(target);
  }
  if (queue.length !== ids.size) throw invalid('Cycle detected in workflow graph');
  return value;
}
function authorize(workflow, user, db) {
  if (!user || user.status === 'rejected' || user.status === 'pending') throw invalid('Account not active', 403, 'FORBIDDEN');
  if (user.role === 'admin') return;
  const allowed = new Set(db.prepare('SELECT node_type FROM user_node_permissions WHERE user_id = ?').all(user.id).map(row => row.node_type));
  if (workflow.nodes.some(node => !allowed.has(node.type))) throw invalid('Node permission required', 403, 'FORBIDDEN');
}
function parseDocument(value) {
  if (value?.version === 2) {
    if (!Array.isArray(value.pages) || value.pages.length > 100 || Buffer.byteLength(JSON.stringify(value)) > 10 * 1024 * 1024) throw invalid('Invalid workflow pages');
    const ids = new Set();
    for (const page of value.pages) {
      if (!page || !validId(page.id) || ids.has(page.id)) throw invalid('Invalid or duplicate workflow page');
      ids.add(page.id); parseWorkflow({ nodes: page.nodes, edges: page.edges });
    }
    return value;
  }
  if (value?.version !== undefined && value.version !== 1) throw invalid('Unsupported workflow document version');
  return parseWorkflow(value);
}
module.exports = { parseWorkflow, parseDocument, authorize, invalid, validId };
