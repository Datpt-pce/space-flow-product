import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store.js';

export default function PreviewModal() {
  const previewMedia = useStore(s => s.previewMedia);
  const closePreview = useStore(s => s.closePreview);
  const [scale, setScale] = useState(1);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!previewMedia) return;
    setScale(1);
    const handleKey = (e) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [previewMedia, closePreview]);

  if (!previewMedia) return null;

  const { url, type, name } = previewMedia;

  const handleWheel = (e) => {
    e.preventDefault();
    setScale(s => Math.max(0.25, Math.min(5, s - e.deltaY * 0.001)));
  };

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) closePreview();
  };

  const zoom = (delta) => setScale(s => Math.max(0.25, Math.min(5, +(s + delta).toFixed(2))));

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 10000, background: 'rgba(0,0,0,0.85)' }}
      onClick={handleOverlayClick}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 pointer-events-none">
        <span className="text-[12px] text-white/70 truncate max-w-[60%]">{name}</span>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => zoom(-0.25)}
            title="Thu nhỏ"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-[11px] text-white/50 tabular-nums w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => zoom(0.25)}
            title="Phóng to"
          >
            <ZoomIn size={14} />
          </button>
          <div className="w-px h-4 bg-white/20 mx-1" />
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={closePreview}
            title="Đóng (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Media content */}
      <div
        className="overflow-hidden"
        style={{ maxWidth: '90vw', maxHeight: '90vh' }}
        onWheel={handleWheel}
      >
        {type === 'image' && (
          <img
            src={url}
            alt={name}
            draggable={false}
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              display: 'block',
              borderRadius: 4,
              transition: 'transform 0.1s ease',
            }}
          />
        )}
        {type === 'video' && (
          <video
            src={url}
            controls
            autoPlay
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              display: 'block',
              borderRadius: 4,
              transition: 'transform 0.1s ease',
            }}
          />
        )}
        {type !== 'image' && type !== 'video' && (
          <div className="text-white/50 text-sm">Không thể xem trước loại file này.</div>
        )}
      </div>
    </div>
  );
}
