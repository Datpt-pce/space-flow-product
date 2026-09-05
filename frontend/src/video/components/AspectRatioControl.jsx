import { useState } from 'react';
import { useVideoStore } from '../store.js';
import { useDialogFocus } from '../useDialogFocus.js';

const PRESETS = [
  ['16:9', 1920, 1080], ['4:3', 1440, 1080], ['2.35:1', 1880, 800],
  ['2:1', 1920, 960], ['1.85:1', 1850, 1000], ['9:16', 1080, 1920],
  ['3:4', 1080, 1440], ['4:5', 1080, 1350], ['1:1', 1080, 1080],
];

function CustomSizeDialog({ resolution, onApply, onClose }) {
  const ref = useDialogFocus(onClose);
  const [width, setWidth] = useState(String(resolution.width));
  const [height, setHeight] = useState(String(resolution.height));
  const [error, setError] = useState('');
  const valid = value => Number.isInteger(Number(value)) && Number(value) >= 2 && Number(value) <= 4096 && Number(value) % 2 === 0;
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <form ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="custom-ratio-title"
      className="w-80 max-w-[calc(100vw-32px)] rounded-xl p-5 space-y-4 bg-[var(--card)] text-[var(--text)] border border-[var(--card-border)] shadow-xl"
      onSubmit={e => {
        e.preventDefault();
        if (!valid(width) || !valid(height)) { setError('Nhập kích thước chẵn từ 2 đến 4096 px.'); return; }
        onApply({ width: Number(width), height: Number(height) }); onClose();
      }}>
      <h2 id="custom-ratio-title" className="text-sm font-semibold">Kích thước khung hình</h2>
      <p className="text-xs text-[var(--n600)]">Áp dụng cho project và bản xuất theo kích thước gốc.</p>
      <div className="grid grid-cols-2 gap-3">{[
        ['Chiều rộng (px)', width, setWidth], ['Chiều cao (px)', height, setHeight],
      ].map(([label, value, setValue]) => <label key={label} className="text-xs space-y-1 block">{label}
        <input type="number" min="2" max="4096" step="2" required value={value} onChange={e => { setValue(e.target.value); setError(''); }}
          className="block w-full rounded border border-[var(--card-border)] bg-[var(--canvas)] p-2" />
      </label>)}</div>
      <p className="text-xs text-[var(--n600)]">Kích thước chẵn, tối đa 4096 px mỗi cạnh.</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 text-xs">
        <button type="button" className="px-3 py-2 rounded border border-[var(--card-border)]" onClick={onClose}>Hủy</button>
        <button type="submit" className="px-3 py-2 rounded bg-[var(--accent)] text-[var(--n0)]">Áp dụng</button>
      </div>
    </form>
  </div>;
}

export default function AspectRatioControl() {
  const projectState = useVideoStore(s => s.projectState);
  const assets = useVideoStore(s => s.assets);
  const pending = useVideoStore(s => s.pendingCommands);
  const [customOpen, setCustomOpen] = useState(false);
  const resolution = projectState?.resolution || { width: 1920, height: 1080 };
  const preset = PRESETS.find(([, w, h]) => Math.abs(resolution.width / resolution.height - w / h) < 0.001);
  const firstClip = (projectState?.tracks || []).filter(t => t.type === 'video').flatMap(t => t.clips).sort((a, b) => a.timelineInMs - b.timelineInMs)[0];
  const source = assets.find(a => a.id === firstClip?.assetId);
  const originalAvailable = source?.width >= 2 && source?.height >= 2;
  const blocked = !projectState || pending.some(c => c.status === 'conflict' || c.status === 'error');

  function applyResolution(next) {
    const store = useVideoStore.getState();
    const current = store.projectState?.resolution;
    if (!current) return;
    const changes = ['width', 'height'].filter(key => current[key] !== next[key]).map(key => ({ path: ['resolution', key], from: current[key], to: next[key] }));
    if (changes.length) store.execute('SetProperties', { changes });
  }

  return <>
    <label className="ml-auto flex items-center gap-2 text-xs shrink-0">Tỷ lệ
      <select aria-label="Tỷ lệ khung hình" title={`Khung project: ${resolution.width} × ${resolution.height} px`}
        disabled={blocked} value={preset?.[0] || 'current'}
        onChange={e => {
          if (e.target.value === 'custom') { e.currentTarget.focus(); setCustomOpen(true); return; }
          if (e.target.value === 'original' && originalAvailable) {
            const scale = Math.min(1, 4096 / Math.max(source.width, source.height));
            applyResolution({ width: Math.max(2, Math.round(source.width * scale / 2) * 2), height: Math.max(2, Math.round(source.height * scale / 2) * 2) });
            return;
          }
          const selected = PRESETS.find(([label]) => label === e.target.value);
          if (selected) applyResolution({ width: selected[1], height: selected[2] });
        }} className="h-8 max-w-44 rounded-lg border border-[var(--card-border)] px-2 bg-[var(--card)] text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        {!preset && <option value="current">{resolution.width} × {resolution.height}</option>}
        <option value="original" disabled={!originalAvailable}>Theo video gốc</option>
        <option value="custom">Tùy chỉnh…</option>
        {PRESETS.map(([label]) => <option key={label} value={label}>{label}</option>)}
      </select>
    </label>
    {customOpen && <CustomSizeDialog resolution={resolution} onApply={applyResolution} onClose={() => setCustomOpen(false)} />}
  </>;
}
