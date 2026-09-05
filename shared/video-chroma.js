// Shadow compensation keys darker shades of the selected hue. Cleanup moves
// the matte boundary inward; feather softens it. Preview and export share math.
function chromaParams(params = {}) {
  const hex = String(params.color || '0x00ff00').replace(/^0x|#/i, '');
  const color = /^[0-9a-f]{6}$/i.test(hex) ? hex : '00ff00';
  const clamp = (value, fallback, min = 0) => Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : fallback;
  return { rgb: [0, 2, 4].map(i => parseInt(color.slice(i, i + 2), 16)),
    similarity: clamp(params.similarity, .3, .001), blend: clamp(params.blend, .1),
    shadow: clamp(params.shadow, 0), cleanup: clamp(params.cleanup, 0) };
}
function chromaAlpha(p, r, g, b) {
  const pixels = [r, g, b], energy = Math.max(1, p.rgb.reduce((sum, v) => sum + v * v, 0));
  const projection = Math.min(1, Math.max(0, pixels.reduce((sum, v, i) => sum + v * p.rgb[i], 0) / energy));
  const scale = 1 - p.shadow * (1 - projection);
  const distance = Math.sqrt(pixels.reduce((sum, v, i) => sum + (v - p.rgb[i] * scale) ** 2, 0) / 3) / 255;
  const threshold = p.similarity + p.cleanup * .25;
  return p.blend ? Math.min(1, Math.max(0, (distance - threshold) / p.blend)) : +(distance > threshold);
}
function chromaFfmpegExpr(params) {
  const p = chromaParams(params), channels = ['r(X,Y)', 'g(X,Y)', 'b(X,Y)'];
  const energy = Math.max(1, p.rgb.reduce((sum, v) => sum + v * v, 0));
  const projection = `clip((${channels.map((c, i) => `${c}*${p.rgb[i]}`).join('+')})/${energy},0,1)`;
  const scale = p.shadow ? `(1-${p.shadow}*(1-${projection}))` : '1';
  const distance = `(sqrt((${channels.map((c, i) => `pow(${c}-${p.rgb[i]}*${scale},2)`).join('+')})/3)/255)`;
  const threshold = p.similarity + p.cleanup * .25;
  const alpha = p.blend ? `clip((${distance}-${threshold})/${p.blend},0,1)` : `gt(${distance},${threshold})`;
  return alpha.replace(/,/g, '\\,');
}
module.exports = { chromaParams, chromaAlpha, chromaFfmpegExpr };
