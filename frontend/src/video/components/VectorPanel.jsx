import { useEffect, useState } from 'react';
import { useVideoStore } from '../store.js';
import { findClipLocation } from '../timelineUtils.js';
import { TEXT_DEFAULTS, SHAPE_DEFAULTS } from '@shared/video-vector';
import PropertyField from './PropertyField.jsx';
import EffectsPanel from './EffectsPanel.jsx';
import { fetchSystemFonts } from '../../lib/api.js';
import FontPicker from './FontPicker.jsx';

const TEXT_PRESETS = [
  ['Nguyên bản', {}], ['Viền đen', { bold: true, strokeEnabled: true, strokeWidth: 4 }],
  ['Viền trắng', { color: '#000000', bold: true, strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 4 }],
  ['Vàng nổi', { color: '#ffff00', bold: true, strokeEnabled: true, strokeWidth: 4 }],
  ['Đỏ trắng', { color: '#ff3030', bold: true, strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 4 }],
  ['Xanh trắng', { color: '#00aaff', bold: true, strokeEnabled: true, strokeColor: '#ffffff', strokeWidth: 4 }],
  ['Nền vàng', { color: '#000000', bold: true, backgroundEnabled: true, backgroundColor: '#ffe500', backgroundOpacity: 1, backgroundRadius: 14 }],
  ['Nền tím', { bold: true, backgroundEnabled: true, backgroundColor: '#7c00ff', backgroundOpacity: 1, backgroundRadius: 14 }],
  ['Nền trắng', { color: '#000000', bold: true, backgroundEnabled: true, backgroundColor: '#ffffff', backgroundOpacity: 1 }],
  ['Neon hồng', { bold: true, glowEnabled: true, glowColor: '#ff0077', glowBlur: 14 }],
  ['Neon vàng', { bold: true, glowEnabled: true, glowColor: '#ffdd00', glowBlur: 14 }],
  ['Neon xanh', { bold: true, glowEnabled: true, glowColor: '#00ff44', glowBlur: 14 }],
];

