import { Handle, Position, NodeToolbar, useViewport } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';

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
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
            onClick={() => runWorkflow(id)}
          >
            <Play size={12} className="text-[var(--sub,#374151)]" />
          </button>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" onClick={() => selectNode(id)}>
            <Link2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {/* Text content area */}
        <div
          className="w-full rounded-t-2xl bg-[var(--n50,#f9fafb)] overflow-hidden flex-1 min-h-0"
          style={{ flexBasis: contentMinHeight }}
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
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--card-border,#f3f4f6)] rounded-b-2xl flex-shrink-0">
            <div className="w-4 h-4 rounded-md flex-shrink-0 flex items-center justify-center" style={{ background: categoryColor + '20' }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: categoryColor }} />
            </div>
            <span className="text-[10px] text-[var(--n400,#9ca3af)] flex-1 truncate">
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
          style={portStyle('text', 0, 1, 'left')}
        >
          {portGlyph('text')}
        </Handle>

        {/* Output port */}
        <Handle
          type="source"
          id="text"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Text"
          style={portStyle('text', 0, 1, 'right')}
        >
          {portGlyph('text')}
        </Handle>
      </div>
    </div>
  );
}
