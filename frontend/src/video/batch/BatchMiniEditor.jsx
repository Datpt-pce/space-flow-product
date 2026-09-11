import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useDialogFocus } from '../useDialogFocus';

export default function BatchMiniEditor({ context, onClose }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const close = () => ready.current ? frame.current?.contentWindow?.postMessage({ type: 'batch-editor-close-request' }, location.origin) : onClose();
  const ref = useDialogFocus(close);
  useEffect(() => {
    const receive = event => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'batch-editor-ready') ready.current = true;
      if (event.data?.type === 'batch-editor-closed') onClose(event.data.itemId);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onClose]);
  return <div className="batch-dialog-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label="Video Editor trong Lab" className={`batch-dialog batch-mini-editor ${expanded ? 'batch-mini-expanded' : ''}`}>
    <div className="batch-section-heading"><div><h2>Video Editor · {context.name}</h2><p className="batch-muted">Timeline tự lưu · Chọn Lưu &amp; về Lab để áp dụng vào list</p></div><div className="batch-inline">
      <button onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Thu nhỏ editor' : 'Phóng to editor'}>{expanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
      <button onClick={close} aria-label="Đóng editor trong Lab"><X size={16}/></button>
    </div></div>
    <iframe ref={frame} title="Video Editor mini" src={`/video?${new URLSearchParams({ projectId: context.timelineId, labReturn: context.projectId, labList: context.listId, labItem: context.itemId, labMini: '1' })}`}/>
  </section></div>;
}
