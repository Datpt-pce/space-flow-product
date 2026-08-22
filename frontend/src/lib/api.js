export async function fetchAuthConfig() {
  const res = await fetch('/api/auth/config');
  return res.json();
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function loginWithGoogle(idToken) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Đăng nhập thất bại');
  }
  const data = await res.json();
  return data.user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchUsers() {
  const res = await fetch('/api/users');
  return res.json();
}

export async function updateUserRole(id, role) {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  return res.json();
}

export async function updateUserStatus(id, status) {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export async function fetchUserPermissions(id) {
  const res = await fetch(`/api/users/${id}/permissions`);
  return res.json();
}

export async function saveUserPermissions(id, { nodeTypes, credentialNames }) {
  const res = await fetch(`/api/users/${id}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeTypes, credentialNames }),
  });
  return res.json();
}

export async function fetchUsageStats() {
  const res = await fetch('/api/users/usage-stats');
  return res.json();
}

// Agent pairing (specs/hosted-deployment-and-local-agent.md Phase D) — each user pairs at most
// 1 agent (their own machine) for node runsOn:"local" (CapCut, ComfyUI-local...).
export async function fetchMyAgents() {
  const res = await fetch('/api/agents');
  return res.json();
}

export async function createAgent(name) {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo agent thất bại');
  return data; // { id, agentToken } — agentToken only ever returned here
}

export async function deleteAgent(id) {
  const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchNodes() {
  const res = await fetch('/api/nodes');
  return res.json();
}

export async function fetchWorkflows() {
  const res = await fetch('/api/workflows');
  return res.json();
}

export async function createWorkflow(name, visibility, payload) {
  const res = await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, visibility, payload }),
  });
  return res.json();
}

export async function updateWorkflow(id, fields) {
  const res = await fetch(`/api/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}

export async function loadWorkflow(id) {
  const res = await fetch(`/api/workflows/${id}`);
  return res.json();
}

export async function deleteWorkflowFromLibrary(id) {
  const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  return res.json();
}

export async function cleanupFiles(referencedPaths) {
  await fetch('/api/files/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referencedPaths }),
  });
}

export async function openFolder(filePath) {
  const res = await fetch('/api/files/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  return res.json();
}

export async function browseFolder() {
  const res = await fetch('/api/files/browse-folder', { method: 'POST' });
  return res.json();
}

export async function browseFile(filter) {
  const res = await fetch('/api/files/browse-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter }),
  });
  return res.json();
}

export async function listDir(root, dir, filter) {
  const params = new URLSearchParams();
  if (root) params.set('root', root);
  if (dir) params.set('dir', dir);
  if (filter) params.set('filter', filter);
  const res = await fetch(`/api/files/list-dir?${params}`);
  return res.json();
}

export function previewUrl(filePath) {
  return `/api/files/preview?path=${encodeURIComponent(filePath)}`;
}

export async function resolveDrop(names, items) {
  const body = items ? { names, items } : { names };
  const res = await fetch('/api/files/resolve-drop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function fetchVideoMetadata(url) {
  const res = await fetch('/api/video/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export async function restartCapcut() {
  const res = await fetch('/api/capcut/restart', { method: 'POST' });
  return res.json();
}

export async function downloadZip(files) {
  const res = await fetch('/api/files/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'space-flow-export.zip';
  a.click();
  URL.revokeObjectURL(url);
}

// ---- resize-upload node: settings, app catalog, live Asana/GCS/UNC actions ----
export async function fetchResizeUploadSettings() {
  const res = await fetch('/api/resize-upload/settings');
  return res.json();
}

export async function saveResizeUploadSettings(settings) {
  const res = await fetch('/api/resize-upload/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function fetchResizeUploadApps() {
  const res = await fetch('/api/resize-upload/apps');
  return res.json();
}

export async function saveResizeUploadApp(app) {
  const res = await fetch('/api/resize-upload/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(app),
  });
  return res.json();
}

export async function deleteResizeUploadApp(tag) {
  const res = await fetch(`/api/resize-upload/apps/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  return res.json();
}

function postResizeUploadAction(action, body) {
  return fetch(`/api/resize-upload/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(res => res.json());
}

export const asanaTest = (pat) => postResizeUploadAction('asana/test', { pat });
export const asanaTasks = (pat) => postResizeUploadAction('asana/tasks', { pat });
export const asanaInspect = (pat, task_url) => postResizeUploadAction('asana/inspect', { pat, task_url });
export const asanaAutoGid = (pat, task_url) => postResizeUploadAction('asana/auto-gid', { pat, task_url });
export const gcsTest = (bucket, creds_json_path) => postResizeUploadAction('gcs/test', { bucket, creds_json_path });
export const uncTest = (folder) => postResizeUploadAction('unc/test', { folder });

export const loadResizeUploadCredentials = (config_path, links_path) =>
  postResizeUploadAction('load-credentials', { config_path, links_path });

export async function fetchResizeUploadLastSession() {
  const res = await fetch('/api/resize-upload/last-session');
  return res.json();
}

export async function saveResizeUploadLastSession(config) {
  const res = await fetch('/api/resize-upload/last-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export function runResizeUploadNms(config, mode, onEvent) {
  return readEventStream(
    fetch('/api/resize-upload/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, mode }),
    }),
    onEvent
  );
}

export function runResizeUploadV2Nms(config, mode, onEvent) {
  return readEventStream(
    fetch('/api/resize-upload-v2/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, mode }),
    }),
    onEvent
  );
}

export async function fetchResizeUploadV2LastSession() {
  const res = await fetch('/api/resize-upload-v2/last-session');
  return res.json();
}

export async function saveResizeUploadV2LastSession(config) {
  const res = await fetch('/api/resize-upload-v2/last-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function fetchSystemStatus() {
  const res = await fetch('/api/system/status');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không lấy được trạng thái hệ thống');
  return data;
}

export async function fetchCredentials() {
  const res = await fetch('/api/credentials');
  return res.json();
}

export async function saveCredential(name, type, data, scope = 'private') {
  const res = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, data, scope }),
  });
  return res.json();
}

export async function deleteCredential(name, scope = 'private') {
  const res = await fetch(`/api/credentials/${encodeURIComponent(name)}?scope=${scope}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchLocalServices() {
  const res = await fetch('/api/local-services');
  return res.json();
}

export async function saveLocalService(name, baseUrl) {
  const res = await fetch('/api/local-services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, baseUrl }),
  });
  return res.json();
}

export async function deleteLocalService(name) {
  const res = await fetch(`/api/local-services/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return res.json();
}

export function updateDependencies(onEvent) {
  return readEventStream(
    fetch('/api/system/update-deps', { method: 'POST' }),
    onEvent
  );
}

function readEventStream(fetchPromise, onEvent) {
  return new Promise((resolve, reject) => {
    fetchPromise.then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // SSE records are separated by a blank line ("\n\n"). Only parse a
      // record once it's fully buffered — a network chunk can split an
      // "event: X\n" / "data: Y\n\n" pair across two reads, and processing
      // the event line before its data line arrives silently drops it.
      function processBuffer() {
        let sepIndex;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const record = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          let eventType = null;
          let dataLine = null;
          for (const line of record.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataLine = line.slice(6);
          }
          if (eventType && dataLine != null) {
            try {
              onEvent(eventType, JSON.parse(dataLine));
            } catch {}
          }
        }
      }

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { processBuffer(); resolve(); return; }
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
          read();
        }).catch(reject);
      }
      read();
    }).catch(reject);
  });
}

export function executeWorkflow(workflow, onEvent, startNodeId = null, resume = false) {
  return readEventStream(
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow, startNodeId, resume }),
    }),
    onEvent
  );
}

export async function activateSchedule(triggerNodeId, workflow, intervalSeconds) {
  const res = await fetch(`/api/schedule/${triggerNodeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, intervalSeconds }),
  });
  return res.json();
}

export async function deactivateSchedule(triggerNodeId) {
  const res = await fetch(`/api/schedule/${triggerNodeId}`, { method: 'DELETE' });
  return res.json();
}
