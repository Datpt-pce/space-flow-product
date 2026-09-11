import { useLayoutEffect } from 'react';

export function useViewportMenu(ref, menu, setMenu) {
  useLayoutEffect(() => {
    if (!menu || !ref.current) return undefined;
    const contain = () => {
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8));
      const y = Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8));
      if (x !== menu.x || y !== menu.y) setMenu(current => current ? { ...current, x, y } : null);
    };
    contain();
    window.addEventListener('resize', contain);
    return () => window.removeEventListener('resize', contain);
  }, [ref, menu, setMenu]);
}
