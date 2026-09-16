import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { openFolder } from '../lib/api.js';
import { basename, CopyButton } from './resizeUploadShared.jsx';

export default function ResizeOpenFolderButton({ path, label, disabled = false }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  if (!path || /^(?:https?:\/\/|v32:\/\/)/i.test(path)) return null;
  const title = label || `Mở thư mục ${basename(path)}`;
  return <span className="inline-flex flex-wrap items-center gap-1 min-w-0">
    <button type="button" aria-label={title} title={`${title}\n${path}`} disabled={disabled || opening}
      className="nodrag inline-flex shrink-0 p-1 text-red-500 disabled:opacity-40" onClick={async event => {
        event.preventDefault(); event.stopPropagation(); setOpening(true); setError('');
        try { const result = await openFolder(path); if (result.error) throw new Error(result.error); }
        catch (failure) { setError(failure.message); }
        finally { setOpening(false); }
      }}><FolderOpen size={14} /></button>
    {error && <span role="alert" className="text-[11px] text-red-500 break-all">{error}<span className="flex items-center gap-1"><span>{path}</span><CopyButton text={path} /></span></span>}
  </span>;
}
