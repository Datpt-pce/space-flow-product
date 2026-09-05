import { useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Plus, Play, Hand, Scissors, Square, MessageSquare, Undo2, Redo2, Save, FolderOpen, Activity, Settings, Library, Share2, Network, Table2, Download, Cloud, Link2 } from 'lucide-react';
import { useStore } from '../store.js';
import { useSheetStore } from '../sheet/store.js';
import { snapshotToExcelWorkbook } from '../sheet/io/xlsx.js';
import { snapshotToCsv } from '../sheet/io/csv.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();

  const activeModule = useStore(s => s.activeModule);
  const setActiveModule = useStore(s => s.setActiveModule);
  const openSettings = useStore(s => s.openSettings);

  const isRunning = useStore(s => s.isRunning);
  const isPaletteOpen = useStore(s => s.isPaletteOpen);
  const isLogOpen = useStore(s => s.isLogOpen);
  const isLocalGraphOpen = useStore(s => s.isLocalGraphOpen);
  const isGlobalGraphOpen = useStore(s => s.isGlobalGraphOpen);
  const nodes = useStore(s => s.nodes);
  const interactionMode = useStore(s => s.interactionMode);
  const _undoStack = useStore(s => s._undoStack);
  const _redoStack = useStore(s => s._redoStack);

  const runWorkflow = useStore(s => s.runWorkflow);
  const openPalette = useStore(s => s.openPalette);
  const closePalette = useStore(s => s.closePalette);
  const toggleLog = useStore(s => s.toggleLog);
  const toggleLocalGraph = useStore(s => s.toggleLocalGraph);
  const toggleGlobalGraph = useStore(s => s.toggleGlobalGraph);
  const setInteractionMode = useStore(s => s.setInteractionMode);
  const deleteSelected = useStore(s => s.deleteSelected);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const exportWorkflow = useStore(s => s.exportWorkflow);
  const importWorkflow = useStore(s => s.importWorkflow);
  const openWorkflowLibrary = useStore(s => s.openWorkflowLibrary);

  const currentSheetId = useSheetStore(s => s.currentSheetId);
  const currentSheetName = useSheetStore(s => s.currentSheetName);
  const sheetSaveStatus = useSheetStore(s => s.saveStatus);
  const sheetAdapter = useSheetStore(s => s.adapter);
  const openSheetLibrary = useSheetStore(s => s.openSheetLibrary);
  const openGoogleImport = useSheetStore(s => s.openGoogleImport);
  const openGoogleLink = useSheetStore(s => s.openGoogleLink);

  const fileInputRef = useRef(null);

  const canUndo = _undoStack.length > 0;
  const canRedo = _redoStack.length > 0;

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => importWorkflow(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePan = () => setInteractionMode(interactionMode === 'pan' ? 'default' : 'pan');
  const handleSelect = () => setInteractionMode(interactionMode === 'select' ? 'default' : 'select');

  const handleAddNode = () => {
    if (isPaletteOpen) { closePalette(); return; }
    const centerPos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    openPalette(centerPos);
  };

  const handleToggleModule = () => setActiveModule(activeModule === 'flow' ? 'sheet' : 'flow');

  // Exports the CURRENT in-memory workbook (unsaved edits included) rather than the last-saved
  // snapshot. `fWorkbook.save()` is called directly on the facade handle sheet/store.js already
  // holds (set by SheetWorkspace.jsx on mount) — this is the same thing engine/univerAdapter.js's
  // getSnapshot() wrapper does, but calling the method directly here avoids Toolbar.jsx (always
  // mounted, in every module) importing anything from engine/ at all.
  const handleExportSheetXlsx = () => {
    if (!sheetAdapter) return;
    const workbook = snapshotToExcelWorkbook(sheetAdapter.fWorkbook.save());
    workbook.xlsx.writeBuffer().then((buffer) => {
      downloadBlob(new Blob([buffer]), `${currentSheetName || 'sheet'}.xlsx`);
    });
  };

  const handleExportSheetCsv = () => {
    if (!sheetAdapter) return;
    const csv = snapshotToCsv(sheetAdapter.fWorkbook.save());
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${currentSheetName || 'sheet'}.csv`);
  };

  const iconBtn = (icon, label, onClick, active = false, disabled = false) => (
    <button
      key={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        ${active
          ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
          : 'text-[var(--n500,#6b7280)] hover:bg-[var(--card,#fff)] hover:text-[var(--n800,#1f2937)] hover:shadow-sm'
        }`}
    >
      {icon}
    </button>
  );

  const moduleSwitcher = iconBtn(
    <Table2 size={15} />,
    activeModule === 'flow' ? 'Chuyển sang Sheet' : 'Chuyển sang Flow',
    handleToggleModule,
    activeModule === 'sheet'
  );

  if (activeModule === 'sheet') {
    const saveStatusLabel = { idle: '', saving: 'Đang lưu…', saved: 'Đã lưu', error: 'Lỗi lưu' }[sheetSaveStatus];
    return (
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-md px-1.5 py-2">
        {moduleSwitcher}

        <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

        {iconBtn(<Library size={15} />, 'Thư viện Sheet', openSheetLibrary)}
        {iconBtn(<Download size={15} />, 'Export XLSX', handleExportSheetXlsx, false, !currentSheetId)}
        {iconBtn(<FolderOpen size={15} />, 'Export CSV', handleExportSheetCsv, false, !currentSheetId)}

        <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

        {iconBtn(<Cloud size={15} />, 'Import từ Google Sheets', openGoogleImport, false, !currentSheetId)}
        {iconBtn(<Link2 size={15} />, 'Kết nối Google Sheets', openGoogleLink, false, !currentSheetId)}

        <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

        {iconBtn(<Settings size={15} />, 'Settings', openSettings)}

        {saveStatusLabel && (
          <span
            title={saveStatusLabel}
            className={`text-[9px] mt-1 ${sheetSaveStatus === 'error' ? 'text-red-500' : 'text-[var(--n400,#9ca3af)]'}`}
          >
            {saveStatusLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-md px-1.5 py-2">
      {/* Add node */}
      {iconBtn(<Plus size={16} />, 'Add node', handleAddNode, isPaletteOpen)}

      {/* Run all */}
      <button
        title={isRunning ? 'Running…' : 'Run workflow'}
        onClick={() => runWorkflow(null)}
        disabled={isRunning || nodes.length === 0}
        className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors disabled:opacity-40
          ${isRunning
            ? 'bg-amber-500 text-white animate-pulse'
            : 'text-[var(--n500,#6b7280)] hover:bg-[var(--card,#fff)] hover:text-[var(--n800,#1f2937)] hover:shadow-sm'
          }`}
      >
        <Play size={15} />
      </button>

      <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

      {iconBtn(<Hand size={16} />, 'Pan mode', handlePan, interactionMode === 'pan')}
      {iconBtn(<Scissors size={16} />, 'Delete selected', deleteSelected)}
      {iconBtn(<Square size={15} />, 'Select mode', handleSelect, interactionMode === 'select')}
      {iconBtn(<MessageSquare size={15} />, 'Add node (search)', handleAddNode)}

      <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

      {iconBtn(<Undo2 size={15} />, 'Undo', undo, false, !canUndo)}
      {iconBtn(<Redo2 size={15} />, 'Redo', redo, false, !canRedo)}

      <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

      {iconBtn(<Activity size={15} />, 'Execution log', toggleLog, isLogOpen)}
      {iconBtn(<Save size={15} />, 'Export workflow (JSON)', exportWorkflow)}

      {/* Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImport}
      />
      {iconBtn(<FolderOpen size={15} />, 'Import workflow (JSON)', () => fileInputRef.current?.click())}
      {iconBtn(<Library size={15} />, 'Workflow library', openWorkflowLibrary)}
      {iconBtn(<Share2 size={15} />, 'Local Graph', toggleLocalGraph, isLocalGraphOpen)}
      {iconBtn(<Network size={15} />, 'Global Graph', toggleGlobalGraph, isGlobalGraphOpen)}

      <div className="w-5 h-px bg-[var(--n200,#e5e7eb)] my-0.5" />

      {moduleSwitcher}
      {iconBtn(<Settings size={15} />, 'Settings', openSettings)}
    </div>
  );
}
