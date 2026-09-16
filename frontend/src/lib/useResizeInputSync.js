import { useEffect, useRef, useState } from 'react';

// One request at a time; changing inputs or pausing invalidates in-flight replies.
export function useResizeInputSync({ enabled, sourceKey, scan, onResult }) {
  const latest = useRef({ scan, onResult });
  latest.current = { scan, onResult };
  const refreshRef = useRef(() => {});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) { setRefreshing(false); return; }
    let active = true;
    let pending = false;
    let timer;
    const refresh = async () => {
      if (!active || pending || document.visibilityState === 'hidden') return;
      clearTimeout(timer); pending = true; setRefreshing(true);
      try {
        const result = await latest.current.scan();
        if (active) { latest.current.onResult(result); setError(''); }
      } catch (failure) { if (active) setError(failure.message); }
      finally {
        pending = false;
        if (active) { setRefreshing(false); timer = setTimeout(refresh, 3000); }
      }
    };
    refreshRef.current = refresh;
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    void refresh();
    return () => {
      active = false; clearTimeout(timer); refreshRef.current = () => {};
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, sourceKey]);
  return { refreshing, error, refresh: () => refreshRef.current() };
}
