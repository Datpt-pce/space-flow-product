import { useEffect, useRef, useState } from 'react';
import { X, File as FileIcon } from 'lucide-react';
import { useStore } from '../store.js';
import { uploadFile, previewUrl, fetchCredentials } from '../lib/api.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

export function getFilename(path) {
  return path.replace(/\\/g, '/').split('/').pop();
}

export function displayFilename(path) {
  return getFilename(path).replace(/^\d{13}-/, '');
}

export function isImageFile(path) {
  return IMAGE_EXT.has(getFilename(path).split('.').pop().toLowerCase());
}

export function FileListField({ field, value, onChange }) {
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
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">{field.label}</label>
      {files.length > 0 && (
        <div className="space-y-1 mb-2">
          {files.map((path, i) => {
            const filename = getFilename(path);
            const isImg = isImageFile(path);
            return (
              <div key={i} className="flex items-center gap-2 bg-[var(--n50,#f9fafb)] rounded-lg p-1.5">
                {isImg ? (
                  <img
                    src={previewUrl(path)}
                    className="w-8 h-8 object-cover rounded flex-shrink-0"
                    onError={e => { e.target.style.display = 'none'; }}
                    alt=""
                  />
                ) : (
                  <div className="w-8 h-8 bg-[var(--n200,#e5e7eb)] rounded flex items-center justify-center flex-shrink-0">
                    <FileIcon size={14} className="text-[var(--n400,#9ca3af)]" />
                  </div>
                )}
                <span className="text-[10px] text-[var(--sub,#4b5563)] flex-1 truncate">{displayFilename(path)}</span>
                <button
                  onClick={() => handleRemove(i)}
                  className="text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors flex-shrink-0"
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
        className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-[var(--n300,#d1d5db)] rounded-lg text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : '+ Add Files'}
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleAdd} />
    </div>
  );
}

function CredentialField({ field, value, onChange }) {
  const [list, setList] = useState([]);
  const openSettings = useStore(s => s.openSettings);

  useEffect(() => {
    fetchCredentials().then(setList).catch(() => setList([]));
  }, []);

  const inputClass = "w-full bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";
  const names = list.map(c => c.name);
  const publicNames = list.filter(c => c.scope === 'public').map(c => c.name);
  const privateNames = list.filter(c => c.scope === 'private').map(c => c.name);
  const unknownValue = value && !names.includes(value) ? [value] : [];

  return (
    <div>
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div className="flex items-center gap-1.5">
        <select className={inputClass + ' flex-1'} value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">— Chọn credential —</option>
          {unknownValue.map(n => <option key={n} value={n}>{n}</option>)}
          {privateNames.length > 0 && (
            <optgroup label="Của tôi">
              {privateNames.map(n => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          )}
          {publicNames.length > 0 && (
            <optgroup label="Chung">
              {publicNames.map(n => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={openSettings}
          className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Mới
        </button>
      </div>
      {list.length === 0 && (
        <p className="text-[10px] text-[var(--n400,#9ca3af)] mt-1">Chưa có credential nào — bấm "+ Mới" để tạo ở Settings.</p>
      )}
    </div>
  );
}

export function ConfigField({ field, value, onChange }) {
  const pickFile = useStore(s => s.pickFile);
  const label = (
    <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">
      {field.label}
      {field.required && <span className="text-red-400 ml-1">*</span>}
    </label>
  );

  const inputClass = "w-full bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";

  if (field.type === 'file-list') {
    return <FileListField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'credential') {
    return <CredentialField field={field} value={value} onChange={onChange} />;
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
        <span className="text-[11px] text-[var(--sub,#4b5563)] font-medium">{field.label}</span>
        <button
          onClick={() => onChange(!value)}
          className={`w-10 h-5 rounded-full transition-colors relative ${value ? 'bg-blue-500' : 'bg-[var(--n200,#e5e7eb)]'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--card,#fff)] shadow-sm transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          className={inputClass + ' resize-y h-40'}
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
            className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors"
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
