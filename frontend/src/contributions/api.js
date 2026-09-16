import { apiFetch } from '../lib/transport.js';
export async function reviewApi(path, method = 'GET', body) {
  const response = await apiFetch(`/api/contributions${path}`, { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Không hoàn tất được yêu cầu.'), { code: result.code, status: response.status });
  return result;
}
