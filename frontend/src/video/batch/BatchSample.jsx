import { useEffect, useRef } from 'react';
import Player from '../components/Player';
import { useVideoStore } from '../store';
import { useDialogFocus } from '../useDialogFocus';

export default function BatchSample({ document, onClose }) {
  const previous = useRef(null);
  const dialogRef=useDialogFocus(onClose);
  const playing = useVideoStore(s => s.isPlaying);
  useEffect(() => {
    const state = useVideoStore.getState();
    previous.current = Object.fromEntries(['projectState', 'playheadMs', 'selectedIds', 'primaryId', 'livePreviewPatch'].map(k => [k, state[k]]));
    useVideoStore.setState({ projectState: document, playheadMs: 0, isPlaying: false, selectedIds: [], primaryId: null, livePreviewPatch: null });
    return () => useVideoStore.setState({ ...previous.current, isPlaying: false });
  }, [document]);
  return <div className="batch-dialog-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Preview công thức" className="batch-dialog">
    <div className="batch-section-heading"><h2>Preview công thức</h2><button autoFocus onClick={onClose}>Đóng preview</button></div>
    <div className="batch-sample-player"><Player /></div>
    <button onClick={() => useVideoStore.getState().togglePlay()}>{playing ? 'Tạm dừng' : 'Phát bản thử'}</button>
  </section></div>;
}
