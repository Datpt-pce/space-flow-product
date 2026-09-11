import { useState, useEffect } from 'react';
import { Handle, Position, NodeToolbar, useUpdateNodeInternals } from '@xyflow/react';
import { Play, Settings2, Trash2, Copy, ChevronDown, Pin } from 'lucide-react';
import { useNodeChrome } from './useNodeChrome.js';
import { useHoverGrace } from './useHoverGrace.js';
import { ResizeControls, portPct } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';

// Bố cục ("Soft AI Canvas", hướng 4) cho 38 node dùng chung BaseNode. Nguồn thị giác:
// specs/node-ui-redesign-lts-beta/mockups/4-*.html + 6-node-gallery-full.html (đã user duyệt).

const DEFAULT_W = 220;
const MIN_W = 180, MAX_W = 560, MIN_H = 100, MAX_H = 600;

export default function BaseNodeBeta({ id, data, selected, width }) {
  const [runOpen, setRunOpen] = useState(false);
  const [isHovered, hoverHandlers] = useHoverGrace();
  const {
    manifest, Icon, categoryColor,
    status, isRunning, errorContinued, dotColor, progress,
    incomingByHandle, inputs, outputs, reachableCount, isActive, isPinned,
    defaultContentHeight, nodesCount,
    isDragOver, handleDragOver, handleDragLeave, handleFileDrop,
    handleDelete, runWorkflow, selectNode, openNodeDetail, duplicateNode,
  } = useNodeChrome(id, data);

  // Toolbar + resize-handles: hover HOẶC selected (đề xuất đã duyệt qua mockup/gallery).
  const chromeVisible = selected || isHovered;

  // Merge/Switch (dynamicInputs/dynamicOutputs) đổi số lượng port theo config — React Flow cache
  // vị trí handle riêng, không tự phát hiện handle mới/mất nếu không gọi updateNodeInternals(id)
  // sau khi số lượng port đổi (bug thật: kéo dây vào port vừa xuất hiện không bắt được, xem
  // frontend/src/nodes/portStyle.jsx và ListNodeBeta.jsx — cùng gốc, node nào có port động cũng
  // cần gọi hàm này).
  const updateNodeInternals = useUpdateNodeInternals();
  const portCountKey = `${inputs.length}:${outputs.length}`;
  useEffect(() => { updateNodeInternals(id); }, [portCountKey, updateNodeInternals, id]);

  return (
    <div
      className="relative flex flex-col"
      style={{ width: width || DEFAULT_W, height: '100%', opacity: isActive ? 1 : 0.4 }}
      {...hoverHandlers}
    >
      <ResizeControls
        selected={chromeVisible} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H}
        accentColor="var(--accent, #7C5CFA)" lineColor="color-mix(in srgb, var(--accent, #7C5CFA) 40%, transparent)"
      />

      <NodeToolbar isVisible={chromeVisible} position={Position.Top} align="start" offset={8}>
        <div
          className="flex items-center gap-0.5 rounded-2xl px-1.5 py-1.5"
          style={{ background: 'var(--card, #fff)', border: '1px solid var(--card-border, #e5e7eb)', boxShadow: 'var(--shadow-md)' }}
          {...hoverHandlers}
        >
          <div className="relative">
            <button className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-black/5 transition-colors" onClick={() => setRunOpen(o => !o)}>
              <Play size={12} style={{ color: 'var(--text, #374151)' }} />
              <ChevronDown size={9} style={{ color: 'var(--n400, #9ca3af)' }} />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 rounded-xl shadow-xl py-1 z-[9999] min-w-[180px]" style={{ background: 'var(--card,#fff)', border: '1px solid var(--card-border,#e5e7eb)' }}>
                <button className="w-full px-3 py-2 text-left hover:bg-black/5 flex items-center gap-2" onClick={() => { runWorkflow(id); setRunOpen(false); }}>
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text,#1f2937)' }}>✓ Run from here</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--n400,#9ca3af)' }}>~{reachableCount} nodes</span>
                </button>
                <button className="w-full px-3 py-2 text-left hover:bg-black/5 flex items-center gap-2" onClick={() => { runWorkflow(null); setRunOpen(false); }}>
                  <span className="text-[11px]" style={{ color: 'var(--sub,#4b5563)' }}>All workflow</span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--n400,#9ca3af)' }}>~{nodesCount} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4" style={{ background: 'var(--card-border,#e5e7eb)' }} />
          <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Configure node" onClick={() => selectNode(id)}>
            <Settings2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-black/5 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Duplicate node" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors" style={{ color: 'var(--sub,#6b7280)' }} title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      {/* Node label — icon đơn sắc + chấm category (không tô màu icon, đúng quy tắc mục 12) */}
      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 flex items-center gap-1.5 text-[11px] font-medium select-none truncate" style={{ color: 'var(--n700, #374151)' }}>
        <Icon size={12} style={{ color: 'var(--sub, #6b7280)', flexShrink: 0 }} />
        <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: categoryColor }} />
        <span className="truncate">
          {manifest.name} <span style={{ color: 'var(--n300, #d1d5db)' }}>#{data.nodeNumber ?? id.slice(-4)}</span>
          {!isActive && <span style={{ color: 'var(--n300, #d1d5db)' }}> (Deactivated)</span>}
        </span>
      </div>

      <div
        className="relative rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0"
        style={{
          width: width || DEFAULT_W,
          background: 'var(--card, #fff)',
          boxShadow: isDragOver
            ? '0 0 0 2px #60a5fa, var(--shadow-md)'
            : isPinned
              ? '0 0 0 2px var(--accent, #7C5CFA), var(--shadow-md)'
              : isRunning
                ? '0 0 0 2px #f59e0b, var(--shadow-md)'
                : selected
                  ? '0 0 0 2px var(--accent, #7C5CFA), var(--shadow-md)'
                  : 'var(--shadow-sm)',
          border: (isDragOver || isPinned || isRunning || selected) ? 'none' : '1px solid var(--card-border, #e5e7eb)',
        }}
        title={manifest.description}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
        onDoubleClick={() => openNodeDetail(id)}
      >
        {isPinned && (
          <div
            className="absolute top-2.5 left-2.5 w-5 h-5 rounded-full flex items-center justify-center z-10"
            style={{ background: 'var(--accent-tint, #EDE9FE)' }}
            title="Output pinned"
          >
            <Pin size={11} style={{ color: 'var(--accent, #7C5CFA)' }} fill="currentColor" />
          </div>
        )}

        {dotColor && (
          <div className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10" style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}80` }} />
        )}

        <div
          className="w-full rounded-2xl flex flex-col items-center justify-center gap-1 overflow-hidden flex-1 min-h-0"
          style={{ flexBasis: defaultContentHeight, background: 'var(--n50, #f9fafb)' }}
        >
          {isRunning && (
            progress?.percent != null ? (
              <div className="w-4/5 max-w-[140px]">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--n200, #e5e7eb)' }}>
                  <div className="h-full transition-all" style={{ width: `${progress.percent}%`, background: '#f59e0b' }} />
                </div>
                <div className="mt-1 text-[10px] text-center truncate" style={{ color: '#d97706' }}>
                  {progress.message || `${progress.percent}%`}
                </div>
              </div>
            ) : (
              <span className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>Processing...</span>
            )
          )}
          {status === 'done' && <span className="text-[11px] font-medium" style={{ color: 'var(--status-done, #22c55e)' }}>Done</span>}
          {status === 'error' && (
            <span className="text-[11px] font-medium" style={{ color: errorContinued ? 'var(--status-errcont, #f97316)' : 'var(--status-error, #ef4444)' }}>
              {errorContinued ? 'Error (continued)' : 'Error'}
            </span>
          )}
          {status === 'idle' && (
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--n100, #f3f4f6)' }}>
              <Icon size={20} style={{ color: 'var(--n500, #6b7280)' }} />
            </div>
          )}
        </div>

        {inputs.map((port, i) => (
          <div key={port.id} className="absolute" style={{ top: portPct(i, inputs.length), left: -13, transform: 'translateY(-50%)' }}>
            <Handle type="target" id={port.id} position={Position.Left} className="port-handle port-handle--input" data-label={port.label} style={{ ...portStyle(port.type, i, inputs.length, 'left'), position: 'static', top: 'auto', left: 'auto', transform: 'none' }}>
              {portGlyph(port.type)}
            </Handle>
            {incomingByHandle[port.id] > 0 && (
              <div className="absolute -top-1.5 -right-1.5 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-semibold leading-none px-0.5 z-10" style={{ background: 'var(--accent, #7C5CFA)' }}>
                {incomingByHandle[port.id]}
              </div>
            )}
          </div>
        ))}
        {outputs.map((port, i) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right} className="port-handle port-handle--output" data-label={port.label} style={portStyle(port.type, i, outputs.length, 'right')}>
            {portGlyph(port.type)}
          </Handle>
        ))}
      </div>
    </div>
  );
}
