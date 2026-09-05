// Video Editor Phase 7 (specs/space-flow-master-plan/04-video-editor.md §5): turns a series of
// {timeSec, value} sample points into an ffmpeg filter-option time expression (nested
// `if(lt(t,tN),segment,...)`), for embedding inside a `-filter_complex` chain. Commas inside the
// expression are escaped as `\,` — verified against a real multi-filter -filter_complex run
// (an unescaped comma inside if()/lt() is otherwise parsed as the filtergraph's OWN filter
// separator, not a function-argument separator).
//
// Segments between consecutive points are always LINEAR in the emitted expression — a caller
// wanting an eased curve (shared/video-keyframes.js's applyEasing) must pre-sample extra interior
// points along that curve before calling this (see backend/video/renderPlanner.js's
// sampleAnimatedTimesMs()); this function itself only ever draws straight lines between whatever
// points it's given.

function formatNum(n) {
  // Avoids scientific notation / long float noise in the filtergraph string (e.g. `1e-8` or
  // `0.1000000000000001`) — ffmpeg's expression parser accepts plain decimals reliably, exotic
  // notation is an unnecessary risk for a string built by string concatenation.
  return Number(n.toFixed(6)).toString();
}

// buildFfmpegTimeExpr(points, timeVar) -> expression string, or null for an empty input.
// `timeVar` is the ffmpeg variable name representing elapsed seconds in the filter this
// expression is embedded in — 't' for overlay/rotate, 'T' (uppercase) for geq.
function buildFfmpegTimeExpr(points, timeVar = 't') {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return formatNum(points[0].value);

  let expr = formatNum(points[points.length - 1].value); // t >= last point -> held at its value
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const span = b.timeSec - a.timeSec;
    const segment = span === 0
      ? formatNum(b.value)
      : `(${formatNum(a.value)}+(${formatNum(b.value)}-${formatNum(a.value)})*(${timeVar}-${formatNum(a.timeSec)})/${formatNum(span)})`;
    expr = `if(lt(${timeVar}\\,${formatNum(b.timeSec)})\\,${segment}\\,${expr})`;
  }
  expr = `if(lt(${timeVar}\\,${formatNum(points[0].timeSec)})\\,${formatNum(points[0].value)}\\,${expr})`; // t < first point -> held at its value
  return expr;
}

module.exports = { buildFfmpegTimeExpr };
