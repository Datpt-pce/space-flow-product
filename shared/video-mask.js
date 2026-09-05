const MASK_DEFAULTS = { enabled: true, type: 'circle', x: 0.5, y: 0.5, width: 0.75, height: 0.75, rotation: 0, feather: 0, invert: false };
function maskFor(clip) {
  const m = { ...MASK_DEFAULTS, ...(clip.mask || {}) };
  const limits = { x: [0, 1], y: [0, 1], width: [.01, 2], height: [.01, 2], rotation: [-360, 360], feather: [0, 1] };
  for (const [key, [min, max]] of Object.entries(limits)) m[key] = Number.isFinite(m[key]) ? Math.max(min, Math.min(max, m[key])) : MASK_DEFAULTS[key];
  return m;
}
function maskDistance(type, u, v) {
  if (type === 'circle') return Math.sqrt(u * u + v * v);
  if (type === 'split') return v + 1;
  if (type === 'mirror') return Math.abs(v);
  if (type === 'diamond') return Math.abs(u) + Math.abs(v);
  if (type === 'heart') return Math.sqrt(u * u + (v + 0.35 * Math.sqrt(Math.abs(u))) ** 2);
  if (type === 'star') return Math.sqrt(u * u + v * v) / (0.7 + 0.3 * Math.cos(5 * (Math.atan2(v, u) + Math.PI / 2)));
  return Math.max(Math.abs(u), Math.abs(v));
}
function maskAlpha(mask, x, y) {
  const angle = mask.rotation * Math.PI / 180, dx = x - mask.x, dy = y - mask.y;
  const u = 2 * (dx * Math.cos(angle) + dy * Math.sin(angle)) / mask.width;
  const v = 2 * (-dx * Math.sin(angle) + dy * Math.cos(angle)) / mask.height;
  const d = maskDistance(mask.type, u, v);
  const a = mask.feather > 0 ? Math.max(0, Math.min(1, (1 - d) / mask.feather)) : +(d <= 1);
  return mask.invert ? 1 - a : a;
}
function maskFfmpegExpr(mask) {
  const angle = mask.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const u = `(2*((X/W-${mask.x})*${c}+(Y/H-${mask.y})*${s})/${mask.width})`;
  const v = `(2*(-(X/W-${mask.x})*${s}+(Y/H-${mask.y})*${c})/${mask.height})`;
  let d;
  if (mask.type === 'circle') d = `sqrt(${u}*${u}+${v}*${v})`;
  else if (mask.type === 'split') d = `(${v}+1)`;
  else if (mask.type === 'mirror') d = `abs(${v})`;
  else if (mask.type === 'diamond') d = `(abs(${u})+abs(${v}))`;
  else if (mask.type === 'heart') d = `sqrt(${u}*${u}+pow(${v}+0.35*sqrt(abs(${u})),2))`;
  else if (mask.type === 'star') d = `(sqrt(${u}*${u}+${v}*${v})/(0.7+0.3*cos(5*(atan2(${v},${u})+PI/2))))`;
  else d = `max(abs(${u}),abs(${v}))`;
  const alpha = mask.feather > 0 ? `clip((1-${d})/${mask.feather},0,1)` : `lte(${d},1)`;
  return (mask.invert ? `(1-${alpha})` : alpha).replace(/,/g, '\\,');
}
const isRasterMask = mask => ['text', 'brush', 'draw'].includes(mask?.type);
function maskSvg(raw, width = 1000, height = 1000) {
  const m = maskFor({ mask: raw });
  const ink = m.invert ? '#000000' : '#ffffff', background = m.invert ? '#ffffff' : '#000000';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  let body;
  if (m.type === 'text') body = `<text x="500" y="600" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="${Math.max(20, Math.min(800, m.fontSize || 300))}" fill="${ink}">${escape(String(m.text || 'TEXT').slice(0, 200))}</text>`;
  else body = (Array.isArray(m.paths) ? m.paths : []).slice(0, 64).filter(Array.isArray).map(points => {
    const coordinates = points.slice(0, 256).filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
      .map(p => p.map(v => Math.max(0, Math.min(1, v)) * 1000).join(',')).join(' ');
    return m.type === 'draw' ? `<polygon points="${coordinates}" fill="${ink}"/>`
      : `<polyline points="${coordinates}" fill="none" stroke="${ink}" stroke-width="${Math.max(1, Math.min(500, (m.brushWidth || .1) * 1000))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" preserveAspectRatio="none" viewBox="0 0 1000 1000"><defs><filter id="feather" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${m.feather * 100}"/></filter></defs><rect width="1000" height="1000" fill="${background}"/><g transform="translate(${m.x * 1000} ${m.y * 1000}) rotate(${m.rotation}) scale(${m.width} ${m.height}) translate(-500 -500)"${m.feather ? ' filter="url(#feather)"' : ''}>${body}</g></svg>`;
}
module.exports = { MASK_DEFAULTS, maskFor, maskAlpha, maskFfmpegExpr, isRasterMask, maskSvg };
