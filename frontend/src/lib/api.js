export async function fetchNodes() {
  const res = await fetch('/api/nodes');
  return res.json();
}

export async function fetchWorkflows() {
  const res = await fetch('/api/workflows');
  return res.json();
}

export async function saveWorkflow(id, data) {
  await fetch(`/api/workflows/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function loadWorkflow(id) {
  const res = await fetch(`/api/workflows/${id}`);
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

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { resolve(); return; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim();
              const dataLine = lines[i + 1] || '';
              if (dataLine.startsWith('data: ')) {
                try {
                  onEvent(eventType, JSON.parse(dataLine.slice(6)));
                } catch {}
              }
            }
          }
          read();
        }).catch(reject);
      }
      read();
    }).catch(reject);
  });
}

export function executeWorkflow(workflow, onEvent, startNodeId = null) {
  return readEventStream(
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow, startNodeId }),
    }),
    onEvent
  );
}
