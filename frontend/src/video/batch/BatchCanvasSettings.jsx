import { useState } from 'react';
import { ASPECT_RATIO_PRESETS } from '../aspectRatioPresets.js';
import { useVideoStore } from '../store.js';

function PixelInput({ axis, value, disabled, onChange }) {
  const [input, setInput] = useState(null);
  const valid = raw => raw.trim() !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 16 && Number(raw) <= 7680 && Number(raw) % 2 === 0;
  const invalid = input !== null && !valid(input);
  return <label>{axis === 'width' ? 'W' : 'H'}
    <input aria-label={`Canvas ${axis}`} title={axis === 'width' ? 'Chiều rộng (px)' : 'Chiều cao (px)'}
      type="number" min={16} max={7680} step={2} disabled={disabled} value={input ?? value}
      aria-invalid={invalid} aria-describedby="batch-canvas-help"
      onChange={e => setInput(e.target.value)}
      onBlur={e => { if (input !== null && valid(e.target.value)) onChange(Number(e.target.value)); setInput(null); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>
    <span>px</span>
  </label>;
}

export default function BatchCanvasSettings({ project, disabled }) {
  const settings = project.draft.settings;
  const preset = ASPECT_RATIO_PRESETS.find(([, w, h]) => Math.abs(settings.width / settings.height - w / h) < .001);
  const edit = values => useVideoStore.getState().batchEdit(p => Object.assign(p.draft.settings, values));
  return <div className="batch-canvas-settings" aria-label="Khung hình Batch Timeline">
    <label>Tỷ lệ<select aria-label="Tỷ lệ Batch Timeline" disabled={disabled} value={preset?.[0] || 'custom'} onChange={e => {
      const selected = ASPECT_RATIO_PRESETS.find(([ratio]) => ratio === e.target.value);
      if (selected) edit({ width:selected[1], height:selected[2] });
    }}>
      <option value="custom" disabled>Tùy chỉnh W × H</option>
      {ASPECT_RATIO_PRESETS.map(([ratio]) => <option key={ratio} value={ratio}>{ratio}</option>)}
    </select></label>
    {['width', 'height'].map(axis => <PixelInput key={`${project.id}-${axis}`} axis={axis} value={settings[axis]} disabled={disabled} onChange={value => edit({ [axis]:value })}/>)}
    <label>FPS<select aria-label="FPS Batch Timeline" disabled={disabled} value={settings.fps} onChange={e => edit({ fps:Number(e.target.value) })}>{[24,25,30,50,60].map(n => <option key={n}>{n}</option>)}</select></label>
    <small id="batch-canvas-help">Toàn bộ batch · W/H chẵn, 16–7680 px</small>
  </div>;
}
