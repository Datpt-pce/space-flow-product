import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { browseFile, browseFolder } from '../../lib/api';
import { useStore } from '../../store';

// The same paired-agent picker and web fallback used by Media Bin.
export default function BatchPathInput({ value, onChange, label, placeholder, disabled, mode = 'folder', onError }) {
  const [picking, setPicking] = useState(false);
  async function pick() {
    setPicking(true);
    try {
      const result = await (mode === 'file' ? browseFile('media') : browseFolder());
      const path = result.error ? await new Promise(resolve => useStore.setState({ folderBrowserRequest: { mode, filter: 'media', resolve } })) : result.path;
      if (path) onChange(path);
    } catch (error) { onError?.(error.message); }
    finally { setPicking(false); }
  }
  return <div className="batch-inline batch-path-input">
    <input aria-label={label} placeholder={placeholder} disabled={disabled || picking} value={value} onChange={e => onChange(e.target.value)}/>
    <button type="button" aria-label={`Chọn ${mode === 'file' ? 'file' : 'thư mục'}: ${label}`} title={mode === 'file' ? 'Duyệt file trên máy của tôi' : 'Duyệt thư mục trên máy của tôi'} disabled={disabled || picking} onClick={pick}><FolderOpen size={16}/></button>
  </div>;
}
