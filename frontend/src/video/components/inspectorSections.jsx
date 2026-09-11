import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function Disclosure({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--card-border,#e5e7eb)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full h-8 flex items-center justify-between text-[var(--n600,#4b5563)] hover:text-[var(--text,#111827)] focus-visible:ring-2 focus-visible:ring-[var(--accent,#7C5CFA)] focus-visible:ring-offset-1 rounded"
      >
        <span>{title}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// 08-UI §5.1 Priority 0 bước 3: banner cảnh báo dùng --status-run (amber có sẵn) qua color-mix()
// thay vì literal Tailwind amber-* — tái dùng 1 token duy nhất cho cả text/bg/border thay vì thêm
// token mới (chỉ 1 chỗ cần "warning" trong toàn app, chưa đủ lý do có --status-warn riêng).
export function WarningBanner({ children }) {
  return (
    <div
      className="rounded-lg px-2 py-1"
      style={{
        color: 'var(--status-run,#f59e0b)',
        backgroundColor: 'color-mix(in srgb, var(--status-run,#f59e0b) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--status-run,#f59e0b) 35%, transparent)',
      }}
    >
      {children}
    </div>
  );
}

