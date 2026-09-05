// One SVG description for browser preview and native resvg rasterization.
// All user strings are escaped; numeric/color fields are bounded before markup.
const TEXT_DEFAULTS = { content: 'Văn bản mới', width: 960, height: 320, fontFamily: 'Arial', fontSize: 72,
  color: '#ffffff', bold: false, italic: false, underline: false, case: 'none', align: 'center', verticalAlign: 'middle',
  letterSpacing: 0, lineHeight: 1.2, strokeEnabled: false, strokeColor: '#000000', strokeWidth: 2,
  backgroundEnabled: false, backgroundColor: '#000000', backgroundOpacity: 0.5,
  backgroundMode: 'block', backgroundRadius: 8, backgroundPaddingX: 14, backgroundPaddingY: 14,
  backgroundOffsetX: 0, backgroundOffsetY: 0, lineSpacing: 0,
  glowEnabled: false, glowColor: '#ffffff', glowBlur: 8, shadowEnabled: false,
  shadowColor: '#000000', shadowDistance: 10, shadowAngle: 45, shadowOpacity: 0.5, shadowBlur: 4, curve: 0 };
const SHAPE_DEFAULTS = { type: 'rectangle', width: 320, height: 320, fillEnabled: true,
  fillColor: '#999999', fillOpacity: 1, strokeEnabled: false, strokeColor: '#ffffff',
  strokeWidth: 4, strokeOpacity: 1, strokeStyle: 'solid', cornerRadius: 0,
  shadowEnabled: false, shadowColor: '#000000', shadowDistance: 10, shadowAngle: 45,
  shadowOpacity: 0.5, shadowBlur: 4 };
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const color = (value, fallback = '#ffffff') => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function vectorSize(clip) {
  const p = clip.shape || clip.text || {};
  const padding = Math.ceil(Math.max(p.backgroundEnabled ? Math.max(number(p.backgroundPaddingX, 14, 0, 300) + Math.abs(number(p.backgroundOffsetX, 0, -500, 500)), number(p.backgroundPaddingY, 14, 0, 300) + Math.abs(number(p.backgroundOffsetY, 0, -500, 500))) : 0, p.shadowEnabled ? number(p.shadowDistance, 10, 0, 200) + 3 * number(p.shadowBlur, 4, 0, 50) : 0,
    p.glowEnabled ? 3 * number(p.glowBlur, 8, 0, 50) : 0));
  const lines = String(p.content || '').split('\n').length;
  const textHeight = clip.text ? number(p.fontSize, 72, 4, 500) + (lines - 1) * Math.max(1, number(p.lineHeight, 1.2, .5, 4) * number(p.fontSize, 72, 4, 500) + number(p.lineSpacing, 0, -100, 500)) + 16 : 0;
  return { width: number(p.width, clip.shape ? 320 : 960, 2, 4096), height: Math.min(4096, Math.max(number(p.height, 320, 2, 4096), textHeight)), fit: 'native', padding };
}
function vectorSvg(clip, measureText) {
  const shape = !!clip.shape;
  const p = { ...(shape ? SHAPE_DEFAULTS : TEXT_DEFAULTS), ...(shape ? clip.shape : clip.text) };
  const { width: w, height: h, padding } = vectorSize(clip);
  const stroke = p.strokeEnabled ? number(p.strokeWidth, 2, 0, 100) : 0;
  const inset = stroke / 2;
  const angle = number(p.shadowAngle, 45, -360, 360) * Math.PI / 180;
  const distance = number(p.shadowDistance, 10, 0, 200);
  const shadow = p.shadowEnabled ? `<feDropShadow dx="${Math.cos(angle) * distance}" dy="${Math.sin(angle) * distance}" stdDeviation="${number(p.shadowBlur, 4, 0, 50)}" flood-color="${color(p.shadowColor, '#000000')}" flood-opacity="${number(p.shadowOpacity, 0.5, 0, 1)}"/>` : '';
  const glow = !shape && p.glowEnabled ? `<feDropShadow dx="0" dy="0" stdDeviation="${number(p.glowBlur, 8, 0, 50)}" flood-color="${color(p.glowColor)}"/>` : '';
  const filter = shadow || glow ? ' filter="url(#fx)"' : '';
  let body;
  if (shape) {
    const dash = p.strokeStyle === 'dashed' ? `${stroke * 3} ${stroke * 2}` : p.strokeStyle === 'dotted' ? `1 ${stroke * 2}` : 'none';
    const attrs = `fill="${p.fillEnabled ? color(p.fillColor, '#999999') : 'none'}" fill-opacity="${number(p.fillOpacity, 1, 0, 1)}" stroke="${color(p.strokeColor)}" stroke-width="${stroke}" stroke-opacity="${number(p.strokeOpacity, 1, 0, 1)}" stroke-dasharray="${dash}" stroke-linejoin="round"${filter}`;
    if (p.type === 'ellipse') body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - inset}" ry="${h / 2 - inset}" ${attrs}/>`;
    else if (p.type === 'triangle') body = `<polygon points="${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}" ${attrs}/>`;
    else if (p.type === 'star') {
      const points = Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 0.45 : 1; return `${w / 2 + Math.cos(a) * (w / 2 - inset) * r},${h / 2 + Math.sin(a) * (h / 2 - inset) * r}`; }).join(' ');
      body = `<polygon points="${points}" ${attrs}/>`;
    } else body = `<rect x="${inset}" y="${inset}" width="${Math.max(1, w - stroke)}" height="${Math.max(1, h - stroke)}" rx="${number(p.cornerRadius, 0, 0, Math.min(w, h) / 2)}" ${attrs}/>`;
  } else {
    let content = String(p.content).slice(0, 10000);
    if (p.case === 'upper') content = content.toLocaleUpperCase();
    if (p.case === 'lower') content = content.toLocaleLowerCase();
    if (p.case === 'title') content = content.toLocaleLowerCase().replace(/(^|\s)\S/g, value => value.toLocaleUpperCase());
    const lines = content.split('\n'), size = number(p.fontSize, 72, 4, 500);
    const lineHeight = Math.max(1, number(p.lineHeight, 1.2, 0.5, 4) * size + number(p.lineSpacing, 0, -100, 500));
    const x = p.align === 'left' ? 8 : p.align === 'right' ? w - 8 : w / 2;
    const anchor = p.align === 'left' ? 'start' : p.align === 'right' ? 'end' : 'middle';
    const attrs = `font-family="${escape(p.fontFamily)}" font-size="${size}" font-weight="${p.bold ? 700 : 400}" font-style="${p.italic ? 'italic' : 'normal'}" text-decoration="${p.underline ? 'underline' : 'none'}" letter-spacing="${number(p.letterSpacing, 0, -20, 100)}" fill="${color(p.color)}" stroke="${color(p.strokeColor, '#000000')}" stroke-width="${stroke}" paint-order="stroke fill" text-anchor="${anchor}"${filter}`;
    const curve = number(p.curve, 0, -100, 100);
    const top = p.verticalAlign === 'top' ? size + 8 : p.verticalAlign === 'bottom' ? h - 8 - (lines.length - 1) * lineHeight : (h - (lines.length - 1) * lineHeight) / 2 + size * 0.35;
    body = '';
    if (p.backgroundEnabled) {
      const widths = lines.map(line => Math.max(1, measureText ? measureText(line, p) : line.length * size * .6 + Math.max(0, line.length - 1) * number(p.letterSpacing, 0, -20, 100)));
      const px = number(p.backgroundPaddingX, 14, 0, 300), py = number(p.backgroundPaddingY, 14, 0, 300);
      const ox = number(p.backgroundOffsetX, 0, -500, 500), oy = number(p.backgroundOffsetY, 0, -500, 500);
      const boxes = p.backgroundMode === 'lines' ? widths.map((width, i) => ({ width, y: top - size * .8 + i * lineHeight, height: size })) : [{ width: Math.max(...widths), y: top - size * .8, height: size + (lines.length - 1) * lineHeight }];
      body = boxes.map(box => `<rect data-text-background="true" x="${x - (p.align === 'left' ? 0 : p.align === 'right' ? box.width : box.width / 2) - px + ox}" y="${box.y - py + oy}" width="${box.width + 2 * px}" height="${box.height + 2 * py}" rx="${number(p.backgroundRadius, 8, 0, 300)}" fill="${color(p.backgroundColor, '#000000')}" opacity="${number(p.backgroundOpacity, .5, 0, 1)}"/>`).join('');
    }
    if (curve) body += `<defs><path id="curve" d="M 8 ${h / 2} Q ${w / 2} ${h / 2 - curve * 2} ${w - 8} ${h / 2}"/></defs><text ${attrs}><textPath href="#curve" startOffset="${p.align === 'left' ? 0 : p.align === 'right' ? 100 : 50}%">${escape(content.replace(/\n/g, ' '))}</textPath></text>`;
    else {
      body += lines.map((line, i) => `<text x="${x}" y="${top + i * lineHeight}" ${attrs}>${escape(line)}</text>`).join('');
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w + padding * 2}" height="${h + padding * 2}" viewBox="${-padding} ${-padding} ${w + padding * 2} ${h + padding * 2}"><defs><filter id="fx" x="-100%" y="-100%" width="300%" height="300%">${glow}${shadow}</filter></defs>${body}</svg>`;
}
module.exports = { vectorSvg, vectorSize, TEXT_DEFAULTS, SHAPE_DEFAULTS };
