import { apiFetch } from './transport';

export function runNodeIds(workflow, startNodeId) {
  if (!startNodeId) return workflow.nodes.map(node => node.id);
  const visit = reverse => {
    const ids = new Set([startNodeId]);
    for (const id of ids) for (const edge of workflow.edges) {
      if ((reverse ? edge.target : edge.source) === id) ids.add(reverse ? edge.source : edge.target);
    }
    return ids;
  };
  return [...new Set([...visit(false), ...visit(true)])];
}

async function checked(response) {
  if (response.ok) return response;
  const data = await response.json().catch(() => ({}));
  throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
}

export async function cancelRun(id) {
  await checked(await apiFetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }));
}

// Reconnect only the subscription. Never resubmit an admitted run after a stream failure.
export async function observeRun(run, onEvent, onCreated, signal) {
  let id = run.id;
  let cursor = 0;
  let terminal = false;
  while (!signal.aborted && !terminal) {
    try {
      if (!id) {
        const response = await checked(await apiFetch('/api/runs', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': run.key },
          body: JSON.stringify(run.intent),
        }));
        id = (await response.json()).id;
        await onCreated(id);
      }
      const response = await checked(await apiFetch(`/api/runs/${encodeURIComponent(id)}/events?after=${cursor}`, { signal }));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!terminal) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const record = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            let event, data, seq;
            for (const line of record.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data = line.slice(5).trim();
              if (line.startsWith('id:')) seq = Number(line.slice(3).trim());
            }
            if (!event || !data || !Number.isSafeInteger(seq) || seq <= cursor) continue;
            let payload;
            try { payload = JSON.parse(data); } catch { continue; }
            try { onEvent(event, payload); }
            catch (error) { error.consumerError = true; throw error; }
            cursor = seq;
            if (event === 'done' || event === 'error') terminal = true;
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (signal.aborted) return;
      // Admission/permission errors need user action; transient transport errors reconnect.
      if (error.consumerError || (error.status && error.status < 500 && error.status !== 429)) throw error;
    }
    if (!terminal && !signal.aborted) await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 1500);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
