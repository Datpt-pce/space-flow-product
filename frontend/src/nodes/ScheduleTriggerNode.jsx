import { useState } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Clock } from 'lucide-react';
import { useStore } from '../store.js';
import { activateSchedule, deactivateSchedule } from '../lib/api.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls, portPct } from './resizable.jsx';

const DEFAULT_W = 220;
const MIN_W = 180, MAX_W = 420, MIN_H = 100, MAX_H = 260;

export default function ScheduleTriggerNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const intervalSeconds = Number(config.intervalSeconds) || 60;

  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const buildWorkflowPayload = useStore(s => s.buildWorkflowPayload);

  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const categoryColor = CATEGORY_COLORS[manifest.category] || '#6b7280';

  const handleToggleActivate = async () => {
    setBusy(true);
    try {
      if (active) {
        await deactivateSchedule(id);
        setActive(false);
      } else {
        await activateSchedule(id, buildWorkflowPayload(), intervalSeconds);
        setActive(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ width: width || DEFAULT_W, height: '100%' }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
            onClick={() => runWorkflow(id)}
            title="Run once manually"
          >
            <Play size={12} className="text-gray-700" />
          </button>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" onClick={() => deleteNode(id)}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate">
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: width || DEFAULT_W }}
      >
        <div className="w-full rounded-2xl bg-gray-50 flex flex-col items-center justify-center gap-2 flex-1 min-h-0 py-3">
          <div className="flex items-center gap-1.5 text-gray-500">
            <Clock size={13} />
            <span className="text-[11px]">every {intervalSeconds}s</span>
          </div>
          <button
            disabled={busy}
            onClick={handleToggleActivate}
            className={`text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors ${
              active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}
          >
            {active ? 'Deactivate' : 'Activate'}
          </button>
          {active && <span className="text-[10px] text-amber-500">running in background</span>}
        </div>

        <Handle
          type="source"
          id="trigger"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Trigger"
          style={{
            background: categoryColor,
            top: portPct(0, 1),
            right: -7,
            width: 14, height: 14,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            transform: 'translateY(-50%)',
          }}
        />
      </div>
    </div>
  );
}
