// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2 task checklist):
// "mount qua univerAdapter, load snapshot từ loadSheet(id), autosave debounce lắng nghe
// adapter.onChange → PUT". This is the only place other than engine/univerAdapter.js itself
// that touches the mounted Univer instance, and even here only through the adapter's exported
// wrapper functions (mount/getSnapshot/onChange) — never a direct @univerjs/* import.

import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useSheetStore } from './store.js';
import { mount, getSnapshot, onChange } from './engine/univerAdapter.js';
import { loadSheet, updateSheet, rebaseSheetBindings } from '../lib/api.js';

const AUTOSAVE_DEBOUNCE_MS = 1500;
const ENGINE_VERSION = '0.25.1';

// Sheet Phase 5 (specs/space-flow-master-plan/03-spreadsheet.md §3 phản biện #8): Univer command
// ids for structural row/col insert/delete (confirmed against @univerjs/sheets's
// insert-row-col.command.d.ts / remove-row-col.command.d.ts — not documented in the facade API
// docs, so pinned here with a comment rather than assumed). `params.range` is read as "the exact
// rows/cols that end up newly inserted, or the exact ones being removed" regardless of
// before/after direction — see backend/sheet/rangeA1.js's shiftAxis() comment for the edge-case
// convention this implies.
const STRUCTURAL_COMMANDS = {
  'sheet.command.insert-row': { kind: 'row', op: 'insert' },
  'sheet.command.remove-row': { kind: 'row', op: 'delete' },
  'sheet.command.insert-col': { kind: 'col', op: 'insert' },
  'sheet.command.remove-col': { kind: 'col', op: 'delete' },
};

function rebasePayloadForCommand(command) {
  const meta = STRUCTURAL_COMMANDS[command.id];
  if (!meta || !command.params?.range) return null;
  const { range, subUnitId } = command.params;
  const isRow = meta.kind === 'row';
  const start = isRow ? range.startRow : range.startColumn;
  const end = isRow ? range.endRow : range.endColumn;
  return { tabId: subUnitId, kind: meta.kind, op: meta.op, index: start, count: end - start + 1 };
}

function buildEnvelope(workbook) {
  return { schemaVersion: 1, engine: 'univer', engineVersion: ENGINE_VERSION, workbook };
}

export default function SheetWorkspace() {
  const currentSheetId = useSheetStore(s => s.currentSheetId);
  const openSheetLibrary = useSheetStore(s => s.openSheetLibrary);
  const setSaveStatus = useSheetStore(s => s.setSaveStatus);
  const setAdapter = useSheetStore(s => s.setAdapter);

  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    setLoadError(null);
    if (!currentSheetId || !containerRef.current) return;

    let disposed = false;
    let changeSubscription = null;
    let instance = null;

    loadSheet(currentSheetId).then((res) => {
      if (disposed) return;
      if (res.error) { setLoadError(res.error); return; }

      instance = mount(containerRef.current, res.snapshot.workbook);
      setAdapter(instance);

      changeSubscription = onChange(instance.univerAPI, (command) => {
        const rebasePayload = rebasePayloadForCommand(command);
        if (rebasePayload) {
          // Fire-and-forget, independent of the autosave debounce below — bindings should
          // rebase immediately, not wait 1.5s (a workflow could run against this sheet before
          // the debounce fires). A failure here just risks a stale binding, not data loss.
          rebaseSheetBindings(currentSheetId, rebasePayload).catch((err) => {
            console.error('Rebase sheet bindings thất bại:', err.message);
          });
        }

        setSaveStatus('saving');
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
          try {
            const workbook = getSnapshot(instance.fWorkbook);
            const putRes = await updateSheet(currentSheetId, { snapshot: buildEnvelope(workbook) });
            setSaveStatus(putRes.error ? 'error' : 'saved');
          } catch {
            setSaveStatus('error');
          }
        }, AUTOSAVE_DEBOUNCE_MS);
      });
    });

    return () => {
      disposed = true;
      clearTimeout(debounceRef.current);
      changeSubscription?.dispose();
      instance?.univer.dispose();
      setAdapter(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSaveStatus/setAdapter are stable zustand setters
  }, [currentSheetId]);

  if (!currentSheetId) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#f5f5f5]">
        <div className="flex flex-col items-center gap-3 text-[var(--n400,#9ca3af)]">
          <FileSpreadsheet size={40} strokeWidth={1.5} />
          <p className="text-sm">Chưa mở sheet nào</p>
          <button
            onClick={openSheetLibrary}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] transition-colors"
          >
            Mở thư viện Sheet
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#f5f5f5]">
        <p className="text-sm text-red-600">Lỗi tải sheet: {loadError}</p>
      </div>
    );
  }

  return <div ref={containerRef} className="absolute inset-0" />;
}
