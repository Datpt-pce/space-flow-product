import { apiFetch } from '../../lib/transport';

export async function batchRequest(path = '', body, method) {
  const response = await apiFetch(`/api/video-batch${path}`, body === undefined ? { method: method || 'GET' } : {
    method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Không cập nhật được Lab.'), { status: response.status });
  return data;
}
