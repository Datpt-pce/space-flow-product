// CSRF double-submit cookie (backend/middleware/csrf.js): mọi request non-GET tự gắn header
// X-CSRF-Token từ cookie sf_csrf (không httpOnly, đọc được từ document.cookie).
function getCsrfToken() {
  const m = document.cookie.match(/(?:^|; )sf_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    options = { ...options, headers: { ...options.headers, 'X-CSRF-Token': getCsrfToken() } };
  }
  return fetch(url, options);
}

export async function videoCapcutRequest(path, body) {
  const res = await apiFetch(`/api/video-capcut${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không kết nối được với CapCut');
  return data;
}

export async function uploadVideoMedia(file) {
  const body = new FormData(); body.append('file', file);
  const response = await apiFetch('/api/video-assets/upload', { method: 'POST', body });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Import thất bại');
  return data;
}

export async function fetchSystemFonts() {
  const response = await apiFetch('/api/video-assets/system-fonts');
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Không đọc được font máy hiện tại');
  return data.families;
}

export async function videoAssetUsage(ids, expectedUsage) {
  const response = await apiFetch(`/api/video-assets/${expectedUsage ? 'remove-from-bin' : 'usage'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, expectedUsage }),
  });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Không cập nhật được media');
  return data;
}

export async function videoWorkspaceRequest(path = '', body, method) {
  const response = await apiFetch(`/api/video-projects${path}`, body === undefined ? {} : {
    method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Không cập nhật được project');
  return data;
}

export async function fetchVideoWaveform(assetId) {
  const response = await apiFetch(`/api/video-assets/${encodeURIComponent(assetId)}/waveform`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Không đọc được sóng âm.');
  return result;
}

export async function fetchAuthConfig() {
  const res = await apiFetch('/api/auth/config');
  return res.json();
}

export async function fetchLatestVersion() {
  const res = await apiFetch('/api/system/version');
  if (!res.ok) return null;
  return res.json();
}

export async function fetchMe() {
  const res = await apiFetch('/api/auth/me');
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function loginWithGoogle(idToken) {
  const res = await apiFetch('/api/auth/google', {
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
  await apiFetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchUsers() {
  const res = await apiFetch('/api/users');
  return res.json();
}

export async function updateUserRole(id, role) {
  const res = await apiFetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  return res.json();
}

export async function updateUserStatus(id, status) {
  const res = await apiFetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export async function fetchUserPermissions(id) {
  const res = await apiFetch(`/api/users/${id}/permissions`);
  return res.json();
}

export async function saveUserPermissions(id, { nodeTypes, credentialNames }) {
  const res = await apiFetch(`/api/users/${id}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeTypes, credentialNames }),
  });
  return res.json();
}

export async function fetchUsageStats() {
  const res = await apiFetch('/api/users/usage-stats');
  return res.json();
}

// Agent pairing (specs/hosted-deployment-and-local-agent.md Phase D) — each user pairs at most
// 1 agent (their own machine) for node runsOn:"local" (CapCut, ComfyUI-local...).
export async function fetchMyAgents() {
  const res = await apiFetch('/api/agents');
  return res.json();
}

export async function createAgent(name) {
  const res = await apiFetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo agent thất bại');
  return data; // { id, agentToken } — agentToken only ever returned here
}

export async function deleteAgent(id) {
  const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xoá agent thất bại');
  return data;
}

export async function fetchNodes() {
  const res = await apiFetch('/api/nodes');
  return res.json();
}

// Custom Node Platform Phase 5 (specs/space-flow-master-plan/01-custom-node-platform.md) —
// Local Node Builder / Test Console / My Nodes, backed by backend/routes/local-nodes.js.
export async function fetchLocalNodes() {
  const res = await apiFetch('/api/local-nodes');
  return res.json(); // { drafts: [manifest,...], installed: [{package_id,version,manifest,...},...] }
}

export async function fetchLocalNodeDraft(packageId) {
  const res = await apiFetch(`/api/local-nodes/drafts/${packageId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được draft');
  return data; // { manifest, source }
}

export async function createLocalNodeDraft(manifest, source) {
  const res = await apiFetch('/api/local-nodes/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, source }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo draft thất bại');
  return data;
}

export async function updateLocalNodeDraft(packageId, manifest, source) {
  const res = await apiFetch(`/api/local-nodes/drafts/${packageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest, source }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lưu draft thất bại');
  return data;
}

export async function deleteLocalNodeDraft(packageId) {
  const res = await apiFetch(`/api/local-nodes/drafts/${packageId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xoá draft thất bại');
  return data;
}

export async function testLocalNodeDraft(packageId, inputs, config) {
  const res = await apiFetch(`/api/local-nodes/drafts/${packageId}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, config }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Test Console thất bại');
  return data; // { ok, output?, error?, logs, elapsedMs }
}

export async function installLocalNodeDraft(packageId) {
  const res = await apiFetch(`/api/local-nodes/drafts/${packageId}/install`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Cài đặt thất bại');
  return data; // { success, packageId, version, installPath, checksum }
}

// capabilities.filesystem: "user-approved-path" — explicit per-install path approval, paired
// with store.js's pickFolder() native folder picker (backend/routes/local-nodes.js validates
// each path exists as a real directory).
export async function setInstalledNodeApprovedPaths(packageId, version, paths) {
  const res = await apiFetch(`/api/local-nodes/installed/${packageId}/${version}/approved-paths`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lưu approved paths thất bại');
  return data; // { success, paths }
}

// Custom Node Platform Phase 7 (specs/space-flow-master-plan/01-custom-node-platform.md) —
// Admin Review (backend/routes/registry-admin.js, admin-only) + Public Registry browse/install
// (backend/routes/registry-public.js, any authenticated user).
export async function fetchRegistryQueue() {
  const res = await apiFetch('/api/registry/admin/queue');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được hàng đợi review');
  return res.json();
}

export async function fetchRegistrySubmissionDetail(packageId, version) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được chi tiết submission');
  return res.json();
}

export async function approveRegistrySubmission(packageId, version, { channel = 'stable', rolloutPercent = 100 } = {}) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, rolloutPercent }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Approve thất bại');
  return data;
}

export async function requestRegistryChanges(packageId, version, note) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}/request-changes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request changes thất bại');
  return data;
}

// Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md) —
// Lifecycle Controls: deprecate/revoke/rollback (admin-only, backend/routes/registry-admin.js).
export async function deprecateRegistryVersion(packageId, version, note) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}/deprecate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Deprecate thất bại');
  return data;
}

export async function revokeRegistryVersion(packageId, version, note) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Revoke thất bại');
  return data;
}

export async function rollbackRegistryVersion(packageId, version, note) {
  const res = await apiFetch(`/api/registry/admin/${packageId}/${version}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Rollback thất bại');
  return data;
}

// "Run anyway" 1 lần cho 1 version đã bị revoke và có network capability
// (backend/registry/revocation-check.js) — bất kỳ user nào cũng gọi được, không admin-gated.
export async function acknowledgeInstalledRevocation(packageId, version) {
  const res = await apiFetch(`/api/local-nodes/installed/${packageId}/${version}/acknowledge-revocation`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xác nhận thất bại');
  return data;
}

export async function fetchPublicRegistry() {
  const res = await apiFetch('/api/registry/public');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được Registry');
  return res.json();
}

export async function installPublishedNode(packageId, version) {
  const res = await apiFetch(`/api/registry/public/${packageId}/${version}/install`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Cài đặt thất bại');
  return data;
}

export async function fetchVideoAssets() {
  const res = await apiFetch('/api/video-assets');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được danh sách asset');
  return data;
}

export async function importVideoAsset(sourcePath) {
  const res = await apiFetch('/api/video-assets/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: sourcePath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import thất bại');
  return data;
}

// Phase 15 (§0): voice recording — `dataBase64` is the raw MediaRecorder blob, already base64-
// encoded by the caller (MediaBin.jsx). No FormData/multipart here on purpose: this reuses the
// exact same JSON body shape/route pattern as importVideoAsset() above, letting backend/routes/
// video-assets.js's POST /record go through the SAME agent-relay dispatch (resolveRunJob) every
// other asset operation in that file already uses, rather than the app's generic /api/upload route
// (which always lands on the CENTRAL server's own disk — wrong machine in SPACE_FLOW_MODE=server).
export async function recordVoiceAsset(dataBase64, extension) {
  const res = await apiFetch('/api/video-assets/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataBase64, extension }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ghi âm thất bại');
  return data;
}

export async function relinkVideoAsset(id, newPath) {
  const res = await apiFetch(`/api/video-assets/${id}/relink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: newPath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Relink thất bại');
  return data;
}

// 08-C C5 (specs/ai-creative-operations-platform/08-v2/08-c-media-and-capability-subsystem.md):
// `data.referencingProjects` (present only on a 409 — asset still used by a timeline) is attached to
// the thrown Error so frontend/src/video/store.js's deleteSelectedAssets() can surface which
// project(s) block the delete, not just a generic message.
export async function deleteVideoAsset(id) {
  const res = await apiFetch(`/api/video-assets/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Xoá asset thất bại');
    if (data.referencingProjects) err.referencingProjects = data.referencingProjects;
    throw err;
  }
  return data;
}

// 08-C C6: AgentCapabilitySnapshot (backend/video/capabilitySnapshot.js) — first real consumer is
// ExportPanel.jsx's proactive "can this machine actually export right now" check (ADR 0031).
export async function fetchVideoCapability() {
  const res = await apiFetch('/api/video-assets/capability');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không kiểm tra được capability máy render');
  return data;
}

// Video Editor Phase 3 (specs/space-flow-master-plan/04-video-editor.md §5): client for
// backend/routes/video-projects.js — the Workspace Shell (frontend/src/video/VideoWorkspace.jsx)
// picks the owner's most recent project or creates one, then posts every timeline edit as a
// {type, args} command (frontend/src/video/store.js's execute()).
export async function fetchVideoProjects() {
  const res = await apiFetch('/api/video-projects');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được danh sách project');
  return data;
}

export async function fetchVideoProject(id) {
  const res = await apiFetch(`/api/video-projects/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được project');
  return data;
}

// 08-E E7 / 08-B B6 (specs/.../08-v2/08-e-editor-node-and-workbench.md, 08-b-composition-document-
// and-versioning.md): DELETE /:id (backend/routes/video-projects.js) soft-deletes ("move to trash")
// — recoverable via restoreVideoProject() below, but a VideoEditorWorkbenchNode still pointing at a
// trashed project's id degrades the same way it did under the old hard-delete (E4's "project not
// found" recovery screen) rather than silently staying editable; see requireActiveOwner() in that
// route file.
export async function deleteVideoProject(id) {
  const res = await apiFetch(`/api/video-projects/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xoá project thất bại');
  return data;
}

// 08-E E7: "Thùng rác" panel support — restore/permanent-delete never touch the currently open
// project (a trashed project can't be the one open in this tab), so unlike deleteVideoProject()
// these don't need store.js wiring; ProjectSwitcher calls them directly.
export async function fetchArchivedVideoProjects() {
  const res = await apiFetch('/api/video-projects/archived');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được thùng rác');
  return data;
}

export async function restoreVideoProject(id) {
  const res = await apiFetch(`/api/video-projects/${id}/restore`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Khôi phục project thất bại');
  return data;
}

export async function permanentlyDeleteVideoProject(id) {
  const res = await apiFetch(`/api/video-projects/${id}/permanent`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xoá vĩnh viễn thất bại');
  return data;
}

export async function createVideoProject(name, payload) {
  const res = await apiFetch('/api/video-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo project thất bại');
  return data;
}

// 08-E E2 (specs/.../08-v2/08-e-editor-node-and-workbench.md): VideoEditorWorkbenchNode's
// projection summary card — same endpoint the editor's own 08-B wiring uses, no new backend route.
export async function fetchTimelineCollection(projectId) {
  const res = await apiFetch(`/api/video-projects/${projectId}/timeline-collection`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được timeline collection');
  return data;
}

// 08-F F6 (specs/.../08-v2/08-f-timeline-authoring.md): the `video_timeline_collections` GROUP
// (08-B B2/ADR 0033) — NOT the same thing as fetchTimelineCollection() above, which is a single
// project's own document-hierarchy projection. This one lists every timeline that shares a
// collection, for TimelineDashboard.jsx.
export async function fetchTimelineCollectionGroup(collectionId) {
  const res = await apiFetch(`/api/video-timeline-collections/${collectionId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được collection');
  return data;
}

// 08-F F8 (specs/.../08-v2/08-f-timeline-authoring.md): BulkTimelineImportOperation client —
// backend/routes/video-bulk-import.js. previewBulkImport() is read-only (no DB write at all).
export async function previewBulkImport(timelineIds, orderedAssetIds, options) {
  const res = await apiFetch('/api/video-bulk-import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timelineIds, orderedAssetIds, options }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tạo được preview bulk import');
  return data;
}

export async function createBulkImportOperation(timelineIds, orderedAssetIds, options, idempotencyKey) {
  const res = await apiFetch('/api/video-bulk-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timelineIds, orderedAssetIds, options, idempotencyKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Bulk import thất bại');
  return data;
}

export async function retryBulkImportOperation(operationId) {
  const res = await apiFetch(`/api/video-bulk-import/${operationId}/retry`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Retry bulk import thất bại');
  return data;
}

export async function undoBulkImportOperation(operationId) {
  const res = await apiFetch(`/api/video-bulk-import/${operationId}/undo`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không hoàn tác được lần nhập');
  return data;
}

export async function videoVersionRequest(projectId, suffix = '', body) {
  const res = await apiFetch(`/api/video-versions/${projectId}${suffix}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không xử lý được phiên bản');
  return data;
}

export async function videoAutomationRequest(route, body) {
  const response = await apiFetch(`/api/video-automation/${route}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không xử lý được mẫu và biến thể.');
  return data;
}

export async function updateVideoAssetRights(assetId, rights) {
  const response = await apiFetch(`/api/video-assets/${assetId}/rights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rights) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không lưu được quyền sử dụng');
  return data;
}

// 08-E E5 (specs/ai-creative-operations-platform/08-v2/08-e-editor-node-and-workbench.md): cheap
// { seq } poll, used to detect "another tab/session moved this project forward since I opened it" —
// deliberately NOT fetchVideoProject() (which rebuilds and returns the full document every call).
export async function fetchVideoProjectRevision(id) {
  const res = await apiFetch(`/api/video-projects/${id}/revision`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không kiểm tra được phiên bản project');
  return data;
}

// 08-D D2 (specs/ai-creative-operations-platform/08-v2/08-d-durable-editing-transactions.md):
// `idempotencyKey` is OPTIONAL and purely additive — omitted, this is byte-identical to the
// pre-08-D call. The one real caller (frontend/src/video/store.js's execute(), via
// frontend/src/video/commandRetry.js) always passes one so a retried request after a transient
// network failure returns the original result (idempotent:true) instead of applying twice.
//
// 08-D D5 (§0, now wired): `baseRevision` is likewise OPTIONAL — omitted, the server applies
// unconditionally (pre-D5 behavior). When passed and it no longer matches the server's latest
// seq, the backend already rejects with 409 `{error:'conflict', reason:'base_revision_mismatch',
// baseRevision, currentRevision}` (backend/routes/video-projects.js's applyCommand(), unchanged —
// D2 built this contract, D5 is the frontend finally SENDING it). That structured body is
// preserved on the thrown Error (`.conflict = true`, `.serverRevision`) so store.js can tell a
// real conflict apart from a generic network/validation failure and react differently (no point
// retrying a stale base — see commandRetry.js's own conflict fast-path).
export async function postVideoCommand(projectId, type, args, idempotencyKey, baseRevision) {
  const body = { type, args };
  if (idempotencyKey) body.idempotencyKey = idempotencyKey;
  if (baseRevision !== undefined && baseRevision !== null) body.baseRevision = baseRevision;
  const res = await apiFetch(`/api/video-projects/${projectId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Lưu thao tác thất bại');
    if (data.error === 'conflict') { err.conflict = true; err.serverRevision = data.currentRevision; }
    throw err;
  }
  return data;
}

// 08.2.4 (specs/ai-creative-operations-platform/08-2-4-asset-gallery-and-timeline-creation.md §3):
// client for backend/routes/video-projects.js's POST /batch-create-from-videos — Gallery
// multi-select "Create timelines" (Media Bin, all-video selections only).
export async function batchCreateVideoProjectsFromVideos(mode, orderedAssetIds, baseName) {
  const res = await apiFetch('/api/video-projects/batch-create-from-videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, orderedAssetIds, baseName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo timeline hàng loạt thất bại');
  return data;
}

// Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5): client for
// backend/routes/video-render.js. startRenderJob() only creates the job (returns immediately);
// streamRenderJob() is the live progress channel (native EventSource, not a manual fetch-stream
// parser — the route is a plain GET, so the browser's built-in SSE client is a correct, simpler
// fit here, unlike POST-based workflow-run streaming elsewhere in this file).
// `presetId` (Phase 16, §0) picks the output resolution/quality tradeoff — backend/video/
// renderPresets.js's RENDER_PRESETS is the source of truth for valid ids; omitted here defaults
// server-side to 'original' (the project's own resolution, pre-Phase-16 behavior).
export async function startRenderJob(projectId, presetId, options = {}) {
  const res = await apiFetch(`/api/video-render/${projectId}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId, ...options }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Bắt đầu export thất bại');
  return data.jobId;
}

// streamRenderJob(projectId, jobId, onStatus) -> stop() — onStatus({status, progress_pct,
// error_message, log}) fires on every change, connection auto-closes once the route itself ends
// the response (terminal status) or the caller calls stop() early.
export function streamRenderJob(projectId, jobId, onStatus) {
  const source = new EventSource(`/api/video-render/${projectId}/render/${jobId}`);
  source.addEventListener('status', (e) => {
    const status = JSON.parse(e.data);
    if (status && ['done', 'error', 'cancelled'].includes(status.status)) source.close();
    onStatus(status);
  });
  source.onerror = () => { /* Reconnect transient failures; terminal status explicitly closes above. */ };
  return () => source.close();
}

export async function fetchRenderJobs(projectId) {
  const res = await apiFetch(`/api/video-render/${projectId}/render`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được danh sách render job');
  return data;
}

export async function cancelRenderJob(jobId) {
  const res = await apiFetch(`/api/video-render/${jobId}/cancel`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Huỷ export thất bại');
  return data;
}

export async function retryRenderJob(jobId) {
  const res = await apiFetch(`/api/video-render/${jobId}/retry`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Retry export thất bại');
  return data.jobId;
}

// 08-F F5 / ADR 0034 (docs/decisions/0034-compound-clip-minimal-slice.md): turns a FINISHED render
// job's output into a real asset — the mechanism a compound clip (one timeline embedded in
// another) is built from. Returns { asset, pinnedSeq } — `asset` is shaped exactly like any other
// fetchVideoAssets() entry, safe to prepend into the SAME `assets` list.
export async function promoteRenderJobToAsset(projectId, jobId) {
  const res = await apiFetch(`/api/video-render/${projectId}/render/${jobId}/promote-to-asset`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không thể ghép timeline này thành clip');
  return data;
}

// 08-F F5 / ADR 0034: Unpack needs the EXACT nested-timeline content that was rendered into a
// compound clip's asset (pinned at embed time), not whatever the nested project has since become.
export async function fetchVideoProjectStateAtSeq(projectId, seq) {
  const res = await apiFetch(`/api/video-projects/${projectId}/state-at-seq/${seq}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được nội dung timeline lồng nhau');
  return data.payload;
}

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
  return res.json();
}

export async function updateWorkflow(id, fields) {
  const res = await apiFetch(`/api/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}

export async function loadWorkflow(id) {
  const res = await apiFetch(`/api/workflows/${id}`);
  return res.json();
}

export async function fetchLocalGraph(entityId, depth) {
  const res = await apiFetch(`/api/graph/local/${encodeURIComponent(entityId)}?depth=${depth}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được local graph');
  return res.json();
}

export async function fetchBacklinks(entityId) {
  const res = await apiFetch(`/api/graph/backlinks/${encodeURIComponent(entityId)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được backlinks');
  return res.json();
}

export async function fetchSavedGraphViews(scope) {
  const res = await apiFetch(`/api/saved-graph-views?scope=${encodeURIComponent(scope)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được saved views');
  return res.json();
}

export async function createSavedGraphView(view) {
  const res = await apiFetch('/api/saved-graph-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(view),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không lưu được view');
  return res.json();
}

export async function deleteSavedGraphView(id) {
  const res = await apiFetch(`/api/saved-graph-views/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không xoá được view');
  return res.json();
}

export async function fetchGlobalGraph({ limit, cursor } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit);
  if (cursor) params.set('cursor', cursor);
  const res = await apiFetch(`/api/graph?${params.toString()}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được global graph');
  return res.json();
}

export async function deleteWorkflowFromLibrary(id) {
  const res = await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' });
  return res.json();
}

// Sheet Phase 1 (specs/space-flow-master-plan/03-spreadsheet.md §4): client for
// backend/routes/sheets.js. `snapshot` is the full envelope ({schemaVersion, engine,
// engineVersion, workbook}) — mirrors fetchWorkflows/createWorkflow/updateWorkflow/loadWorkflow
// above, just with `snapshot` in place of `payload` to match the sheets table column.
export async function fetchSheets() {
  const res = await apiFetch('/api/sheets');
  return res.json();
}

export async function createSheet(name, visibility, snapshot) {
  const res = await apiFetch('/api/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, visibility, snapshot }),
  });
  return res.json();
}

export async function updateSheet(id, fields) {
  const res = await apiFetch(`/api/sheets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}

export async function loadSheet(id) {
  const res = await apiFetch(`/api/sheets/${id}`);
  return res.json();
}

export async function deleteSheetFromLibrary(id) {
  const res = await apiFetch(`/api/sheets/${id}`, { method: 'DELETE' });
  return res.json();
}

// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4): client for the
// sheet_port_bindings CRUD added to backend/routes/sheets.js.
export async function fetchSheetBindings(sheetId) {
  const res = await apiFetch(`/api/sheets/${sheetId}/bindings`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được bindings');
  return res.json();
}

export async function createSheetBinding(sheetId, { tabId, rangeA1, direction, workflowNodeId }) {
  const res = await apiFetch(`/api/sheets/${sheetId}/bindings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabId, rangeA1, direction, workflowNodeId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Tạo binding thất bại');
  return data;
}

export async function deleteSheetBinding(sheetId, bindingId) {
  const res = await apiFetch(`/api/sheets/${sheetId}/bindings/${bindingId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Xoá binding thất bại');
  return data;
}

// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #8): called by
// frontend/src/sheet/SheetWorkspace.jsx whenever it detects a structural row/col insert/delete
// command from Univer, so sheet_port_bindings keep pointing at the right data. Fire-and-forget
// from the caller's perspective (failure just means a binding might drift — not worth blocking
// the user's edit over).
export async function rebaseSheetBindings(sheetId, payload) {
  const res = await apiFetch(`/api/sheets/${sheetId}/bindings/rebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Rebase bindings thất bại');
  return data;
}

// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3): client for
// backend/routes/sheets.js's POST /:id/import-google. Returns the full updated envelope so the
// caller can decide whether to reload the mounted workbook (GoogleImportModal.jsx re-mounts by
// re-opening the sheet, same as any other snapshot change made outside the live Univer instance).
export async function importGoogleSheet(sheetId, url) {
  const res = await apiFetch(`/api/sheets/${sheetId}/import-google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import từ Google Sheets thất bại');
  return data;
}

// Sheet Phase 4 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 4): client for
// backend/routes/google-oauth.js. connect() is a full-page navigation (not fetch) — Google's
// consent screen and the eventual redirect back only make sense as a real browser navigation.
export async function fetchGoogleOAuthStatus() {
  const res = await apiFetch('/api/google-oauth/status');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không lấy được trạng thái kết nối Google');
  return res.json(); // { connected }
}

export function connectGoogleOAuth() {
  window.location.href = '/api/google-oauth/connect';
}

export async function disconnectGoogleOAuth() {
  const res = await apiFetch('/api/google-oauth/disconnect', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ngắt kết nối Google thất bại');
  return data;
}

// Sheet Phase 4: client for the sheet_external_links CRUD/sync endpoints added to
// backend/routes/sheets.js.
export async function linkGoogleSheet(sheetId, url, refreshIntervalSeconds) {
  const res = await apiFetch(`/api/sheets/${sheetId}/link-google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, refreshIntervalSeconds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Kết nối Google Sheets thất bại');
  return data;
}

export async function fetchSheetExternalLinks(sheetId) {
  const res = await apiFetch(`/api/sheets/${sheetId}/external-links`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được danh sách link');
  return res.json();
}

export async function refreshSheetExternalLink(sheetId, linkId) {
  const res = await apiFetch(`/api/sheets/${sheetId}/external-links/${linkId}/refresh-now`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Refresh thất bại');
  return data;
}

export async function deleteSheetExternalLink(sheetId, linkId) {
  const res = await apiFetch(`/api/sheets/${sheetId}/external-links/${linkId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ngắt link thất bại');
  return data;
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
  return res.json();
}

export async function cleanupFiles(referencedPaths) {
  await apiFetch('/api/files/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referencedPaths }),
  });
}

export async function openFolder(filePath) {
  const res = await apiFetch('/api/files/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  return res.json();
}

export async function browseFolder() {
  const res = await apiFetch('/api/files/browse-folder', { method: 'POST' });
  return res.json();
}

export async function browseFile(filter) {
  const res = await apiFetch('/api/files/browse-file', {
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
  const res = await apiFetch(`/api/files/list-dir?${params}`);
  return res.json();
}

export function previewUrl(filePath) {
  return `/api/files/preview?path=${encodeURIComponent(filePath)}`;
}

export async function resolveDrop(names, items) {
  const body = items ? { names, items } : { names };
  const res = await apiFetch('/api/files/resolve-drop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function fetchVideoMetadata(url) {
  const res = await apiFetch('/api/video/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export async function restartCapcut() {
  const res = await apiFetch('/api/capcut/restart', { method: 'POST' });
  return res.json();
}

export async function downloadZip(files) {
  const res = await apiFetch('/api/files/download-zip', {
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
  const res = await apiFetch('/api/resize-upload/settings');
  return res.json();
}

export async function saveResizeUploadSettings(settings) {
  const res = await apiFetch('/api/resize-upload/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function fetchResizeUploadApps() {
  const res = await apiFetch('/api/resize-upload/apps');
  return res.json();
}

export async function saveResizeUploadApp(app) {
  const res = await apiFetch('/api/resize-upload/apps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(app),
  });
  return res.json();
}

export async function deleteResizeUploadApp(tag) {
  const res = await apiFetch(`/api/resize-upload/apps/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  return res.json();
}

function postResizeUploadAction(action, body) {
  return apiFetch(`/api/resize-upload/${action}`, {
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
  const res = await apiFetch('/api/resize-upload/last-session');
  return res.json();
}

export async function saveResizeUploadLastSession(config) {
  const res = await apiFetch('/api/resize-upload/last-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export function runResizeUploadNms(config, mode, onEvent) {
  return readEventStream(
    apiFetch('/api/resize-upload/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, mode }),
    }),
    onEvent
  );
}

export function runResizeUploadV2Nms(config, mode, onEvent) {
  return readEventStream(
    apiFetch('/api/resize-upload-v2/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, mode }),
    }),
    onEvent
  );
}

export async function fetchResizeUploadV2LastSession() {
  const res = await apiFetch('/api/resize-upload-v2/last-session');
  return res.json();
}

export async function saveResizeUploadV2LastSession(config) {
  const res = await apiFetch('/api/resize-upload-v2/last-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

function postResizeUploadV2Action(action, body) {
  return apiFetch(`/api/resize-upload-v2/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(res => res.json());
}

export const asanaTestV2 = (credentialName) => postResizeUploadV2Action('asana-test', { credentialName });
export const asanaTasksV2 = (credentialName) => postResizeUploadV2Action('asana-tasks', { credentialName });
export const asanaAutoGidV2 = (credentialName, task_url) => postResizeUploadV2Action('asana-auto-gid', { credentialName, task_url });

export async function fetchResizeUploadV2LinkCatalog() {
  const res = await apiFetch('/api/resize-upload-v2/link-catalog');
  return res.json();
}

export function saveResizeUploadV2LinkCatalog(scope, data) {
  return postResizeUploadV2Action('link-catalog', { scope, data });
}

export async function deleteResizeUploadV2LinkCatalog() {
  const res = await apiFetch('/api/resize-upload-v2/link-catalog', { method: 'DELETE' });
  return res.json();
}

export async function fetchSystemStatus() {
  const res = await apiFetch('/api/system/status');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không lấy được trạng thái hệ thống');
  return data;
}

export async function fetchCredentials() {
  const res = await apiFetch('/api/credentials');
  return res.json();
}

export async function saveCredential(name, type, data, scope = 'private') {
  const res = await apiFetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, data, scope }),
  });
  return res.json();
}

export async function deleteCredential(name, scope = 'private') {
  const res = await apiFetch(`/api/credentials/${encodeURIComponent(name)}?scope=${scope}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchLocalServices() {
  const res = await apiFetch('/api/local-services');
  return res.json();
}

export async function saveLocalService(name, baseUrl) {
  const res = await apiFetch('/api/local-services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, baseUrl }),
  });
  return res.json();
}

export async function deleteLocalService(name) {
  const res = await apiFetch(`/api/local-services/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return res.json();
}

export function updateDependencies(onEvent) {
  return readEventStream(
    apiFetch('/api/system/update-deps', { method: 'POST' }),
    onEvent
  );
}

export async function fetchAutoUpdateConfig() {
  const res = await apiFetch('/api/system/auto-update-config');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không lấy được cấu hình tự động cập nhật');
  return data;
}

export async function updateAutoUpdateConfig(config) {
  const res = await apiFetch('/api/system/auto-update-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không lưu được cấu hình tự động cập nhật');
  return data;
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
    apiFetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow, startNodeId, resume }),
    }),
    onEvent
  );
}

export async function activateSchedule(triggerNodeId, workflow, intervalSeconds) {
  const res = await apiFetch(`/api/schedule/${triggerNodeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, intervalSeconds }),
  });
  return res.json();
}

export async function deactivateSchedule(triggerNodeId) {
  const res = await apiFetch(`/api/schedule/${triggerNodeId}`, { method: 'DELETE' });
  return res.json();
}
