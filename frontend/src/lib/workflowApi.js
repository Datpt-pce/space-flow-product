import { apiFetch } from './transport';

const workflowEtags = new Map();
export async function fetchWorkflows() {
  const res = await apiFetch('/api/workflows');
  return res.json();
}

export async function createWorkflow(name, visibility, payload) {
  const res = await apiFetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, visibility, payload }),
  });
  const data = await res.json();
  if (res.ok && res.headers.get('etag')) workflowEtags.set(data.id, res.headers.get('etag'));
  return data;
}

export async function updateWorkflow(id, fields) {
  const res = await apiFetch(`/api/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(workflowEtags.has(id) ? { 'If-Match': workflowEtags.get(id) } : {}) },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (res.ok && res.headers.get('etag')) workflowEtags.set(id, res.headers.get('etag'));
  return data;
}

export async function loadWorkflow(id) {
  const res = await apiFetch(`/api/workflows/${id}`);
  if (res.ok && res.headers.get('etag')) workflowEtags.set(id, res.headers.get('etag'));
  return res.json();
}

export async function deleteWorkflowFromLibrary(id) {
  const res = await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' });
  return res.json();
}

