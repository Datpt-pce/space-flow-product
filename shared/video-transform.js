// Shared preview/export placement: fit the cropped source inside the canvas,
// preserving its aspect, then apply the user's scale, position and rotation.
// Native text/shape dimensions include optional transparent effect padding.
const CROP_DEFAULTS = { x: 0, y: 0, width: 1, height: 1 };
function normalizedCropFor(clip) {
  return { ...CROP_DEFAULTS, ...(clip.crop || {}) };
}
// isIdentityCrop: true for "no crop" (either `clip.crop` is absent, or explicitly set to the full
// frame) — both consumers use this to skip emitting any crop step at all in the common case,
// keeping pre-crop output/filtergraphs byte-identical for every clip that never sets this field.
function isIdentityCrop(crop) {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

function computeCanvasPlacement(transform, resolution, sourceSize, crop = CROP_DEFAULTS) {
  const { width, height } = resolution;
  const t = transform || {};
  const scaleX = t.scaleX ?? 1;
  const scaleY = t.scaleY ?? 1;
  // Fit the source (or cropped source) inside the composition before applying
  // user scale. Canvas ratio never implies a non-uniform media stretch.
  const sourceWidth = Number(sourceSize?.width) * crop.width;
  const sourceHeight = Number(sourceSize?.height) * crop.height;
  const hasSource = sourceWidth > 0 && sourceHeight > 0 && Number.isFinite(sourceWidth + sourceHeight);
  const fit = hasSource && sourceSize.fit !== 'native' ? Math.min(width / sourceWidth, height / sourceHeight) : 1;
  const baseWidth = hasSource ? sourceWidth * fit : width;
  const baseHeight = hasSource ? sourceHeight * fit : height;
  const padding = sourceSize?.fit === 'native' ? sourceSize.padding || 0 : 0;
  const destWidth = Math.max(2, Math.round((baseWidth + padding * 2) * scaleX));
  const destHeight = Math.max(2, Math.round((baseHeight + padding * 2) * scaleY));
  const x = Math.round(t.x || 0);
  const y = Math.round(t.y || 0);
  const rotationDeg = t.rotation || 0;
  const opacity = t.opacity ?? 1;

  // Centered on the canvas, then offset by (x, y) — the clip's own content is always placed
  // relative to the canvas center, not its top-left corner, matching how a "position" value
  // intuitively means "how far from centered" rather than "absolute pixel coordinate".
  const destX = Math.round((width - destWidth) / 2) + x;
  const destY = Math.round((height - destHeight) / 2) + y;

  return {
    destWidth, destHeight, destX, destY, opacity, baseWidth, baseHeight,
    rotationDeg,
    rotationRadians: (rotationDeg * Math.PI) / 180,
  };
}

module.exports = { computeCanvasPlacement, normalizedCropFor, isIdentityCrop, CROP_DEFAULTS };
