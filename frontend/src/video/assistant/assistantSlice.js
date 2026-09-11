import { createDraft, validateDraft } from '@shared/creative-assistant';
import { apiFetch } from '../../lib/transport';
export async function assistantRequest(action, body) {
  const response = await apiFetch('/api/creative-assistant/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Creative Assistant gặp lỗi.');
  return data;
}
export const createAssistantSlice = (set, get) => ({
  assistantOwner: null, assistantDraft: createDraft(), assistantPlan: null, assistantResult: null, assistantBusy: '', assistantError: '', assistantNote: '',
  assistantLoad(owner) {
    if (get().assistantOwner === owner) return;
    let draft = createDraft();
    try { const saved = localStorage.getItem('creative-assistant:' + owner); if (saved) draft = validateDraft(JSON.parse(saved)); } catch { /* Invalid browser draft starts clean; JSON import remains available. */ }
    set({ assistantOwner: owner, assistantDraft: draft, assistantPlan: null, assistantResult: null, assistantBusy: '', assistantError: '', assistantNote: '' });
  },
  assistantEdit(draft) {
    set({ assistantDraft: draft, assistantPlan: null, assistantResult: null, assistantError: '' });
    try { localStorage.setItem('creative-assistant:' + get().assistantOwner, JSON.stringify(draft)); } catch { set({ assistantNote: 'Trình duyệt không lưu được bản nháp. Hãy tải JSON để giữ công việc.' }); }
  },
  async assistantRun(label, task) {
    if (get().assistantBusy) return;
    const owner = get().assistantOwner;
    set({ assistantBusy: label, assistantError: '' });
    try { const result = await task(); if (get().assistantOwner === owner) return result; }
    catch (error) { if (get().assistantOwner === owner) set({ assistantError: error.message }); }
    finally { if (get().assistantOwner === owner) set({ assistantBusy: '' }); }
  },
});
