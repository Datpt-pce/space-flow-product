import { X } from 'lucide-react';
import { useStore } from '../store.js';
import { ConfigField } from './ConfigFields.jsx';

export default function ConfigPanel() {
  const selectedNodeId = useStore(s => s.selectedNodeId);
  const nodes = useStore(s => s.nodes);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const selectNode = useStore(s => s.selectNode);

  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return null;

  const { manifest, config } = node.data;

  return (
    <div
      className="absolute z-40 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ top: 16, right: 16, width: 264, maxHeight: 'calc(100vh - 32px)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--card-border,#f3f4f6)] flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--n800,#1f2937)] leading-tight">{manifest.name}</h3>
          <p className="text-[11px] text-[var(--n400,#9ca3af)] mt-0.5 leading-relaxed">{manifest.description}</p>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[var(--n100,#f3f4f6)] text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)] transition-colors flex-shrink-0 mt-0.5"
        >
          <X size={13} />
        </button>
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {(manifest.config || [])
          .filter(field => !field.visibleIf || config[field.visibleIf.field] === field.visibleIf.value)
          .map(field => (
          <ConfigField
            key={field.id}
            field={field}
            value={config[field.id]}
            onChange={v => updateNodeConfig(node.id, field.id, v)}
          />
        ))}

        {!manifest.config?.length && (
          <p className="text-[11px] text-[var(--n400,#9ca3af)] italic py-4 text-center">No configuration options</p>
        )}
      </div>
    </div>
  );
}
