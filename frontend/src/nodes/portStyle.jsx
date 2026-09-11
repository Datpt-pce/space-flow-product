import { Folder, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { portPct } from './resizable.jsx';
import { resolveDynamicPorts } from '../lib/dynamicPorts.js';

// Quy chuẩn port thị giác dùng chung cho mọi node Beta (BaseNodeBeta.jsx + node có bố cục Beta
// riêng như ListNodeBeta.jsx) — xem docs/product/design-system.md mục "LTS/Beta component split".
// 6 port type thật (docs/product/data-flow.md) + "json" (quy ước riêng cho port "error", luôn viền
// đứt đỏ — không phải 1 trong 6 type chính) + boolean/trigger (chưa từng dùng thật, chỉ fallback).
export const PORT_TOKEN = {
  image: 'var(--pt-image, #a855f7)',
  text: 'var(--pt-text, #3b82f6)',
  number: 'var(--pt-number, #f97316)',
  file: 'var(--pt-file, #94a3b8)',
  array: 'var(--pt-array, #14b8a6)',
  any: 'var(--pt-any, #A6A6B3)',
  json: '#ef4444',
  boolean: 'var(--pt-any, #A6A6B3)',
  trigger: 'var(--pt-any, #A6A6B3)',
};

// Glyph type theo NỘI DUNG thực tế của port — khác port.type khai trong node.json khi 1 node cần
// phân biệt trực quan nhiều port cùng khai "array" (vd node List: files/text/rows, xem
// ListNodeBeta.jsx). Nguồn chuẩn duy nhất cho các override này — không định nghĩa lại ở nơi khác.
export const PORT_GLYPH_OVERRIDES = {
  list: { files: 'file', text: 'text', rows: 'array' },
};

// Type ngữ nghĩa thật của 1 port trên 1 node instance cụ thể — dùng để so sánh tương thích khi
// nối dây (isPortTypeCompatible), không phải để chọn glyph hiển thị (đó là PORT_GLYPH_OVERRIDES).
export function resolvePortType(node, portId, direction) {
  const manifest = node?.data?.manifest;
  if (!manifest) return 'any';
  const override = PORT_GLYPH_OVERRIDES[manifest.id]?.[portId];
  if (override) return override;
  const config = node.data?.config || {};
  const staticPorts = (direction === 'input' ? manifest.inputs : manifest.outputs) || [];
  const dynamicSpec = direction === 'input' ? manifest.dynamicInputs : manifest.dynamicOutputs;
  const ports = resolveDynamicPorts(staticPorts, dynamicSpec, config);
  return ports.find(p => p.id === portId)?.type || 'any';
}

// Soft-validate: lệch type chỉ cảnh báo (xem CustomEdge.jsx), không chặn kết nối. `any` tương
// thích với mọi type. Không phân biệt được nội dung *bên trong* "array" (vd GIF vs JSON record)
// — xem docs/product/data-flow.md mục "Connection conventions".
export function isPortTypeCompatible(a, b) {
  if (!a || !b) return true;
  if (a === 'any' || b === 'any') return true;
  return a === b;
}

export function portGlyph(type) {
  if (type === 'file') return <Folder size={10} strokeWidth={2} />;
  if (type === 'image') return <ImageIcon size={10} strokeWidth={2} />;
  if (type === 'json') return <AlertTriangle size={10} strokeWidth={2} />;
  if (type === 'array') return '▤';
  if (type === 'text') return 'T';
  if (type === 'number') return '#';
  return '∗';
}

// `type` ở đây là "glyph type" (1 trong PORT_TOKEN) — không nhất thiết trùng port.type khai trong
// node.json khi 1 node cần phân biệt trực quan nhiều port cùng khai `type: "array"` theo nội dung
// thực tế đang chứa (vd node List: files/text/rows đều là "array" ở node.json nhưng cần glyph khác
// nhau — xem ListNodeBeta.jsx).
export function portStyle(type, index, total, side) {
  const token = PORT_TOKEN[type] || PORT_TOKEN.any;
  return {
    background: 'var(--card, #fff)',
    color: token,
    border: `1.5px ${type === 'json' || type === 'any' ? 'dashed' : 'solid'} ${token}`,
    top: portPct(index, total),
    [side]: -13,
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
    boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(20,20,30,.04))',
    transform: 'translateY(-50%)',
  };
}
