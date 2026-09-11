// Render presets — Video Editor Phase 16 (specs/space-flow-master-plan/04-video-editor.md §5).
// Pure module (no fs/db, mirrors backend/video/renderPlanner.js's own "pure planner" precedent) —
// backend/routes/video-render.js is the only caller with DB/project access.
//
// Before this phase, `buildRenderPlan()` always exported at the project's OWN canvas
// resolution/fps with a fixed CRF 18 — ExportPanel.jsx's own header comment already documented
// this as "only ONE preset exists". A preset here only ever touches OUTPUT resolution + CRF
// (quality/file-size tradeoff), never fps or codec — deliberately narrow scope, matching the
// "giữ đơn giản" precedent Phase 9's transition duration and Phase 11's curves preset list already
// set: a small fixed table, no custom bitrate/2-pass/resolution-typing UI.
//
// `maxDimension: null` ("original") means "the project's own resolution, unscaled" — the
// pre-Phase-16 behavior exactly, so a render with no explicit preset (or presetId 'original')
// stays byte-identical to before.
const RENDER_PRESETS = {
  original: { label: 'Gốc (theo project)', maxDimension: null, crf: 18 },
  '1080p': { label: '1080p', maxDimension: 1080, crf: 20 },
  '720p': { label: '720p (nhẹ hơn)', maxDimension: 720, crf: 22 },
};

// resolveExportResolution(resolution, maxDimension) -> {width, height}. Scales the LONG edge down
// to `maxDimension` (preserving aspect ratio, matching every real "export at 1080p" tool's own
// behavior regardless of the source being landscape or portrait) — NEVER upscales (a project
// already at or below the target stays at its own resolution, same as `maxDimension: null`).
// Dimensions are rounded to the nearest EVEN number: ffmpeg's `yuv420p` pixel format (this file's
// own `-pix_fmt` in renderPlanner.js) requires even width/height for its 2x2 chroma subsampling —
// an odd dimension here would make ffmpeg reject the whole render at the very last step.
function resolveExportResolution(resolution, maxDimension) {
  if (!maxDimension) return resolution;
  const longEdge = Math.max(resolution.width, resolution.height);
  if (longEdge <= maxDimension) return resolution;
  const scale = maxDimension / longEdge;
  const width = Math.max(2, Math.round((resolution.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((resolution.height * scale) / 2) * 2);
  return { width, height };
}

module.exports = { RENDER_PRESETS, resolveExportResolution };
