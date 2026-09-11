import { batchRequest } from './batchApi';
import { planBatch } from '@shared/video-batch-planner';

export function createBatchSlice(set, get) {
  const operation = async fn => {
    if (get().batchBusy) throw new Error('Chờ Lab lưu xong.');
    set({ batchBusy: true, batchError: null });
    try { return await fn(); }
    catch (error) { set({ batchError: error.message }); throw error; }
    finally { set({ batchBusy: false }); }
  };
  const accept = project => { set(s => ({ batchProject: project, batchDirty: false, batchProjects: s.batchProjects.map(p => p.id === project.id ? { ...p, name: project.name, revision: project.revision } : p) })); return project; };
  return {
    batchProject: null, batchProjects: [], batchBusy: false, batchError: null, batchDirty: false,
    batchPreview: null, batchRun: null, batchRuns: [], batchRunKey: null,
    batchSpeechDrafts: {}, batchVoiceReference: '',
    batchApplySpeech: request => operation(async () => {
      const project = get().batchProject;
      if (get().batchDirty) throw new Error('Lưu Lab trước khi áp dụng voice/captions.');
      const result = await batchRequest(`/${project.id}/apply-speech`, { ...request, expectedRevision:project.revision });
      set({ batchPreview:null, batchRunKey:null });
      return accept(result);
    }),
    batchEdit: fn => {
      if (get().batchBusy || !get().batchProject || get().batchProject.archived) return;
      const next = structuredClone(get().batchProject); fn(next);
      set({ batchProject: next, batchDirty: true, batchRunKey: null });
    },
    batchList: archived => operation(async () => {
      const projects = await batchRequest(archived ? '?archived=1' : '');
      set({ batchProjects: projects }); return projects;
    }),
    batchLoad: id => operation(async () => {
      const project = await batchRequest(`/${encodeURIComponent(id)}`);
      const runs = await batchRequest(`/${encodeURIComponent(id)}/runs`);
      const run = runs[0] ? await batchRequest(`/${id}/runs/${runs[0].id}?limit=100`) : null;
      set({ batchPreview: null, batchRunKey: null, batchRuns: runs, batchRun: run }); return accept(project);
    }),
    batchCreate: (id, name) => operation(async () => {
      const project = await batchRequest('', { id, name });
      set({ batchPreview: null, batchRunKey: null, batchRuns: [], batchRun: null }); return accept(project);
    }),
    batchSave: () => operation(async () => {
      const project = get().batchProject;
      if (!get().batchDirty) return project;
      return accept(await batchRequest(`/${project.id}`, { name: project.name, draft: project.draft, expectedRevision: project.revision }, 'PUT'));
    }),
    batchArchive: restore => operation(async () => {
      const project = get().batchProject;
      return accept(await batchRequest(`/${project.id}/${restore ? 'restore' : 'archive'}`, { expectedRevision: project.revision }));
    }),
    batchRenameOther: (id, name) => operation(async () => {
      const project = await batchRequest(`/${encodeURIComponent(id)}`);
      const updated = await batchRequest(`/${project.id}`, { name, draft: project.draft, expectedRevision: project.revision }, 'PUT');
      set(s => ({ batchProjects: s.batchProjects.map(p => p.id === id ? { ...p, name: updated.name, revision: updated.revision } : p) }));
      return updated;
    }),
    batchArchiveOther: id => operation(async () => {
      const project = await batchRequest(`/${encodeURIComponent(id)}`);
      return batchRequest(`/${project.id}/archive`, { expectedRevision: project.revision });
    }),
    batchPrepare: (listId, itemId) => operation(async () => {
      const project = get().batchProject;
      if (get().batchDirty) throw new Error('Lưu Lab trước khi mở timeline chuẩn bị.');
      const result = await batchRequest(`/${project.id}/prepare`, { listId, itemId, expectedRevision: project.revision });
      accept(result.project); return result.timelineId;
    }),
    batchCapture: (listId, itemId, baseRevision) => operation(async () => {
      const project = get().batchProject;
      if (get().batchDirty) throw new Error('Lưu Lab trước khi nhận trim.');
      return accept(await batchRequest(`/${project.id}/capture`, { listId, itemId, baseRevision, expectedRevision: project.revision }));
    }),
    batchPreflight: (offset = 0) => operation(async () => {
      const p = get().batchProject;
      if (get().batchDirty) throw new Error('Lưu Lab trước khi kiểm tra ma trận.');
      const preview = await batchRequest(`/${p.id}/preflight`, { expectedRevision: p.revision, offset });
      const local = planBatch(preview.snapshot, { offset, limit: 20 });
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(local.inputCanonical));
      const hash = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== preview.inputHash || local.totalCount !== preview.totalCount
        || JSON.stringify(local.rows) !== JSON.stringify(preview.rows.map(({ rowIndex, assignments }) => ({ rowIndex, assignments })))) throw new Error('Ma trận browser/server không khớp. Tải lại ứng dụng trước khi tạo.');
      set({ batchPreview: preview }); return preview;
    }),
    batchGenerate: () => operation(async () => {
      const p = get().batchProject, preview = get().batchPreview;
      if (get().batchDirty || !preview || preview.snapshot.revision !== p.revision) throw new Error('Kiểm tra lại ma trận trước khi tạo timeline.');
      const key = get().batchRunKey || crypto.randomUUID(); set({ batchRunKey: key });
      const created = await batchRequest(`/${p.id}/runs`, { expectedRevision: p.revision, inputHash: preview.inputHash, idempotencyKey: key });
      const run = await batchRequest(`/${p.id}/runs/${created.id}?limit=100`);
      set({ batchRun: run, batchRuns: await batchRequest(`/${p.id}/runs`) }); return run;
    }),
    batchLoadRun: runId => operation(async () => {
      const id = get().batchProject.id;
      const run = await batchRequest(`/${id}/runs/${runId}?limit=100`);
      const runs = await batchRequest(`/${id}/runs`);
      set({ batchRun: run, batchRuns: runs }); return run;
    }),
  };
}
