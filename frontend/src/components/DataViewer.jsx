import { useState } from 'react';
import { normalizeToItems } from '../lib/items.js';
import { previewUrl } from '../lib/api.js';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Union of field names + types across every row's top-level keys — n8n-style Schema tab.
function buildSchema(rows) {
  const fields = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const t = typeOf(value);
      const existing = fields.get(key);
      if (!existing) fields.set(key, new Set([t]));
      else existing.add(t);
    }
  }
  return [...fields.entries()].map(([key, types]) => ({ key, types: [...types].join(' | ') }));
}

function isMediaMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

// Renders one port's data. Accepts either the standard Item[] envelope
// ({json, binary?}) or a bare array/value from a node not yet migrated to it —
// normalizeToItems() wraps the latter so Table/Schema/JSON keep working either way.
// Shared by NodeDetailView's INPUT and OUTPUT columns.
export default function DataViewer({ data, emptyText }) {
  const isItemArray = Array.isArray(data) && data.length > 0 &&
    data.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'json' in x);
  const items = isItemArray ? data : normalizeToItems(data);
  const hasBinary = Array.isArray(items) && items.length > 0 && items.every(x => x && 'json' in x) &&
    items.some(it => it.binary && Object.keys(it.binary).length > 0);

  const rows = Array.isArray(items) && items.length > 0 && items.every(x => x && 'json' in x)
    ? items.map(it => it.json)
    : null;
  const isTable = Array.isArray(rows) && rows.length > 0 &&
    rows.every(r => r && typeof r === 'object' && !Array.isArray(r));

  const defaultMode = isTable ? 'table' : Array.isArray(rows) ? 'schema' : 'json';
  const [mode, setMode] = useState(defaultMode);

  if (data === undefined) {
    return <p className="text-xs text-[var(--n400,#9ca3af)] italic py-6 text-center">{emptyText}</p>;
  }

  const cell = (v) => {
    if (v === undefined) return '';
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    return String(v);
  };

  const columns = isTable ? Array.from(new Set(rows.flatMap(row => Object.keys(row)))) : [];
  const schema = isTable || Array.isArray(rows) ? buildSchema(rows.filter(r => r && typeof r === 'object' && !Array.isArray(r))) : [];

  const modes = [
    Array.isArray(rows) && { id: 'schema', label: 'Schema' },
    isTable && { id: 'table', label: 'Table' },
    { id: 'json', label: 'JSON' },
    hasBinary && { id: 'binary', label: 'Binary' },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      {modes.length > 1 && (
        <div className="flex items-center gap-1">
          {modes.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                mode === m.id ? 'bg-blue-50 text-blue-600' : 'text-[var(--n400,#9ca3af)] hover:bg-[var(--n50,#f9fafb)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'schema' && Array.isArray(rows) && (
        schema.length > 0 ? (
          <div className="rounded-lg border border-[var(--card-border,#f3f4f6)] overflow-hidden">
            {schema.map(f => (
              <div key={f.key} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-[var(--card-border,#f9fafb)] last:border-0">
                <span className="text-[var(--sub,#374151)] font-medium">{f.key}</span>
                <span className="text-[var(--n400,#9ca3af)]">{f.types}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--n400,#9ca3af)] italic py-4 text-center">Item không phải object — không có schema field</p>
        )
      )}

      {mode === 'table' && isTable && (
        <div className="overflow-auto rounded-lg border border-[var(--card-border,#f3f4f6)] max-h-80">
          <table className="text-xs w-full border-collapse">
            <thead className="bg-[var(--n50,#f9fafb)] sticky top-0">
              <tr>
                {columns.map(col => (
                  <th key={col} className="text-left px-2 py-1.5 font-medium text-[var(--sub,#4b5563)] whitespace-nowrap border-b border-[var(--card-border,#f3f4f6)]">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--card-border,#f9fafb)] last:border-0">
                  {columns.map(col => (
                    <td key={col} className="px-2 py-1.5 text-[var(--sub,#374151)] whitespace-nowrap">{cell(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'json' && (
        <pre className="text-xs bg-[var(--n50,#f9fafb)] rounded-lg p-3 overflow-auto max-h-80 text-[var(--sub,#374151)] whitespace-pre-wrap">
          {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
        </pre>
      )}

      {mode === 'binary' && hasBinary && (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            it.binary && Object.entries(it.binary).map(([field, meta]) => (
              <div key={`${i}-${field}`} className="rounded-lg border border-[var(--card-border,#f3f4f6)] p-2 flex items-center gap-2">
                {isMediaMime(meta?.mimeType) && meta?.path && (
                  <img src={previewUrl(meta.path)} alt={meta.fileName || field} className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-[var(--sub,#374151)] truncate">{meta?.fileName || field}</div>
                  <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">{meta?.mimeType || 'unknown'} · {meta?.path}</div>
                </div>
              </div>
            ))
          ))}
        </div>
      )}
    </div>
  );
}
