import { useRef } from 'react';
import { basename, CopyButton } from './resizeUploadShared.jsx';

const normalized = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export default function ResizeResultLinks({ links = [], thumbnailLinks = [], row, catalog }) {
  const list = useRef(null);
  const thumbnailFolders = new Set([...thumbnailLinks.map(normalized), ...(row?.platforms || []).map(platform =>
    normalized(catalog?.[row.app]?.platforms?.[platform]?.thumbnail_folder))].filter(Boolean));
  const visible = [...new Set(links)].filter(link => !thumbnailFolders.has(normalized(link)));
  const scrollable = visible.length > 10;
  if (!visible.length) return null;
  return <div>
    <div ref={list} aria-label="Danh sách kết quả video" tabIndex={scrollable ? 0 : undefined}
      className="nodrag nowheel overflow-y-auto" style={scrollable ? { maxHeight: 240 } : undefined}>
      {visible.map(link => <div key={link} className="flex h-6 items-center gap-1"><span className="truncate flex-1" title={link}>{basename(link)}</span><CopyButton text={link} /></div>)}
    </div>
    {scrollable && <button type="button" className="text-red-500 mt-1 text-[10px]" onClick={() => list.current?.scrollBy({ top: list.current.clientHeight, behavior: 'smooth' })}>↓ Cuộn xuống · {visible.length} kết quả</button>}
  </div>;
}
