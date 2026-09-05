import { maskFor, maskAlpha, isRasterMask, maskSvg } from '@shared/video-mask';
import { chromaParams, chromaAlpha } from '@shared/video-chroma';
const maskCache = new Map();
const rasterCache = new Map();
export async function prepareMediaMask(clip, width, height) {
  if (!clip.mask || clip.mask.enabled === false || !isRasterMask(clip.mask)) return null;
  const key = `${width}:${height}:${JSON.stringify(clip.mask)}`;
  if (!rasterCache.has(key)) {
    if (rasterCache.size >= 4) rasterCache.delete(rasterCache.keys().next().value);
    rasterCache.set(key, (async () => {
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(maskSvg(clip.mask, width, height))}`;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, width, height).data;
    })());
  }
  return rasterCache.get(key);
}

// Runs only for active pixel effects. The reusable buffer avoids allocating a
// second full-resolution source image per frame. Ordinary playback bypasses it.
export function processMediaPixels(canvas, clip, rasterMask) {
  const chroma = (clip.effects || []).find(effect => effect.type === 'chromaKey' && effect.enabled);
  const mask = clip.mask?.enabled !== false && clip.mask ? maskFor(clip) : null;
  if (!chroma && !mask) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
  let maskPixels;
  if (mask && !isRasterMask(mask)) {
    const key = `${canvas.width}:${canvas.height}:${JSON.stringify(mask)}`;
    maskPixels = maskCache.get(key);
    if (!maskPixels) {
      maskPixels = new Uint8Array(canvas.width * canvas.height);
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) maskPixels[y * canvas.width + x] = Math.round(255 * maskAlpha(mask, x / canvas.width, y / canvas.height));
      if (maskCache.size >= 4) maskCache.delete(maskCache.keys().next().value);
      maskCache.set(key, maskPixels);
    }
  }
  const params = chromaParams(chroma?.params);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    let alpha = 1;
    if (chroma) {
      alpha = chromaAlpha(params, data[i], data[i + 1], data[i + 2]);
    }
    if (maskPixels) alpha *= maskPixels[y * canvas.width + x] / 255;
    if (rasterMask) alpha *= rasterMask[i] / 255;
    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
  ctx.putImageData(image, 0, 0);
}
