import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchSystemStatus, updateDependencies } from '../lib/api.js';

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
    <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md border border-gray-300 bg-gray-100 text-[11px] font-medium text-gray-600 leading-none">
      {children}
    </span>
  );
}

function ShortcutsTab() {
  return (
    <div className="flex flex-col gap-6 py-1">
      {SHORTCUTS.map(({ section, items }) => (
        <div key={section}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{section}</p>
          <div className="flex flex-col gap-0.5">
            {items.map(({ label, keys }) => (
              <div key={label} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                <span className="text-sm text-gray-700">{label}</span>
                <div className="flex items-center gap-1">
                  {keys.map((k, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-gray-300 text-xs">+</span>}
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

function GeneralTab() {
  const canvasSettings = useStore(s => s.canvasSettings);
  const updateCanvasSettings = useStore(s => s.updateCanvasSettings);

  return (
    <div className="flex flex-col gap-6 py-1">
      {/* Background */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Canvas</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Nền canvas</span>
            <div className="flex gap-1">
              {BG_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateCanvasSettings({ backgroundVariant: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${canvasSettings.backgroundVariant === opt.value
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Snap to grid</span>
            <button
              onClick={() => updateCanvasSettings({ snapToGrid: !canvasSettings.snapToGrid })}
              className={`relative w-10 h-5 rounded-full transition-colors ${canvasSettings.snapToGrid ? 'bg-gray-900' : 'bg-gray-200'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${canvasSettings.snapToGrid ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {canvasSettings.snapToGrid && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Kích thước grid</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={8}
                  max={64}
                  step={4}
                  value={canvasSettings.snapGrid}
                  onChange={e => updateCanvasSettings({ snapGrid: Number(e.target.value) })}
                  className="w-24 accent-gray-900"
                />
                <span className="text-xs text-gray-500 w-8 text-right">{canvasSettings.snapGrid}px</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemTab() {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [lines, setLines] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [available, setAvailable] = useState(null); // null = đang kiểm tra, true/false
  const logRef = useRef(null);

  useEffect(() => {
    fetchSystemStatus().then(res => setAvailable(res.available)).catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const handleUpdate = async () => {
    setStatus('running');
    setLines([]);
    setErrorMsg('');
    try {
      await updateDependencies((eventType, data) => {
        if (eventType === 'log') {
          setLines(prev => [...prev, data.line]);
        } else if (eventType === 'error') {
          setErrorMsg(`[${data.target}] ${data.error}`);
          setStatus('error');
        } else if (eventType === 'done') {
          setStatus('done');
        }
      });
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-4 py-1 h-full">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Thư viện</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700">Cập nhật root, frontend và backend</span>
          {available === false ? (
            <span className="text-xs text-gray-400">Không khả dụng ở môi trường này</span>
          ) : (
            <button
              onClick={handleUpdate}
              disabled={status === 'running' || available !== true}
              className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'running' && <Loader2 size={12} className="animate-spin" />}
              {status === 'running' ? 'Đang cập nhật...' : 'Cập nhật tất cả thư viện'}
            </button>
          )}
        </div>
        {available === false && (
          <p className="text-xs text-gray-400 mt-2">
            Chỉ chạy được ở máy dev (native) — nơi root, frontend và backend cùng nằm trên một máy.
            Trên bản product (Docker) mỗi service chạy trong container riêng nên không áp dụng được.
          </p>
        )}
      </div>

      {status === 'done' && (
        <p className="text-xs text-green-600">Hoàn tất — các thư viện đã ở bản mới nhất hoặc đã được cập nhật.</p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>
      )}

      {lines.length > 0 && (
        <pre
          ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto bg-gray-50 border border-gray-100 rounded-lg p-3 text-[11px] font-mono text-gray-600 whitespace-pre-wrap"
        >
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

export default function SettingsModal() {
  const isOpen = useStore(s => s.isSettingsOpen);
  const closeSettings = useStore(s => s.closeSettings);
  const [tab, setTab] = useState('general');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 flex overflow-hidden"
        style={{ width: 680, height: 480 }}>
        {/* Sidebar */}
        <div className="w-36 flex-shrink-0 border-r border-gray-100 flex flex-col pt-10 px-2 gap-0.5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">Settings</p>
          {[
            { id: 'general', label: 'General' },
            { id: 'shortcuts', label: 'Shortcuts' },
            { id: 'system', label: 'System' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${tab === t.id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">
              {tab === 'general' ? 'General' : tab === 'shortcuts' ? 'Shortcuts' : 'System'}
            </h2>
            <button
              onClick={closeSettings}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === 'general' ? <GeneralTab /> : tab === 'shortcuts' ? <ShortcutsTab /> : <SystemTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
