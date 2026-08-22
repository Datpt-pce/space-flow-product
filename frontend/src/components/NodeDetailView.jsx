import { useEffect, useState } from 'react';
import { X, Play, Pin, PinOff } from 'lucide-react';
import { useStore } from '../store.js';
import { ConfigField } from './ConfigFields.jsx';
import { resolveDynamicPorts } from '../lib/dynamicPorts.js';
import DataViewer from './DataViewer.jsx';

// Small inline editor for setting sample input data on a port with no real
// connection yet (mock input — docs/product/node-spec/DISCUSSION.md mục 13).
function MockDataEditor({ nodeId, portId, currentValue }) {
  const setNodeMockInput = useStore(s => s.setNodeMockInput);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(currentValue ?? [], null, 2));
  const [error, setError] = useState(null);

  if (!open) {
    return (
      <button
        className="text-xs text-blue-500 hover:underline mt-2"
        onClick={() => setOpen(true)}
      >
        {currentValue !== undefined ? 'Edit mock data' : 'Set mock data'}
      </button>
    );
  }

  const handleSave = () => {
    try {
      const parsed = JSON.parse(text);
      setNodeMockInput(nodeId, portId, parsed);
      setError(null);
      setOpen(false);
    } catch {
      setError('JSON không hợp lệ');
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <textarea
        className="text-xs font-mono border border-[var(--card-border,#e5e7eb)] rounded-lg p-2 h-28 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
      <div className="flex items-center gap-2">
        <button
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
          onClick={handleSave}
        >
          Lưu
        </button>
        <button
          className="px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)]"
          onClick={() => setOpen(false)}
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}

// One tab per port, labeled "<label> (<N> items)" — matches how n8n's NDV
// shows branch data (If/Switch/Filter/Merge/Compare Datasets screenshots).
function PortColumn({ title, ports, dataByPort, emptyText, side, headerExtra, renderEmptyExtra }) {
  const [activeId, setActiveId] = useState(ports[0]?.id);
  const active = ports.find(p => p.id === activeId) || ports[0];
  const activeData = dataByPort[active?.id];

  return (
    <div
      className={`w-[300px] flex-shrink-0 flex flex-col overflow-hidden ${
        side === 'left' ? 'border-r' : 'border-l'
      } border-[var(--card-border,#f3f4f6)]`}
    >
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wide">{title}</h3>
          {headerExtra}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {ports.map(port => {
            const val = dataByPort[port.id];
            const count = Array.isArray(val) ? val.length : (val !== undefined ? 1 : 0);
            return (
              <button
                key={port.id}
                onClick={() => setActiveId(port.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  active?.id === port.id ? 'bg-blue-50 text-blue-600' : 'text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)]'
                }`}
              >
                {port.label} ({count} item{count === 1 ? '' : 's'})
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <DataViewer data={activeData} emptyText={emptyText(active)} />
        {activeData === undefined && renderEmptyExtra && renderEmptyExtra(active)}
      </div>
    </div>
  );
}

// NDV-style overlay (n8n-inspired): mở bằng double-click vào node, khác với
// ConfigPanel (panel nhỏ cố định góc phải, mở qua nút gear) — không thay thế,
// chỉ thêm một lối vào lớn hơn để sửa tham số + xem input/output của node.
export default function NodeDetailView() {
  const ndvNodeId = useStore(s => s.ndvNodeId);
  const nodes = useStore(s => s.nodes);
  const edges = useStore(s => s.edges);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const closeNodeDetail = useStore(s => s.closeNodeDetail);
  const nodeOutputs = useStore(s => s.nodeOutputs);
  const runWorkflow = useStore(s => s.runWorkflow);
  const nodePinnedData = useStore(s => s.nodePinnedData);
  const pinNodeOutput = useStore(s => s.pinNodeOutput);
  const unpinNodeOutput = useStore(s => s.unpinNodeOutput);
  const nodeMockInput = useStore(s => s.nodeMockInput);

  useEffect(() => {
    if (!ndvNodeId) return;
    const onKey = (e) => { if (e.key === 'Escape') closeNodeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ndvNodeId, closeNodeDetail]);

  const node = nodes.find(n => n.id === ndvNodeId);
  if (!node) return null;

  const { manifest, config } = node.data;
  const inputs = resolveDynamicPorts(manifest.inputs || [], manifest.dynamicInputs, config);
  const outputs = resolveDynamicPorts(manifest.outputs || [], manifest.dynamicOutputs, config);
  const outputData = nodeOutputs[node.id];

  // Static nodes (vd. Text) có output xác định ngay từ config, không cần chạy workflow
  // trước — nếu chưa có Run Data thật, fallback đọc thẳng config để port đích hiện
  // "đã nhận" ngay khi vừa nối dây, khớp precedent sẵn có ở BaseNode.jsx getIncomingCount().
  const staticSourceValue = (sourceNodeId, sourceHandle) => {
    const srcNode = nodes.find(n => n.id === sourceNodeId);
    if (srcNode?.type === 'text' && sourceHandle === 'text') {
      return srcNode.data?.config?.content || '';
    }
    return undefined;
  };

  const inputData = {};
  for (const port of inputs) {
    // 1 port có thể nhận nhiều edge (vd. nhiều node Text cùng nối vào 1 dot System
    // Prompt) — gộp giống executor.js: 1 edge → giá trị đơn, nhiều edge → mảng.
    const portEdges = edges.filter(e => e.target === node.id && e.targetHandle === port.id);
    const values = portEdges.map(e =>
      nodeOutputs[e.source]?.[e.sourceHandle] ?? staticSourceValue(e.source, e.sourceHandle)
    ).filter(v => v !== undefined);
    inputData[port.id] = values.length === 0 ? undefined : (values.length === 1 ? values[0] : values);
  }
  const inputEmptyText = (port) => {
    const connected = edges.some(e => e.target === node.id && e.targetHandle === port?.id);
    return connected ? 'Chưa có dữ liệu — chạy node nguồn trước' : 'Chưa kết nối';
  };
  const isPinned = !!nodePinnedData[node.id];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-8"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeNodeDetail(); }}
    >
      <div
        className="w-full bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex overflow-hidden"
        style={{ maxWidth: '1200px', height: '85vh' }}
      >
        {inputs.length > 0 && (
          <PortColumn
            title="Input"
            ports={inputs}
            dataByPort={inputData}
            emptyText={inputEmptyText}
            side="left"
            renderEmptyExtra={(port) => {
              const connected = edges.some(e => e.target === node.id && e.targetHandle === port?.id);
              if (connected || !port) return null;
              return (
                <MockDataEditor
                  nodeId={node.id}
                  portId={port.id}
                  currentValue={nodeMockInput[node.id]?.[port.id]}
                />
              );
            }}
          />
        )}

        {/* Config column */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-start gap-3 px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)] flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text,#111827)]">{manifest.name}</h2>
              <p className="text-sm text-[var(--n400,#9ca3af)] mt-1 leading-relaxed">{manifest.description}</p>
            </div>
            <button
              onClick={closeNodeDetail}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
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
              <p className="text-sm text-[var(--n400,#9ca3af)] italic py-8 text-center">No configuration options</p>
            )}
          </div>

          <div className="px-6 py-3 border-t border-[var(--card-border,#f3f4f6)] flex-shrink-0">
            <button
              onClick={() => runWorkflow(node.id)}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              <Play size={13} />
              Execute step
            </button>
          </div>
        </div>

        <PortColumn
          title="Output"
          ports={outputs}
          dataByPort={outputData || {}}
          emptyText={() => 'Chưa chạy — bấm Execute step để xem output'}
          side="right"
          headerExtra={
            <button
              onClick={() => (isPinned ? unpinNodeOutput(node.id) : pinNodeOutput(node.id))}
              disabled={!isPinned && !outputData}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                isPinned
                  ? 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                  : outputData
                    ? 'text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)]'
                    : 'text-[var(--n300,#d1d5db)] cursor-not-allowed'
              }`}
            >
              {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          }
        />
      </div>
    </div>
  );
}
