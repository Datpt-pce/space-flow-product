import { useEffect, useRef } from 'react';

// Video dialogs share focus containment and keyboard isolation. Target-level input
// handlers still run; events stop at document before the editor's window shortcuts.
export function useDialogFocus(onClose, open = true) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return undefined;
    const previous = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] || dialog).focus({ preventScroll: true });
    const isTop = () => [...document.querySelectorAll('[aria-modal="true"]')].at(-1) === dialog;
    focusFirst();
    const background = [];
    for (let branch = dialog; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch) continue;
        background.push([sibling, sibling.inert, sibling.getAttribute('aria-hidden')]);
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (branch.parentElement === document.body) break;
    }
    function handleKeyDown(e) {
      if (!isTop()) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const items = focusable();
        const index = items.indexOf(document.activeElement);
        if (index < 0 || (e.shiftKey ? index === 0 : index === items.length - 1)) {
          e.preventDefault();
          (e.shiftKey ? items.at(-1) || dialog : items[0] || dialog).focus();
        }
      }
    }
    function handleFocus(e) {
      if (isTop() && !dialog.contains(e.target)) focusFirst();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
      for (const [element, inert, hidden] of background) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
