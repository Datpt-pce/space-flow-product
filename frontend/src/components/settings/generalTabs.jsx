import { X } from 'lucide-react';
import { useStore } from '../../store.js';

const SHORTCUTS = [
  {
    section: 'Basics',
    items: [
      { label: 'Copy', keys: ['Ctrl', 'C'] },
      { label: 'Cut', keys: ['Ctrl', 'X'] },
      { label: 'Paste', keys: ['Ctrl', 'V'] },
      { label: 'Undo', keys: ['Ctrl', 'Z'] },
      { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: 'Select all', keys: ['Ctrl', 'A'] },
      { label: 'Duplicate', keys: ['Ctrl', 'D'] },
    ],
  },
  {
    section: 'Control',
    items: [
      { label: 'Delete', keys: ['Delete', 'Backspace'] },
      { label: 'Cancel / Close', keys: ['Esc'] },
      { label: 'Add elements', keys: ['Tab'] },
      { label: 'Run', keys: ['Ctrl', 'Enter'] },
    ],
  },
  {
    section: 'Navigation',
    items: [
      { label: 'Pan mode', keys: ['Space'] },
      { label: 'Zoom to fit', keys: ['Scroll'] },
      { label: 'Reset zoom', keys: ['Ctrl', 'O'] },
    ],
  },
];

const BG_OPTIONS = [
  { value: 'dots', label: 'Chấm' },
  { value: 'lines', label: 'Lưới ngang' },
  { value: 'cross', label: 'Lưới chéo' },
  { value: 'none', label: 'Trống' },
];

function KeyBadge({ children }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md border border-[var(--n300,#d1d5db)] bg-[var(--n100,#f3f4f6)] text-[11px] font-medium text-[var(--sub,#4b5563)] leading-none">
      {children}
    </span>
  );
}

export function ShortcutsTab() {
  return (
    <div className="flex flex-col gap-6 py-1">
      {SHORTCUTS.map(({ section, items }) => (
        <div key={section}>
          <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">{section}</p>
          <div className="flex flex-col gap-0.5">
            {items.map(({ label, keys }) => (
              <div key={label} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                <span className="text-sm text-[var(--sub,#374151)]">{label}</span>
                <div className="flex items-center gap-1">
                  {keys.map((k, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[var(--n300,#d1d5db)] text-xs">+</span>}
                      <KeyBadge>{k}</KeyBadge>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GeneralTab() {
  const canvasSettings = useStore(s => s.canvasSettings);
  const updateCanvasSettings = useStore(s => s.updateCanvasSettings);

  return (
    <div className="flex flex-col gap-6 py-1">
      {/* Background */}
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Canvas</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Nền canvas</span>
            <div className="flex gap-1">
              {BG_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateCanvasSettings({ backgroundVariant: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${canvasSettings.backgroundVariant === opt.value
                      ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
                      : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Snap to grid</span>
            <button
              onClick={() => updateCanvasSettings({ snapToGrid: !canvasSettings.snapToGrid })}
              className={`relative w-10 h-5 rounded-full transition-colors ${canvasSettings.snapToGrid ? 'bg-[var(--n900,#111827)]' : 'bg-[var(--n200,#e5e7eb)]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--card,#fff)] shadow transition-transform ${canvasSettings.snapToGrid ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {canvasSettings.snapToGrid && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--sub,#374151)]">Kích thước grid</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={8}
                  max={64}
                  step={4}
                  value={canvasSettings.snapGrid}
                  onChange={e => updateCanvasSettings({ snapGrid: Number(e.target.value) })}
                  className="w-24 accent-[var(--n900,#111827)]"
                />
                <span className="text-xs text-[var(--n500,#6b7280)] w-8 text-right">{canvasSettings.snapGrid}px</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function AppearanceTab() {
  const appearanceSettings = useStore(s => s.appearanceSettings);
  const updateAppearanceSettings = useStore(s => s.updateAppearanceSettings);

  return (
    <div className="flex flex-col gap-6 py-1">
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Giao diện</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Theme</span>
            <div className="flex gap-1">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateAppearanceSettings({ theme: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${appearanceSettings.theme === opt.value
                      ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
                      : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

