import { X, Trash2 } from 'lucide-react';
import { useStore } from '../store.js';

export default function ExecutionLog() {
  const logs = useStore(s => s.executionLogs);
  const isLogOpen = useStore(s => s.isLogOpen);
  const toggleLog = useStore(s => s.toggleLog);
  const clearLogs = useStore(s => s.clearLogs);

  if (!isLogOpen) return null;

  return (
    <div
      className="absolute z-40 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ bottom: 16, left: 64, right: 16, maxHeight: 200 }}
    >
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-[var(--card-border,#f3f4f6)] flex-shrink-0">
        <span className="text-[11px] font-semibold text-[var(--sub,#4b5563)] flex-1">Execution Log</span>
        <button
          onClick={clearLogs}
          className="p-1 rounded-lg hover:bg-[var(--n100,#f3f4f6)] text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)] transition-colors mr-1"
          title="Clear logs"
        >
          <Trash2 size={11} />
        </button>
        <button
          onClick={toggleLog}
          className="p-1 rounded-lg hover:bg-[var(--n100,#f3f4f6)] text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)] transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono">
        {logs.length === 0 && (
          <p className="text-[10px] text-[var(--n400,#9ca3af)] italic py-2">No logs yet</p>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-3 text-[10px] leading-5">
            <span className="text-[var(--n300,#d1d5db)] flex-shrink-0">
              {new Date(entry.ts).toLocaleTimeString()}
            </span>
            {entry.nodeId && (
              <span className="text-[var(--n400,#9ca3af)] flex-shrink-0 truncate max-w-[100px]">
                [{entry.nodeId.slice(-8)}]
              </span>
            )}
            <span className={entry.level === 'error' ? 'text-red-500' : 'text-[var(--sub,#4b5563)]'}>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
