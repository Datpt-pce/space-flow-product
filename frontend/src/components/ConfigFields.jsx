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

// Custom Node Platform Phase 5 (specs/space-flow-master-plan/01-custom-node-platform.md):
// required/min/max/pattern validation for Manifest v2 config fields. Pure function of
// (field, value) — no submit/touched-state tracking exists in ConfigPanel today, so this is
// called fresh on every render rather than gated behind a form-submit step. An empty,
// non-required field skips min/max/pattern entirely (nothing to validate yet).
export function validateField(field, value) {
  const isEmpty = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);
  if (field.required && isEmpty) return 'Bắt buộc nhập';
  if (isEmpty) return null;

  if (field.type === 'number' || field.type === 'slider') {
    const n = Number(value);
    if (Number.isNaN(n)) return 'Phải là số';
    if (field.min !== undefined && n < field.min) return `Tối thiểu ${field.min}`;
    if (field.max !== undefined && n > field.max) return `Tối đa ${field.max}`;
  }

  if (field.pattern && typeof value === 'string') {
    try {
      if (!new RegExp(field.pattern).test(value)) return `Không khớp định dạng yêu cầu (${field.pattern})`;
    } catch {
      // Malformed regex authored by the node/package itself — don't block the user over it.
    }
  }

  return null;
}

function FieldError({ error }) {
  if (!error) return null;
  return <p className="text-[10px] text-red-500 mt-1">{error}</p>;
}

// value shape: [{ key, value }, ...] — a plain object can't preserve insertion order safely
// across edits (renaming a key mid-edit) the way an array of pairs can.
export function KeyValueField({ field, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const inputClass = "flex-1 bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2 py-1 text-xs text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";

  const updateRow = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...rows, { key: '', value: '' }]);

  return (
    <div>
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={inputClass} placeholder="key" value={row.key ?? ''} onChange={e => updateRow(i, { key: e.target.value })} />
            <input className={inputClass} placeholder="value" value={row.value ?? ''} onChange={e => updateRow(i, { value: e.target.value })} />
            <button onClick={() => removeRow(i)} className="text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addRow}
        className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-[var(--n300,#d1d5db)] rounded-lg text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + Add row
      </button>
      <FieldError error={validateField(field, value)} />
    </div>
  );
}

// field.columns: [{ id, label }, ...] declares an editable grid; without it, falls back to the
// same raw-JSON editor as `code` (there is no other generically-safe way to edit an array of
// arbitrary-shaped rows).
export function TableField({ field, value, onChange }) {
  if (!Array.isArray(field.columns) || field.columns.length === 0) {
    return <CodeField field={field} value={value} onChange={onChange} />;
  }

  const rows = Array.isArray(value) ? value : [];
  const cellClass = "w-full bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2 py-1 text-xs text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";

  const updateCell = (i, colId, v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [colId]: v } : r)));
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...rows, Object.fromEntries(field.columns.map(c => [c.id, '']))]);

  return (
    <div>
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {field.columns.map(col => (
              <input key={col.id} className={cellClass} placeholder={col.label} value={row[col.id] ?? ''} onChange={e => updateCell(i, col.id, e.target.value)} />
            ))}
            <button onClick={() => removeRow(i)} className="text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addRow}
        className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-[var(--n300,#d1d5db)] rounded-lg text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + Add row
      </button>
      <FieldError error={validateField(field, value)} />
    </div>
  );
}

// Raw-JSON editor for values that are arrays/objects (e.g. Manifest v2 fixtures' `"type":
// "code", "default": []` fields). Keeps its own local text buffer so an in-progress, momentarily
// invalid JSON string (e.g. `{"a":1` mid-keystroke) doesn't get clobbered by re-deriving text
// from `value` on every render — onChange(parsed) only fires once the buffer actually parses.
export function CodeField({ field, value, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? field.default ?? [], null, 2));
  const [parseError, setParseError] = useState(null);

  const handleInput = (raw) => {
    setText(raw);
    try {
      const parsed = JSON.parse(raw);
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError(err.message);
    }
  };

  return (
    <div>
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <textarea
        className="w-full bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors resize-y h-32"
        spellCheck={false}
        value={text}
        onChange={e => handleInput(e.target.value)}
      />
      {parseError ? (
        <p className="text-[10px] text-red-500 mt-1">JSON không hợp lệ: {parseError}</p>
      ) : (
        <FieldError error={validateField(field, value)} />
      )}
    </div>
  );
}

export function CredentialField({ field, value, onChange }) {
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
  const pickFolder = useStore(s => s.pickFolder);
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

  if (field.type === 'key-value') {
    return <KeyValueField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'table') {
    return <TableField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'code') {
    return <CodeField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select className={inputClass} value={value ?? field.default} onChange={e => onChange(e.target.value)}>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <FieldError error={validateField(field, value)} />
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
        <FieldError error={validateField(field, value)} />
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
        <FieldError error={validateField(field, value)} />
      </div>
    );
  }

  if (field.type === 'slider') {
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const current = value ?? field.default ?? min;
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[var(--sub,#4b5563)] font-medium">
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </span>
          <span className="text-[11px] text-[var(--n400,#9ca3af)]">{current}</span>
        </div>
        <input
          type="range"
          className="w-full accent-blue-500"
          min={min}
          max={max}
          step={field.step ?? 1}
          value={current}
          onChange={e => onChange(Number(e.target.value))}
        />
        <FieldError error={validateField(field, value)} />
      </div>
    );
  }

  if (field.type === 'color') {
    return (
      <div>
        {label}
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            className="w-8 h-8 rounded-lg border border-[var(--card-border,#e5e7eb)] cursor-pointer flex-shrink-0 p-0.5 bg-[var(--n50,#f9fafb)]"
            value={value || '#000000'}
            onChange={e => onChange(e.target.value)}
          />
          <input
            type="text"
            className={inputClass + ' flex-1'}
            value={value ?? ''}
            placeholder="#000000"
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <FieldError error={validateField(field, value)} />
      </div>
    );
  }

  if (field.type === 'file' || field.type === 'folder') {
    const isFolder = field.type === 'folder';
    return (
      <div>
        {label}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className={inputClass + ' flex-1'}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={isFolder ? 'C:\\path\\to\\folder' : 'C:\\path\\to\\file.jpg'}
          />
          <button
            type="button"
            onClick={async () => {
              const path = isFolder ? await pickFolder() : await pickFile('media');
              if (path) onChange(path);
            }}
            className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-[11px] text-[var(--n500,#6b7280)] hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            Browse…
          </button>
        </div>
        <FieldError error={validateField(field, value)} />
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
      <FieldError error={validateField(field, value)} />
    </div>
  );
}
