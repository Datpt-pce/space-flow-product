import { useEffect } from 'react';
import { useVideoStore } from './store.js';

export function useAssetPreviewPolling() {
  const pending = useVideoStore(s => s.assets.some(a => a.status === 'ok' && ['queued', 'running'].includes(a.previewStatus)));
  useEffect(() => {
    if (!pending) return;
    let disposed = false, timer;
    const poll = async () => {
      await useVideoStore.getState().fetchAssets({ silent: true });
      if (!disposed) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [pending]);
}
