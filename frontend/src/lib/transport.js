import { analyticsCommand } from './analyticsCommands.js';
// Shared same-origin request boundary. Domain API modules retain their existing response handling.
let lastGesture = -Infinity;
if (typeof window !== 'undefined') for (const type of ['pointerdown', 'keydown', 'touchstart'])
  window.addEventListener(type, event => { if (event.isTrusted) lastGesture = performance.now(); }, { capture: true, passive: true });
function csrfToken() {
  const match = document.cookie.match(/(?:^|; )sf_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}
export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', crypto.randomUUID());
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', csrfToken());
  const command = analyticsCommand(url, (options.method || 'GET').toUpperCase());
  const detail = command && performance.now() - lastGesture < 1500 ? { ...command, phase: 'requested' } : null;
  const start = performance.now();
  if (detail) window.dispatchEvent(new CustomEvent('sf-api-operation', { detail }));
  const finish = phase => { if (detail?.generation) window.dispatchEvent(new CustomEvent('sf-api-operation', {
    detail: { ...detail, phase, durationMs: performance.now() - start },
  })); };
  return fetch(url, { ...options, headers }).then(response => { finish(response.ok ? 'completed' : 'failed'); return response; },
    error => { finish('failed'); throw error; });
}
