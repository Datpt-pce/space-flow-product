import { useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Copy, Trash2, ChevronDown } from 'lucide-react';
import { useStore } from '../store.js';
import { ResizeControls } from './resizable.jsx';

const DEFAULT_W = 240, DEFAULT_H = 240;
const MIN_W = 160, MAX_W = 700, MIN_H = 140, MAX_H = 700;

const COLOR_MAP = {
  yellow: { bg: '#FEF3C7', border: '#FDE68A' },
  red:    { bg: '#FEE2E2', border: '#FCA5A5' },
  orange: { bg: '#FFEDD5', border: '#FED7AA' },
  green:  { bg: '#DCFCE7', border: '#86EFAC' },
  blue:   { bg: '#DBEAFE', border: '#93C5FD' },
  purple: { bg: '#EDE9FE', border: '#C4B5FD' },
  white:  { bg: '#FFFFFF', border: '#E5E7EB' },
};

const COLOR_SWATCHES = [
  { key: 'white',  hex: '#FFFFFF' },
  { key: 'red',    hex: '#FCA5A5' },
  { key: 'orange', hex: '#FED7AA' },
  { key: 'yellow', hex: '#FDE68A' },
  { key: 'green',  hex: '#86EFAC' },
  { key: 'blue',   hex: '#93C5FD' },
  { key: 'purple', hex: '#C4B5FD' },
];

export default function StickyNoteNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const color    = config.color    || 'yellow';
  const bold     = config.bold     || false;
  const italic   = config.italic   || false;
  const listMode = config.listMode || 'none';
  const content  = config.content  || '';

  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorRef = useRef(null);

  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);

  const { bg, border } = COLOR_MAP[color] || COLOR_MAP.yellow;
  const noteW = width || DEFAULT_W;

  useEffect(() => {
    function handleClickOutside(e) {
      if (colorRef.current && !colorRef.current.contains(e.target)) setShowColorPicker(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDelete = () => {
    deleteNode(id);
  };

  const toggleListMode = (mode) => {
    updateNodeConfig(id, 'listMode', listMode === mode ? 'none' : mode);
  };

  const handleContentChange = (e) => {
    const newVal = e.target.value;
    if (listMode === 'none') {
      updateNodeConfig(id, 'content', newVal);
      return;
    }
    const lines = newVal.split('\n');
    const prefix = listMode === 'bullet' ? '• ' : null;
    const cleaned = lines.map((line, i) => {
      if (listMode === 'bullet') return line.startsWith('• ') ? line : (line === '' ? '' : '• ' + line);
      if (listMode === 'numbered') {
        const match = line.match(/^\d+\.\s/);
        return match ? line : (line === '' ? '' : `${i + 1}. ` + line);
      }
      return line;
    });
    void prefix;
    updateNodeConfig(id, 'content', cleaned.join('\n'));
  };

  const contentStyle = {
    fontWeight: bold   ? 700 : 400,
    fontStyle:  italic ? 'italic' : 'normal',
    fontSize:   14,
    lineHeight: 1.6,
    color: '#374151',
    resize: 'none',
  };

  return (
    <div className="flex flex-col" style={{ width: noteW, height: '100%' }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-white rounded-2xl shadow-lg border border-gray-200 px-1.5 py-1.5">

          {/* Color picker */}
          <div className="relative" ref={colorRef}>
            <button
              className="flex items-center gap-1 px-1.5 py-1 rounded-xl hover:bg-gray-100 transition-colors nodrag"
              onClick={() => setShowColorPicker(v => !v)}
            >
              <div className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                style={{ background: COLOR_MAP[color]?.border || '#FDE68A' }} />
              <ChevronDown size={10} className="text-gray-400" />
            </button>
            {showColorPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-2xl shadow-xl border border-gray-200 p-2 flex gap-1.5 z-50 nodrag">
                {COLOR_SWATCHES.map(sw => (
                  <button
                    key={sw.key}
                    className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      background: sw.hex,
                      borderColor: color === sw.key ? '#3b82f6' : '#d1d5db',
                    }}
                    onClick={() => { updateNodeConfig(id, 'color', sw.key); setShowColorPicker(false); }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-gray-200" />

          {/* Format buttons */}
          <button
            className={`p-1.5 rounded-xl transition-colors ${bold ? 'bg-gray-100 text-gray-800' : 'hover:bg-gray-100 text-gray-500'}`}
            onClick={() => updateNodeConfig(id, 'bold', !bold)}
            title="Bold"
          >
            <Bold size={12} />
          </button>
          <button
            className={`p-1.5 rounded-xl transition-colors ${italic ? 'bg-gray-100 text-gray-800' : 'hover:bg-gray-100 text-gray-500'}`}
            onClick={() => updateNodeConfig(id, 'italic', !italic)}
            title="Italic"
          >
            <Italic size={12} />
          </button>
          <button
            className={`p-1.5 rounded-xl transition-colors ${listMode === 'bullet' ? 'bg-gray-100 text-gray-800' : 'hover:bg-gray-100 text-gray-500'}`}
            onClick={() => toggleListMode('bullet')}
            title="Bullet list"
          >
            <List size={12} />
          </button>
          <button
            className={`p-1.5 rounded-xl transition-colors ${listMode === 'numbered' ? 'bg-gray-100 text-gray-800' : 'hover:bg-gray-100 text-gray-500'}`}
            onClick={() => toggleListMode('numbered')}
            title="Numbered list"
          >
            <ListOrdered size={12} />
          </button>
          <button
            className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500"
            onClick={() => { updateNodeConfig(id, 'content', ''); updateNodeConfig(id, 'bold', false); updateNodeConfig(id, 'italic', false); updateNodeConfig(id, 'listMode', 'none'); }}
            title="Clear formatting"
          >
            <Minus size={12} />
          </button>

          <div className="w-px h-4 bg-gray-200" />

          <button className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-500" onClick={() => duplicateNode(id)} title="Duplicate">
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-gray-500 hover:text-red-500" onClick={handleDelete} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      {/* Card */}
      <div
        className={`relative rounded-2xl overflow-hidden transition-shadow flex flex-col flex-1 min-h-0 ${
          selected ? 'ring-2 ring-blue-500 shadow-lg' : 'shadow-sm hover:shadow-md'
        }`}
        style={{
          background: bg,
          border: `1px solid ${border}`,
          width: noteW,
          minHeight: DEFAULT_H,
        }}
      >
        {/* Textarea content */}
        <textarea
          className="w-full bg-transparent px-4 pt-4 pb-2 focus:outline-none nodrag nopan flex-1 min-h-0"
          style={contentStyle}
          value={content}
          onChange={handleContentChange}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          placeholder="Write something..."
        />

        {/* Bottom label */}
        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="text-[10px] text-gray-400 italic select-none truncate">
            {manifest.name}
          </span>
        </div>

      </div>
    </div>
  );
}
