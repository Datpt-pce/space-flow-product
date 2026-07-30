import { useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Plus, Play, Hand, Scissors, Square, MessageSquare, Undo2, Redo2, Save, FolderOpen, Activity, Settings } from 'lucide-react';
import { useStore } from '../store.js';

export default function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();

  const isRunning = useStore(s => s.isRunning);
  const isPaletteOpen = useStore(s => s.isPaletteOpen);
  const isLogOpen = useStore(s => s.isLogOpen);
  const nodes = useStore(s => s.nodes);
  const interactionMode = useStore(s => s.interactionMode);
  const _undoStack = useStore(s => s._undoStack);
  const _redoStack = useStore(s => s._redoStack);

  const runWorkflow = useStore(s => s.runWorkflow);
  const openPalette = useStore(s => s.openPalette);
  const closePalette = useStore(s => s.closePalette);
  const toggleLog = useStore(s => s.toggleLog);
  const setInteractionMode = useStore(s => s.setInteractionMode);
  const deleteSelected = useStore(s => s.deleteSelected);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const exportWorkflow = useStore(s => s.exportWorkflow);
  const importWorkflow = useStore(s => s.importWorkflow);
  const openSettings = useStore(s => s.openSettings);

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

  const iconBtn = (icon, label, onClick, active = false, disabled = false) => (
    <button
      key={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        ${active
          ? 'bg-gray-900 text-white'
          : 'text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-sm'
        }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 bg-white border border-gray-200 rounded-2xl shadow-md px-1.5 py-2">
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
            : 'text-gray-500 hover:bg-white hover:text-gray-800 hover:shadow-sm'
          }`}
      >
        <Play size={15} />
      </button>

      <div className="w-5 h-px bg-gray-200 my-0.5" />

      {iconBtn(<Hand size={16} />, 'Pan mode', handlePan, interactionMode === 'pan')}
      {iconBtn(<Scissors size={16} />, 'Delete selected', deleteSelected)}
      {iconBtn(<Square size={15} />, 'Select mode', handleSelect, interactionMode === 'select')}
      {iconBtn(<MessageSquare size={15} />, 'Add node (search)', handleAddNode)}

      <div className="w-5 h-px bg-gray-200 my-0.5" />

      {iconBtn(<Undo2 size={15} />, 'Undo', undo, false, !canUndo)}
      {iconBtn(<Redo2 size={15} />, 'Redo', redo, false, !canRedo)}

      <div className="w-5 h-px bg-gray-200 my-0.5" />

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

      <div className="w-5 h-px bg-gray-200 my-0.5" />

      {iconBtn(<Settings size={15} />, 'Settings', openSettings)}
    </div>
  );
}
