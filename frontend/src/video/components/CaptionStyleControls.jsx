import { presets, positions, captionAppearance } from '../captionPresentation';
import './CaptionStyleControls.css';
import { useEffect, useState } from 'react';
import FontPicker from './FontPicker.jsx';
import { fetchSystemFonts } from '../../lib/api.js';

export default function CaptionStyleControls({ style, onChange, disabled=false, timeline=false }) {
  const [fonts,setFonts]=useState([]), [error,setError]=useState('');
  const loadFonts=() => fetchSystemFonts().then(value => { setFonts(value);setError(''); }).catch(e=>setError(e.message));
  useEffect(()=>{ loadFonts(); },[]);
  return <div className="caption-style-controls">
    <FontPicker value={style.fontFamily || 'Arial'} fonts={fonts} disabled={disabled} onChange={fontFamily=>onChange({ fontFamily })}/>
    <button type="button" disabled={disabled} onClick={loadFonts}>Làm mới font hệ thống ({fonts.length})</button>
    {error && <p role="alert">{error}</p>}
    <label>Preset chữ<select aria-label={timeline ? 'Kiểu captions trên timeline' : 'Kiểu captions'} disabled={disabled} value={style.preset || 'box'} onChange={e => onChange({ preset:e.target.value })}>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="caption-presets" role="group" aria-label="Preset chữ captions">
      {presets.map(p => <button type="button" key={p.id} disabled={disabled} aria-label={`Preset ${p.name}`} aria-pressed={style.preset === p.id} title={p.name} onClick={() => onChange({ preset:p.id })}><span style={captionAppearance({ preset:p.id,fontSize:23 })}>Aa</span></button>)}
    </div>
    <label>Cỡ chữ<input aria-label={timeline ? 'Cỡ chữ captions trên timeline' : 'Cỡ chữ captions'} type="number" min="4" max="500" value={style.fontSize || 32} disabled={disabled} onChange={e => { const size=Number(e.target.value);if(size >= 4 && size <= 500)onChange({ fontSize:size }); }}/></label>
    <div className="caption-position-row"><div><strong>Vị trí trong safe zone</strong><p>Áp dụng cùng vị trí cho các câu.</p></div><div className="caption-positions" role="group" aria-label="9 vị trí captions">
      {positions.map(([id,name]) => <button type="button" key={id} aria-label={`Vị trí ${name}`} title={name} aria-pressed={(style.position || 'bottom-center') === id} disabled={disabled} onClick={() => onChange({ position:id })}><span/></button>)}
    </div></div>
    <label>Lề an toàn (%)<input aria-label="Lề an toàn captions" type="number" min="4" max="20" value={style.safeMarginPct ?? 8} disabled={disabled} onChange={e => { const margin=Number(e.target.value);if(margin >= 4 && margin <= 20)onChange({ safeMarginPct:margin }); }}/></label>
  </div>;
}
