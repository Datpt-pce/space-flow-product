import { Handle, Position, NodeToolbar, useViewport } from '@xyflow/react';
import { Send, Trash2, Copy, MessageCircle } from 'lucide-react';
import { useStore } from '../store.js';
import { CATEGORY_COLORS } from '../lib/nodeRegistry.jsx';
import { ResizeControls, portPct } from './resizable.jsx';

const PORT_COLOR = '#3b82f6';
const DEFAULT_W = 220;
const MIN_W = 180, MAX_W = 520, MIN_H = 120, MAX_H = 480;

export default function ChatTriggerNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const message = config.message || '';

  const { zoom } = useViewport();
  const isCompact = zoom < 0.4;

  const runWorkflow = useStore(s => s.runWorkflow);
  const deleteNode = useStore(s => s.deleteNode);
  const duplicateNode = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive = useStore(s => s.nodeActive);

  const categoryColor = CATEGORY_COLORS[manifest.category] || '#6b7280';
  const isActive = nodeActive[id] !== false;
  const nodeW = width || DEFAULT_W;

  // Chạy cả workflow (không phải chỉ "run from here") — Chat là trigger, các node
  // tham chiếu tĩnh (vd. node Text chứa system prompt) thường nối thẳng vào node đích
  // chứ không nằm trên nhánh xuôi dòng từ Chat, nên forward-reachability từ chính node
  // này sẽ bỏ sót chúng.
  const handleSend = () => runWorkflow(null);

  const handleKeyDown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
            onClick={handleSend}
            title="Send"
          >
            <Send size={12} className="text-[var(--sub,#374151)]" />
          </button>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" onClick={() => deleteNode(id)}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="text-[11px] text-[var(--n400,#9ca3af)] font-medium mb-1 pl-0.5 select-none truncate" style={{ maxWidth: '100%' }}>
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        <div className="w-full rounded-t-2xl bg-[var(--n50,#f9fafb)] overflow-hidden flex-1 min-h-0 flex items-stretch">
          <textarea
            className="w-full h-full bg-transparent resize-none px-3 py-2.5 focus:outline-none nodrag nopan text-sm text-[var(--sub,#374151)]"
            value={message}
            onChange={e => updateNodeConfig(id, 'message', e.target.value)}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            placeholder="Nhập kịch bản / tin nhắn... (Enter để Send, Shift+Enter xuống dòng)"
          />
        </div>

        {!isCompact && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--card-border,#f3f4f6)] rounded-b-2xl flex-shrink-0">
            <div className="w-4 h-4 rounded-md flex-shrink-0 flex items-center justify-center" style={{ background: categoryColor + '20' }}>
              <MessageCircle size={10} style={{ color: categoryColor }} />
            </div>
            <span className="text-[10px] text-[var(--n400,#9ca3af)] flex-1 truncate">Chat trigger</span>
            <button
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={{ background: '#111827' }}
              onMouseEnter={e => e.currentTarget.style.background = '#374151'}
              onMouseLeave={e => e.currentTarget.style.background = '#111827'}
              onClick={handleSend}
              title="Send"
            >
              <Send size={9} color="white" />
            </button>
          </div>
        )}
        {isCompact && (
          <div className="flex items-center justify-center px-2 py-1.5 rounded-b-2xl flex-shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: categoryColor }} />
          </div>
        )}

        <Handle
          type="source"
          id="message"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Message"
          style={{
            background: PORT_COLOR,
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