export default function VectorPanel() {
  const state = useVideoStore(s => s.projectState), ids = useVideoStore(s => s.selectedIds), execute = useVideoStore(s => s.execute);
  const [sizeLinked, setSizeLinked] = useState(true);
  const [fonts, setFonts] = useState([]), [fontError, setFontError] = useState(null);
  const loadFonts = () => fetchSystemFonts().then(values => { setFonts(values); setFontError(null); }).catch(error => setFontError(error.message));
  useEffect(() => { loadFonts(); }, []);
  const location = ids.length === 1 ? findClipLocation(state, ids[0]) : null;
  const [textDraft, setTextDraft] = useState(location?.clip.text?.content || '');
  useEffect(() => { setTextDraft(location?.clip.text?.content || ''); }, [location?.clip.id, location?.clip.text?.content]);
  useEffect(() => () => useVideoStore.getState().clearLivePreviewPatch(), []);
  if (!location) return <p className="p-3 text-xs">Chọn một chữ hoặc shape để chỉnh.</p>;
  const { clip, track } = location, kind = clip.shape ? 'shape' : 'text';
  const defaults = kind === 'shape' ? SHAPE_DEFAULTS : TEXT_DEFAULTS;
  const properties = { ...defaults, ...clip[kind] };
  const base = ['tracks', state.tracks.indexOf(track), 'clips', location.index, kind];
  const set = (key, value) => {
    const changes = [{ path: [...base, key], from: clip[kind][key], to: value }];
    if (sizeLinked && (key === 'width' || key === 'height')) {
      const other = key === 'width' ? 'height' : 'width';
      changes.push({ path: [...base, other], from: clip[kind][other], to: Math.max(2, Math.min(4096, Math.round(properties[other] * value / properties[key]))) });
    }
    execute('SetProperties', { changes: changes.filter(change => !Object.is(change.from, change.to)) });
    useVideoStore.getState().clearLivePreviewPatch();
  };
  const field = (key, label, props = {}) => {
    const percent = key.endsWith('Opacity');
    return <PropertyField key={key} label={percent ? `${label} (%)` : label} value={percent ? Math.round(properties[key] * 100) : properties[key]}
      slider={!['width', 'height', 'letterSpacing', 'lineHeight'].includes(key)}
      onPreview={value => useVideoStore.getState().setLivePreviewPatch([{ clipId: clip.id, path: [kind, key], value: percent ? value / 100 : value }])}
      onCancelPreview={() => useVideoStore.getState().clearLivePreviewPatch()}
      onCommit={value => set(key, percent ? value / 100 : value)} {...props} {...(percent ? { min: 0, max: 100, step: 1 } : {})} />;
  };
  const resetGroup = title => {
    const prefix = title.toLowerCase();
    const changes = Object.keys(defaults).filter(key => key.startsWith(prefix) && !Object.is(clip[kind][key], defaults[key]))
      .map(key => ({ path: [...base, key], from: clip[kind][key], to: defaults[key] }));
    if (changes.length) execute('SetProperties', { changes });
  };
  const group = (title, enabled, children) => <details className="border-b border-[var(--card-border)] pb-3">
    <summary className="cursor-pointer py-2 font-medium">{title}</summary>
    <div className="space-y-2"><div className="flex justify-end"><button type="button" aria-label={`Đặt lại ${title}`} className="px-2 py-1 text-[var(--n600)] underline" onClick={() => resetGroup(title)}>Đặt lại</button></div>{enabled && field(enabled, `Bật ${title.toLowerCase()}`, { type: 'checkbox' })}{children}</div>
  </details>;
  return <div className="h-full overflow-y-auto text-xs">
    <div className="sticky top-0 z-10 border-b border-[var(--card-border)] bg-[var(--card)] px-3 py-2 font-medium">{kind === 'shape' ? 'Shape · Cơ bản' : 'Text · Cơ bản'}</div>
    <fieldset disabled={track.locked} className="p-3 space-y-3">
      {kind === 'text' ? <>
        <label className="block">Nội dung chữ<textarea aria-label="Nội dung chữ" className="mt-1 w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-2" rows={3} value={textDraft}
          onChange={e => { setTextDraft(e.target.value); useVideoStore.getState().setLivePreviewPatch([{ clipId: clip.id, path: ['text', 'content'], value: e.target.value }]); }}
          onBlur={() => { if (textDraft !== properties.content) set('content', textDraft); useVideoStore.getState().clearLivePreviewPatch(); }}
          onKeyDown={e => { if (e.key === 'Escape') { setTextDraft(properties.content); useVideoStore.getState().clearLivePreviewPatch(); e.stopPropagation(); } }} /></label>
        <FontPicker key={clip.id} value={properties.fontFamily} fonts={fonts} disabled={track.locked} onChange={value => set('fontFamily', value)} />
        <button type="button" className="underline text-[var(--n600)]" onClick={loadFonts}>Làm mới font hệ thống ({fonts.length})</button>
        {fontError && <p role="alert">{fontError}</p>}
        <details><summary className="cursor-pointer py-2">Preset style</summary><div className="grid grid-cols-6 gap-2">
          {TEXT_PRESETS.map(([name, preset]) => <button type="button" key={name} title={name} aria-label={`Style ${name}`} className="h-10 rounded-lg border border-[var(--card-border)] flex items-center justify-center" style={{ background: preset.backgroundColor || 'var(--n700)' }} onClick={() => {
            const style = { ...TEXT_DEFAULTS, ...preset };
            const keys = ['color', 'bold', 'italic', 'underline', ...Object.keys(style).filter(k => /^(stroke|background|glow|shadow)/.test(k))];
            execute('SetProperties', { changes: keys.filter(key => !Object.is(clip.text[key], style[key])).map(key => ({ path: [...base, key], from: clip.text[key], to: style[key] })) });
          }}><svg aria-hidden="true" width="44" height="32" viewBox="0 0 44 32"><text x="22" y="24" textAnchor="middle" fontSize="23" fontWeight={preset.bold ? 700 : 400} fill={preset.color || '#ffffff'} stroke={preset.strokeEnabled ? preset.strokeColor || '#000000' : 'none'} strokeWidth="2" paintOrder="stroke fill" style={preset.glowEnabled ? { filter: `drop-shadow(0 0 3px ${preset.glowColor})` } : undefined}>Aa</text></svg></button>)}
        </div></details>
        {field('fontSize', 'Cỡ chữ', { min: 4, max: 500 })}
        <div className="flex gap-2">{[['bold', 'B', 'Đậm'], ['italic', 'I', 'Nghiêng'], ['underline', 'U', 'Gạch chân']].map(([key, text, label]) => <button key={key} type="button" aria-label={label} aria-pressed={properties[key]} onClick={() => set(key, !properties[key])} className={`w-9 h-8 rounded border border-[var(--card-border)] ${properties[key] ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)]'}`}>{text}</button>)}</div>
        {field('case', 'Kiểu chữ', { options: [{ value: 'none', label: 'Nguyên bản' }, { value: 'upper', label: 'CHỮ HOA' }, { value: 'lower', label: 'chữ thường' }, { value: 'title', label: 'Viết Hoa Đầu Từ' }] })}
        {field('color', 'Màu chữ', { type: 'color' })}
        {field('align', 'Căn chữ', { options: [{ value: 'left', label: 'Trái' }, { value: 'center', label: 'Giữa' }, { value: 'right', label: 'Phải' }] })}
        {field('verticalAlign', 'Căn chữ dọc', { options: [{ value: 'top', label: 'Trên' }, { value: 'middle', label: 'Giữa' }, { value: 'bottom', label: 'Dưới' }] })}
        {field('letterSpacing', 'Giãn ký tự', { min: -20, max: 100, step: 0.5 })}
        {field('lineSpacing', 'Giãn dòng', { min: -100, max: 500, step: 1 })}
      </> : field('type', 'Hình dạng', { options: [{ value: 'rectangle', label: 'Chữ nhật' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'triangle', label: 'Tam giác' }, { value: 'star', label: 'Ngôi sao' }] })}
      <div className="space-y-2 border-t border-[var(--card-border)] pt-3">
        <PropertyField label="Liên kết W/H" type="checkbox" value={sizeLinked} onCommit={setSizeLinked} />
        {field('width', 'Chiều rộng', { min: 2, max: 4096 })}{field('height', 'Chiều cao', { min: 2, max: 4096 })}
      </div>
      <EffectsPanel embedded transformOnly />
      {kind === 'shape' && group('Fill', 'fillEnabled', <>{field('fillColor', 'Màu nền shape', { type: 'color' })}{field('fillOpacity', 'Độ đục nền', { max: 1, step: 0.01 })}</>)}
      {group('Stroke', 'strokeEnabled', <>
        {field('strokeColor', 'Màu viền', { type: 'color' })}{field('strokeWidth', 'Độ dày viền', { max: 100 })}
        {kind === 'shape' && <>{field('strokeStyle', 'Kiểu viền', { options: ['solid', 'dashed', 'dotted'] })}{field('strokeOpacity', 'Độ đục viền', { max: 1, step: 0.01 })}</>}
      </>)}
      {kind === 'shape' ? (properties.type === 'rectangle' && field('cornerRadius', 'Bo góc', { max: Math.min(properties.width, properties.height) / 2 })) : <>
        {group('Background', 'backgroundEnabled', <>
          {field('backgroundMode', 'Kiểu nền chữ', { options: [{ value: 'block', label: 'Toàn khối chữ' }, { value: 'lines', label: 'Bám từng dòng' }] })}
          {field('backgroundColor', 'Màu nền chữ', { type: 'color' })}{field('backgroundOpacity', 'Độ đục nền chữ', { max: 1, step: 0.01 })}
          {field('backgroundRadius', 'Bo góc nền chữ', { min: 0, max: 300 })}
          {field('backgroundPaddingX', 'Padding ngang', { min: 0, max: 300 })}{field('backgroundPaddingY', 'Padding dọc', { min: 0, max: 300 })}
          {field('backgroundOffsetX', 'X-offset nền chữ', { min: -500, max: 500 })}{field('backgroundOffsetY', 'Y-offset nền chữ', { min: -500, max: 500 })}
        </>)}
        {group('Glow', 'glowEnabled', <>{field('glowColor', 'Màu phát sáng', { type: 'color' })}{field('glowBlur', 'Độ lan sáng', { max: 50 })}</>)}
        {field('curve', 'Độ cong chữ', { min: -100, max: 100 })}
      </>}
      {group('Shadow', 'shadowEnabled', <>
        {field('shadowColor', 'Màu bóng', { type: 'color' })}{field('shadowDistance', 'Khoảng cách bóng', { max: 200 })}
        {field('shadowAngle', 'Góc bóng', { min: -360, max: 360 })}{field('shadowOpacity', 'Độ đục bóng', { max: 1, step: 0.01 })}{field('shadowBlur', 'Độ mờ bóng', { max: 50 })}
      </>)}
    </fieldset>
  </div>;
}
