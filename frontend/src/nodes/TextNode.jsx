import { Handle, Position, NodeToolbar, useViewport } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls, portPct } from './resizable.jsx';

const PORT_COLORS = { text: '#3b82f6', array: '#14b8a6' };
const DEFAULT_W = 200;
const MIN_W = 160, MAX_W = 520, MIN_H = 110, MAX_H = 480;

export default function TextNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const content = config.content || '';
  const fontSize = config.fontSize || 14;
  const bold = config.bold || false;

  const { zoom } = useViewport();
  const isCompact = zoom < 0.4;

  const nodeStatuses = useStore(s => s.nodeStatuses);
  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const selectNode = useStore(s => s.selectNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive = useStore(s => s.nodeActive);

  const status = nodeStatuses[id] || 'idle';
  const categoryColor = CATEGORY_COLORS[manifest.category] || '#6b7280';
  const isActive = nodeActive[id] !== false;

  const contentMinHeight = Math.max(80, Math.min(200, (content.split('\n').length + 2) * (fontSize * 1.5) + 24));
  const nodeW = width || DEFAULT_W;

  const handleDelete = () => {
    deleteNode(id);
  };

  return (
    <div className="flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-gray-100 transition-colors"
            onClick={() => runWorkflow(id)}
          >
            <Play size={12} className="text-gray-700" />
          </button>
          <div className="w-px h-4 bg-gray-200" />
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => selectNode(id)}>
            <Link2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-gray-400 font-medium mb-1 pl-0.5 select-none truncate" style={{ maxWidth: '100%' }}>
        {manifest.name} <span className="text-gray-300">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-white rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-gray-200 hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {/* Text content area */}
        <div
          className="w-full rounded-t-2xl bg-gray-50 overflow-hidden flex-1 min-h-0"
          style={{ minHeight: contentMinHeight }}
        >
          <textarea
            className="w-full h-full bg-transparent resize-none px-3 py-2.5 focus:outline-none nodrag nopan"
            style={{
              fontSize: `${fontSize}px`,
              fontWeight: bold ? 700 : 400,
              lineHeight: 1.5,
              color: '#374151',
            }}
            value={content}
            onChange={e => updateNodeConfig(id, 'content', e.target.value)}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            placeholder="Type text here..."
          />
        </div>

        {/* Bottom strip */}
        {!isCompact && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 rounded-b-2xl flex-shrink-0">
            <div className="w-4 h-4 rounded-md flex-shrink-0 flex items-center justify-center" style={{ background: categoryColor + '20' }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: categoryColor }} />
            </div>
            <span className="text-[10px] text-gray-400 flex-1 truncate">
              {fontSize}px {bold ? '· Bold' : ''}
            </span>
            <button
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={{ background: '#111827' }}
              onMouseEnter={e => e.currentTarget.style.background = '#374151'}
              onMouseLeave={e => e.currentTarget.style.background = '#111827'}
              onClick={() => runWorkflow(id)}
              title="Run from here"
            >
              <Play size={9} fill="white" color="white" style={{ marginLeft: 1 }} />
            </button>
          </div>
        )}
        {isCompact && (
          <div className="flex items-center justify-center px-2 py-1.5 rounded-b-2xl flex-shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: categoryColor }} />
          </div>
        )}

        {/* Input port */}
        <Handle
          type="target"
          id="text_in"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="Text In"
          style={{
            background: PORT_COLORS.text,
            top: portPct(0, 1),
            left: -7,
            width: 14, height: 14,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            transform: 'translateY(-50%)',
          }}
        />

        {/* Output port */}
        <Handle
          type="source"
          id="text"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Text"
          style={{
            background: PORT_COLORS.text,
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
