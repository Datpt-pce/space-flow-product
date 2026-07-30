import { useRef, useState } from 'react';
import { X, File as FileIcon } from 'lucide-react';
import { useStore } from '../store.js';
import { uploadFile, previewUrl } from '../lib/api.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

function getFilename(path) {
  return path.replace(/\\/g, '/').split('/').pop();
}

function displayFilename(path) {
  return getFilename(path).replace(/^\d{13}-/, '');
}

function isImageFile(path) {
  return IMAGE_EXT.has(getFilename(path).split('.').pop().toLowerCase());
}

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
      className="absolute z-40 bg-white border border-gray-200 rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ top: 16, right: 16, width: 264, maxHeight: 'calc(100vh - 32px)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 leading-tight">{manifest.name}</h3>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{manifest.description}</p>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 mt-0.5"
        >
          <X size={13} />
        </button>
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {(manifest.config || []).map(field => (
          <ConfigField
            key={field.id}
            field={field}
            value={config[field.id]}
            onChange={v => updateNodeConfig(node.id, field.id, v)}
          />
        ))}

        {!manifest.config?.length && (
          <p className="text-[11px] text-gray-400 italic py-4 text-center">No configuration options</p>
        )}
      </div>
    </div>
  );
}

function FileListField({ field, value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const files = Array.isArray(value) ? value : [];

  const handleAdd = async (e) => {
    const picked = Array.from(e.target.files);
    if (!picked.length) return;
    setUploading(true);
    try {
      const results = await Promise.all(picked.map(f => uploadFile(f)));
      onChange([...files, ...results.map(r => r.path)]);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemove = (idx) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="block text-[11px] text-gray-600 mb-1 font-medium">{field.label}</label>
      {files.length > 0 && (
        <div className="space-y-1 mb-2">
          {files.map((path, i) => {
            const filename = getFilename(path);
            const isImg = isImageFile(path);
            return (
              <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-1.5">
                {isImg ? (
                  <img
                    src={previewUrl(path)}
                    className="w-8 h-8 object-cover rounded flex-shrink-0"
                    onError={e => { e.target.style.display = 'none'; }}
                    alt=""
                  />
                ) : (
                  <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                    <FileIcon size={14} className="text-gray-400" />
                  </div>
                )}
                <span className="text-[10px] text-gray-600 flex-1 truncate">{displayFilename(path)}</span>
                <button
                  onClick={() => handleRemove(i)}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : '+ Add Files'}
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleAdd} />
    </div>
  );
}

function ConfigField({ field, value, onChange }) {
  const pickFile = useStore(s => s.pickFile);
  const label = (
    <label className="block text-[11px] text-gray-600 mb-1 font-medium">
      {field.label}
      {field.required && <span className="text-red-400 ml-1">*</span>}
    </label>
  );

  const inputClass = "w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";

  if (field.type === 'file-list') {
    return <FileListField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select className={inputClass} value={value ?? field.default} onChange={e => onChange(e.target.value)}>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-600 font-medium">{field.label}</span>
        <button
          onClick={() => onChange(!value)}
          className={`w-10 h-5 rounded-full transition-colors relative ${value ? 'bg-blue-500' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          className={inputClass + ' resize-none h-24'}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
        />
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div>
        {label}
        <input
          type="number"
          className={inputClass}
          value={value ?? field.default ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
    );
  }

  if (field.type === 'file') {
    return (
      <div>
        {label}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className={inputClass + ' flex-1'}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder="C:\path\to\file.jpg"
          />
          <button
            type="button"
            onClick={async () => {
              const path = await pickFile('media');
              if (path) onChange(path);
            }}
            className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            Browse…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        type="text"
        className={inputClass}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
