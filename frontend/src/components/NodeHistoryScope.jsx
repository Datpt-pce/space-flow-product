import { Undo2, Redo2 } from 'lucide-react';
import { useStore } from '../store.js';

export function NodeHistoryControls({ nodeId, disabled = false }) {
  const history = useStore(state => state.nodeHistories[nodeId]);
  const busy = useStore(state => state.nodeHistoryBusy || state.nodeStatuses[nodeId] === 'running') || disabled;
  const error = useStore(state => state.nodeHistoryError);
  return <div className="nodrag inline-flex items-center gap-1 text-[11px]">
    <button type="button" aria-label="Hoàn tác trong node" title="Hoàn tác trong node (Ctrl+Z)" disabled={!!busy || !history?.undo.length} className="p-1.5 rounded hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-30" onClick={() => useStore.getState().undoNode(nodeId)}><Undo2 size={14} /></button>
    <button type="button" aria-label="Làm lại trong node" title="Làm lại trong node (Ctrl+Shift+Z)" disabled={!!busy || !history?.redo.length} className="p-1.5 rounded hover:bg-[var(--n100,#f3f4f6)] disabled:opacity-30" onClick={() => useStore.getState().redoNode(nodeId)}><Redo2 size={14} /></button>
    {error && <span role="alert" className="text-red-500 max-w-72">{error}</span>}
  </div>;
}

export default function NodeHistoryScope({ nodeId, children, ...props }) {
  return <div {...props} data-node-history={nodeId}
    onPointerDownCapture={() => useStore.setState({ activeNodeHistoryId: nodeId })}
    onFocusCapture={() => useStore.setState({ activeNodeHistoryId: nodeId })}
    onKeyDownCapture={event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.isComposing) return;
    // A text draft owns its native history, including in portaled node dialogs.
    if (event.target.matches('input:not([type=checkbox]):not([type=radio]), textarea') || event.target.isContentEditable || event.target.closest('.monaco-editor,.cm-editor')) {
      event.stopPropagation(); return;
    }
    event.preventDefault(); event.stopPropagation();
    if ([...document.querySelectorAll('[data-history-draft="true"]')].some(element => element.dataset.nodeHistory === nodeId)) return;
    if (event.shiftKey) void useStore.getState().redoNode(nodeId);
    else void useStore.getState().undoNode(nodeId);
  }}>{children}</div>;
}
