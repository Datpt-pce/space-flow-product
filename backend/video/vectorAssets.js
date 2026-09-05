const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { vectorSvg, vectorSize } = require('../../shared/video-vector');
const { isRasterMask, maskSvg } = require('../../shared/video-mask');
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const fontOptions = { font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } };
function measureTextWidth(line, p) {
  p = { ...p, fontSize: Math.max(1, Math.min(500, Number(p.fontSize) || 48)), letterSpacing: Math.max(-100, Math.min(500, Number(p.letterSpacing) || 0)) };
  if (!line.trim()) return line.length * p.fontSize * .3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16000" height="2000"><text x="500" y="1000" font-family="${escapeXml(p.fontFamily)}" font-size="${p.fontSize}" font-weight="${p.bold ? 700 : 400}" font-style="${p.italic ? 'italic' : 'normal'}" letter-spacing="${p.letterSpacing || 0}">${escapeXml(line)}</text></svg>`;
  return new Resvg(svg, fontOptions).innerBBox()?.width || 1;
}

// Generated assets live inside this render attempt and are removed with it.
// They never become user-owned media rows or overwrite external files.
async function prepareVectorAssets(state, assetPaths, assetKinds, outputDir) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  let index = 0;
  const tracks = state.tracks.map(track => {
    if (track.type !== 'text' && track.type !== 'shape') return track;
    return { ...track, type: 'video', muted: true, clips: track.clips.map(clip => {
      const assetId = `generated-vector-${index++}`;
      const pngPath = path.join(outputDir, `${assetId}.png`);
      const png = new Resvg(vectorSvg(clip, measureTextWidth), fontOptions).render().asPng();
      fs.writeFileSync(pngPath, png);
      assetPaths[assetId] = pngPath;
      assetKinds[assetId] = 'image';
      const { text, shape, ...rest } = clip;
      return { ...rest, assetId, sourceSize: vectorSize(clip) };
    }) };
  });
  return { ...state, tracks: tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
    if (!isRasterMask(clip.mask) || clip.mask.enabled === false) return clip;
    const assetId = `generated-mask-${index++}`, pngPath = path.join(outputDir, `${assetId}.png`);
    fs.writeFileSync(pngPath, new Resvg(maskSvg(clip.mask), { font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng());
    assetPaths[assetId] = pngPath; assetKinds[assetId] = 'image';
    return { ...clip, maskAssetId: assetId };
  }) })) };
}
module.exports = { prepareVectorAssets };
