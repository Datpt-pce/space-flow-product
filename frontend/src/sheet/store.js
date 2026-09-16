// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2 task checklist):
// "frontend/src/sheet/store.js — Zustand slice riêng, không nhét vào frontend/src/store.js".
// Only Sheet-module-scoped UI state lives here — the cross-module `activeModule` switch itself
// stays in the main store.js (it's an app-shell concern, not sheet-specific).
//
// This store never imports @univerjs/* directly (only SheetWorkspace.jsx does, through
// engine/univerAdapter.js) — it only tracks WHICH sheet is open and the autosave status, the
// same separation of concerns as frontend/src/store.js's currentWorkflowId.

import { create } from 'zustand';
import { createSheet } from '../lib/api.js';

export const useSheetStore = create((set, get) => ({
  isSheetLibraryOpen: false,
  openSheetLibrary: () => set({ isSheetLibraryOpen: true }),
  closeSheetLibrary: () => set({ isSheetLibraryOpen: false }),

  // Sheet Phase 3 + 4 (specs/space-flow-master-plan/03-spreadsheet.md §4): modal open/close
  // state for the 2 Google Sheets entry points — kept as plain booleans here (not their own
  // slice) since, unlike currentSheetId/adapter, neither has any state worth sharing outside
  // its own component.
  isGoogleImportOpen: false,
  openGoogleImport: () => set({ isGoogleImportOpen: true }),
  closeGoogleImport: () => set({ isGoogleImportOpen: false }),

  isGoogleLinkOpen: false,
  openGoogleLink: () => set({ isGoogleLinkOpen: true }),
  closeGoogleLink: () => set({ isGoogleLinkOpen: false }),

  currentSheetId: null,
  currentSheetName: null,
  // idle: nothing opened yet. saving/saved/error: autosave lifecycle (SheetWorkspace.jsx).
  saveStatus: 'idle',

  // Live handle to the mounted Univer instance ({ univer, univerAPI, fWorkbook }, see
  // engine/univerAdapter.js's mount() return shape) — set by SheetWorkspace.jsx on mount/
  // unmount so other sheet-module UI (Toolbar's Export button) can read the CURRENT in-memory
  // workbook (including unsaved edits) via engine/univerAdapter.js's getSnapshot(), without
  // this store importing @univerjs/* itself.
  adapter: null,
  setAdapter: (adapter) => set({ adapter }),

  openSheet: (id, name) => set({ currentSheetId: id, currentSheetName: name, saveStatus: 'idle' }),
  closeSheet: () => set({ currentSheetId: null, currentSheetName: null, saveStatus: 'idle', adapter: null }),
  setSaveStatus: (status) => set({ saveStatus: status }),

  // Import flow (Toolbar.jsx): create a brand-new sheet document from a parsed snapshot
  // (xlsx.js/csv.js output), then open it for editing — matches Phase 1's design where
  // creation always happens via an explicit POST, never implicitly from SheetWorkspace's PUT
  // autosave path.
  createFromSnapshot: async (name, workbookSnapshot) => {
    const envelope = { schemaVersion: 1, engine: 'univer', engineVersion: '0.25.1', workbook: workbookSnapshot };
    const res = await createSheet(name, 'private', envelope);
    if (res.error) throw new Error(res.error);
    get().openSheet(res.id, name);
    return res.id;
  },
}));
