const {
  escapeWindowsPathForFilter, escapeDrawtextText, quoteFilterValue,
} = require('../ffmpegArgs');
const { computeCanvasPlacement, normalizedCropFor, isIdentityCrop } = require('../../../shared/video-transform');
const { chromaFfmpegExpr } = require('../../../shared/video-chroma');
const { maskFor, maskFfmpegExpr } = require('../../../shared/video-mask');
const {
  keyframesForProperty, isPropertyAnimated, evaluateClipTransformForExport,
} = require('../../../shared/video-keyframes');
const { buildFfmpegTimeExpr } = require('../keyframeExpr');

// sampleAnimatedTimesMs(clip, propertyKeys, samplesPerEasedSegment) -> sorted, deduped
// clip-relative timeMs to sample at: every keyframe time for each of `propertyKeys`, plus
// `samplesPerEasedSegment - 1` interior points for any segment whose STARTING keyframe uses a
// non-'linear' easing — buildFfmpegTimeExpr() only ever draws straight lines between the points
// it's given, so an eased curve needs to already be flattened into enough extra points to look
// right; a genuinely linear segment needs none (its own 2 endpoints are already exact).
function sampleAnimatedTimesMs(clip, propertyKeys, samplesPerEasedSegment = 6) {
  const times = new Set();
  for (const key of propertyKeys) {
    const kfs = keyframesForProperty(clip, `transform.${key}`);
    for (let i = 0; i < kfs.length; i++) {
      times.add(kfs[i].timeMs);
      if (i < kfs.length - 1 && kfs[i].easing && kfs[i].easing !== 'linear') {
        const a = kfs[i];
        const b = kfs[i + 1];
        for (let s = 1; s < samplesPerEasedSegment; s++) {
          times.add(a.timeMs + ((b.timeMs - a.timeMs) * s) / samplesPerEasedSegment);
        }
      }
    }
  }
  return [...times].sort((a, b) => a - b);
}

// buildAtempoChain(tempo) -> [factor, ...] whose PRODUCT equals `tempo`, each within ffmpeg's
// atempo filter's own valid range [0.5, 100] (verified against real ffmpeg — a direct
// atempo=0.25 is REJECTED: "Value 0.250000 for parameter 'tempo' out of range"). SPEED_PRESETS'
// smallest value (0.25x, frontend/src/video/components/VideoToolbar.jsx) needs exactly this: 2
// chained atempo=0.5 filters (0.5*0.5=0.25), also verified for real.
function buildAtempoChain(tempo) {
  const steps = [];
  let remaining = tempo;
  while (remaining < 0.5) { steps.push(0.5); remaining /= 0.5; }
  while (remaining > 100) { steps.push(100); remaining /= 100; }
  steps.push(remaining);
  return steps;
}

// buildSpeedAdjustedVideoSteps(clip, fps) -> the FIRST few filter steps of a clip's video
// content branch (trim/loop + setpts, replacing the pre-Phase-8 fixed
// `trim=...,setpts=PTS-STARTPTS` pair) — buildClipVideoBranch() appends scale/rotate/opacity
// after these unchanged.
//   - speed === 0 (freeze-frame): grabs ~1 frame at sourceInMs and loops it indefinitely via
//     ffmpeg's `loop` filter — the caller's fixed-duration black background + `overlay`'s
//     `shortest=1` (buildClipVideoBranch) truncate this infinite loop to the clip's real timeline
//     duration, so no explicit trim/`-t` is needed here. Verified against real ffmpeg.
//   - speed < 0 (reverse): `reverse` filter on the full trimmed range, THEN the same
//     setpts-based speed adjustment as the positive case (verified composable for real — a
//     combined reverse+2x spike produced the expected ~1s from a 2s@1x source).
//   - speed magnitude !== 1: `setpts=(PTS-STARTPTS)/|speed|` (ffmpeg speeds UP when you DIVIDE
//     PTS, matching this file's pre-existing convention of writing PTS math end-to-end explicit
//     rather than a magic single-step shortcut).
function buildSpeedAdjustedVideoSteps(clip, fps) {
  const speed = clip.speed ?? 1;
  const startSec = toSec(clip.sourceInMs);
  if (speed === 0) {
    const frameLenSec = 1 / fps;
    return [
      `trim=start=${startSec}:end=${startSec + frameLenSec}`, 'setpts=PTS-STARTPTS',
      'loop=loop=-1:size=1', `setpts=N/(${fps}*TB)`,
    ];
  }
  const steps = [`trim=start=${startSec}:end=${toSec(clip.sourceOutMs)}`, 'setpts=PTS-STARTPTS'];
  if (speed < 0) steps.push('reverse');
  const magnitude = Math.abs(speed);
  if (magnitude !== 1) steps.push(`setpts=(PTS-STARTPTS)/${magnitude}`);
  return steps;
}

// buildSpeedAdjustedAudioSteps(clip) -> the audio-branch equivalent of the function above
// (`atrim`/`areverse`/`atempo` chain instead of `trim`/`reverse`/`setpts`) — NEVER called for a
// frozen (speed 0) clip (buildSilentAudioBranch() handles that case instead, see its own comment).
function buildSpeedAdjustedAudioSteps(clip) {
  const speed = clip.speed ?? 1;
  const steps = [`atrim=start=${toSec(clip.sourceInMs)}:end=${toSec(clip.sourceOutMs)}`, 'asetpts=PTS-STARTPTS'];
  if (speed < 0) steps.push('areverse');
  const magnitude = Math.abs(speed);
  if (magnitude !== 1) steps.push(...(clip.preservePitch === false
    ? ['aresample=48000', `asetrate=${48000 * magnitude}`, 'aresample=48000']
    : buildAtempoChain(magnitude).map((t) => `atempo=${t}`)));
  return steps;
}

function sortedClips(track) {
  return [...(track?.clips || [])].sort((a, b) => a.timelineInMs - b.timelineInMs);
}

// 08-H S7 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md) +
// docs/decisions (verified against real ffmpeg first, see backend/video/spike/
// absolute-time-spike.js): clipsWithGaps(sortedClips) -> [{ clip, gapBeforeSec }] — gapBeforeSec
// is > 0 wherever this clip's own `timelineInMs` is later than where the previous clip (or project
// t=0, for the first clip) ended. This is the SINGLE source of truth both buildTrackLayer() (video)
// and buildRenderPlan()'s embedded-audio fallback read from to independently gap-fill their own
// video/silence segments — computed once here so the two can never drift out of sync with each
// other by duplicated arithmetic. Assumes `clips` is already sorted and non-overlapping (enforced
// by shared/video-commands' own invariants, not re-checked here).
function clipsWithGaps(clips) {
  const result = [];
  let cursorMs = 0;
  for (const clip of clips) {
    const gapBeforeSec = clip.timelineInMs > cursorMs ? toSec(clip.timelineInMs - cursorMs) : 0;
    result.push({ clip, gapBeforeSec });
    cursorMs = clip.timelineOutMs;
  }
  return result;
}

function toSec(ms) {
  return ms / 1000;
}

// drawtextLineExprs(content, {fontFilePath, fontsize, color, xExpr, yExprForLine, extraOpts}) ->
// one `drawtext=...` filter EXPRESSION per line of `content` (no `[in][out]` labels — callers chain
// each one onto their own running label, same as every other single-step filter in this file).
//
// 08-H5 audit (specs/.../08-v2/08-h-preview-and-render-parity.md): a raw newline byte embedded
// inside a single drawtext's own `text=` value is NOT safely parseable by ffmpeg's filtergraph
// STRING parser — verified against real ffmpeg: it throws "Error parsing a filter description"
// when the byte reaches the parser as-is (confirmed via a real subprocess spawn that bypasses any
// Windows-specific argv re-serialization). The 2-char escape `\n` (backslash+n) was also verified
// NOT to produce a line break in this ffmpeg build (drawtext prints a literal "n"). The only
// reliable, cross-platform way to render multi-line text (both `clip.text` and caption cues use a
// real `<textarea>`, so multi-line content is a real, reachable UI path, not a hypothetical) is one
// drawtext PER line, vertically stacked via `text_h` — ffmpeg's own per-instance runtime variable —
// so no server-side font-metrics guess is needed and every line naturally uses the same fontsize's
// real line height.
function drawtextLineExprs(content, { fontFilePath, fontsize, color, xExpr, yExprForLine, extraOpts = '' }) {
  const escapedFontPath = escapeWindowsPathForFilter(fontFilePath);
  const lines = String(content).split('\n');
  return lines.map((line, i) => {
    const escapedText = escapeDrawtextText(line);
    const yExpr = yExprForLine(i, lines.length);
    return `drawtext=fontfile=${quoteFilterValue(escapedFontPath)}:text=${quoteFilterValue(escapedText)}:x=${xExpr}:y=${yExpr}:fontsize=${fontsize}:fontcolor=${color}${extraOpts}`;
  });
}

// makeInputResolver(assetPaths, assetKinds) -> inputIndexFor(assetId), plus the ordered `-i`
// input list it built along the way — dedups so a clip pointing back to an already-used asset
// shares 1 input. Phase 14 (§0): each entry also carries its `kind` (from `assetKinds`, default
// 'video' for callers/tests that don't pass one — every pre-Phase-14 caller's assets are video/
// audio, never affected by the `-loop 1` branch below) so buildRenderPlan() can give an image
// asset the ffmpeg input flags a still frame needs to behave like an indefinitely-repeating video
// stream (see buildRenderPlan()'s own comment on sticker/overlay compositing for why no OTHER
// part of this file needs to know a clip's asset is an image — `[idx:v]` addresses it exactly
// like any real video input once ffmpeg has looped it).
function makeInputResolver(assetPaths, assetKinds = {}) {
  const inputPaths = [];
  function inputIndexFor(assetId) {
    const p = assetPaths[assetId];
    if (!p) throw new Error(`No resolved file path for asset "${assetId}" — pass every clip's asset in assetPaths`);
    let idx = inputPaths.findIndex((entry) => entry.path === p);
    if (idx === -1) {
      inputPaths.push({ path: p, kind: assetKinds[assetId] || 'video' });
      idx = inputPaths.length - 1;
    }
    return idx;
  }
  return { inputIndexFor, inputPaths };
}

// buildClipVideoBranch(clip, inputIdx, label, resolution, fps, fontFilePath) -> filtergraph
// fragment producing output pad `[label]`: this clip's own content, scaled/rotated/positioned/
// opacity-composited onto a fixed project-resolution black canvas, with optional video fade
// in/out and a drawtext overlay. `fontFilePath` is only touched when the clip actually has
// `clip.text` — callers with no text-overlay clips in their project never need to resolve one
// (see backend/video/fontResolver.js for how the caller gets this value; deliberately NOT
// resolved in here — this module stays a pure function of its arguments, no fs access).
//
// Placement (destWidth/destHeight/destX/destY/rotation) comes from shared/video-transform.js's
// computeCanvasPlacement() — Phase 5's shared source of truth so this ffmpeg math and the Canvas
// preview engine's own placement can never independently drift on the same transform values.
// `transparentBg` (Phase 12, §0): false (default) is the exact pre-Phase-12 behavior — the clip
// composites onto an OPAQUE black canvas, used for the base video track. true is new: the bg is
// black at alpha 0 (`color=c=black@0.0`, followed by an explicit `format=yuva420p` since the alpha
// channel doesn't survive onto the stream implicitly — verified against real ffmpeg), used for
// every ADDITIONAL video track (buildRenderPlan's overlay compositing below) so a keyed-out or
// out-of-bounds pixel reveals whatever is UNDERNEATH once composited, not this clip's own canvas.
function buildClipVideoBranch(clip, inputIdx, label, resolution, fps, fontFilePath, transparentBg = false) {
  const { width, height } = resolution;
  const clipDurationSec = toSec(clip.timelineOutMs - clip.timelineInMs);
  // scaleX/scaleY/rotation are NEVER animated in export (see evaluateClipTransformForExport's own
  // comment) so w/h/rotationRadians are always a single static value regardless of keyframes —
  // only destX/destY/opacity below become per-frame expressions when actually animated.
  const staticTransform = evaluateClipTransformForExport(clip, 0);
  const staticPlacement = computeCanvasPlacement(staticTransform, resolution, clip.sourceSize, normalizedCropFor(clip));
  const { destWidth: w, destHeight: h, rotationRadians } = staticPlacement;
  // 08-G G3 rotation pivot (ADR 0035, docs/decisions/0035-clip-rotation-pivot-minimal-slice.md):
  // read straight off the raw (export-frozen) transform, not `staticPlacement` — computeCanvasPlacement()
  // deliberately never touches pivot (see that file's own header comment), same reason canvasEngine.js's
  // drawSample() also reads pivot off `transform` directly rather than through `placement`.
  const isCenterPivot = staticTransform.pivotX === 0.5 && staticTransform.pivotY === 0.5;

  // Rotation-centering compensation (08-G G3, 2026-09-05 — found while researching the ffmpeg
  // technique for anchor/pivot, confirmed with a real ffmpeg render before fixing, unrelated to
  // pivot itself). The `rotate=` step below deliberately expands its OWN output buffer to
  // `rotw(rot)`/`roth(rot)` (the rotated bounding box) so a non-90°-multiple rotation doesn't clip
  // its corners inside this clip's isolated buffer — but `overlay=` positions by TOP-LEFT corner,
  // so without compensating destX/destY the visual CENTER of the rotated content silently drifted
  // by half of each axis's size growth (verified: a 300x120 red box rotated 45° showed BLACK at
  // its own true center and RED 50px further down instead — the growth is asymmetric whenever
  // destWidth != destHeight, which any non-1:1 scaleX/scaleY combined with rotation produces).
  // Canvas2D's preview equivalent (canvasEngine.js's drawSample) has no such artifact — `ctx.
  // rotate()` rotates the drawing plane around the box's own center directly, no intermediate
  // buffer resize at all — so this was ALSO a preview/export parity bug (08-H's whole concern),
  // not just an export cosmetic issue. Deliberately NOT folded into shared/video-transform.js's
  // computeCanvasPlacement() (which both preview and export read): applying it there would
  // un-fix the already-correct preview instead of fixing export.
  //
  // ONLY applies when the pivot is centered (`isCenterPivot`) — an off-center pivot below uses the
  // pad/crop technique instead (ADR 0035), which keeps the output buffer at the ORIGINAL w×h size
  // and needs no destX/destY compensation of its own; the two techniques are deliberately kept
  // mutually exclusive per clip, never combined.
  let rotCompX = 0;
  let rotCompY = 0;
  if (rotationRadians && isCenterPivot) {
    const absCos = Math.abs(Math.cos(rotationRadians));
    const absSin = Math.abs(Math.sin(rotationRadians));
    const rotw = w * absCos + h * absSin;
    const roth = w * absSin + h * absCos;
    rotCompX = -(rotw - w) / 2;
    rotCompY = -(roth - h) / 2;
  }

  // Position (x/y): destX depends only on x (scaleX is frozen for export, see
  // evaluateClipTransformForExport), destY only on y — so each axis is sampled and expressed
  // fully independently. Unanimated -> stays a plain number, byte-identical to the pre-Phase-7
  // code path (existing golden tests for non-keyframed clips are unaffected); animating only ONE
  // axis leaves the other a plain number too, not an unnecessary constant-valued expression.
  let destXExpr = String(staticPlacement.destX + rotCompX);
  let destYExpr = String(staticPlacement.destY + rotCompY);
  if (isPropertyAnimated(clip, 'x')) {
    const points = sampleAnimatedTimesMs(clip, ['x']).map((timeMs) => ({
      timeSec: toSec(timeMs),
      value: computeCanvasPlacement(evaluateClipTransformForExport(clip, timeMs), resolution, clip.sourceSize, normalizedCropFor(clip)).destX + rotCompX,
    }));
    destXExpr = buildFfmpegTimeExpr(points, 't');
  }
  if (isPropertyAnimated(clip, 'y')) {
    const points = sampleAnimatedTimesMs(clip, ['y']).map((timeMs) => ({
      timeSec: toSec(timeMs),
      value: computeCanvasPlacement(evaluateClipTransformForExport(clip, timeMs), resolution, clip.sourceSize, normalizedCropFor(clip)).destY + rotCompY,
    }));
    destYExpr = buildFfmpegTimeExpr(points, 't');
  }

  // 08-G G3 crop/mask (2026-09-04): crop is a SOURCE-space window, applied BEFORE `scale=` (which
  // maps whatever crop leaves onto the destination box) — same ordering the frontend's canvasEngine.js
  // uses (source-rect first, dest-rect second, in one drawImage()/VideoSample.draw() call). Expressed
  // with ffmpeg's `in_w`/`in_h` runtime variables (the crop filter's own input-frame-size vars)
  // rather than resolved pixel numbers — this module has no fs/process access to probe the source
  // asset's real dimensions (see this file's own "No fs/process access here" note elsewhere), and
  // in_w/in_h let ffmpeg compute the crop rect from whatever the decoded frame's actual size turns
  // out to be, at zero extra cost. Skipped entirely for an identity crop (the overwhelmingly common
  // case — no `clip.crop` at all) so pre-crop filtergraphs/golden tests stay byte-identical.
  const crop = normalizedCropFor(clip);
  const cropSteps = isIdentityCrop(crop)
    ? []
    : [`crop=w=in_w*${crop.width}:h=in_h*${crop.height}:x=in_w*${crop.x}:y=in_h*${crop.y}`];
  const contentSteps = [...buildSpeedAdjustedVideoSteps(clip, fps), ...cropSteps, `scale=${w}:${h}`, 'setsar=1'];
  if (clip.mask && clip.mask.enabled !== false) {
    if (clip.maskInputIndex !== undefined) contentSteps.push(`format=rgba,split[${label}rgb][${label}originalalpha];[${label}originalalpha]alphaextract[${label}alpha];[${clip.maskInputIndex}:v]scale=${w}:${h},format=gray[${label}mask];[${label}alpha][${label}mask]blend=all_mode=multiply[${label}matte];[${label}rgb][${label}matte]alphamerge`);
    else contentSteps.push('format=rgba', `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='alpha(X\\,Y)*${maskFfmpegExpr(maskFor(clip))}'`);
  }
  if (rotationRadians) {
    if (isCenterPivot) {
      contentSteps.push(`rotate=${rotationRadians}:fillcolor=black@0:ow=rotw(${rotationRadians}):oh=roth(${rotationRadians})`);
    } else {
      // 08-G G3 rotation pivot (ADR 0035): ffmpeg's `rotate=` only ever rotates around its OWN
      // input frame's center — there is no parameter for an arbitrary pivot. Standard technique
      // (derived and verified against real ffmpeg, see the ADR): pad the w×h buffer so the pivot
      // point lands exactly at the CENTER of a larger symmetric canvas, rotate that canvas around
      // its own (now-pivot) center at a FIXED output size (no `rotw()/roth()` expansion — unlike
      // the center-pivot branch above, content that would extend past the ORIGINAL w×h box is
      // clipped by the crop below, a documented tradeoff, not a bug), then crop back to w×h at the
      // SAME pad offset — since the pivot never moved from the padded canvas's center throughout,
      // this recovers a window correctly registered onto the rotated content. `fillcolor=black`
      // (opaque, not transparent) matches the center-pivot branch's own exposed-corner fill exactly
      // — this project's existing, pre-pivot behavior for what shows where rotation exposes
      // background, kept consistent rather than diverging into a different fill per branch.
      const pivotPxX = staticTransform.pivotX * w;
      const pivotPxY = staticTransform.pivotY * h;
      let padW = 2 * Math.max(pivotPxX, w - pivotPxX);
      let padH = 2 * Math.max(pivotPxY, h - pivotPxY);
      padW = Math.ceil(padW / 2) * 2; // even dimensions — yuv420p chroma subsampling needs it
      padH = Math.ceil(padH / 2) * 2;
      const padOx = Math.round(padW / 2 - pivotPxX);
      const padOy = Math.round(padH / 2 - pivotPxY);
      contentSteps.push(`pad=w=${padW}:h=${padH}:x=${padOx}:y=${padOy}:color=black`);
      contentSteps.push(`rotate=${rotationRadians}:fillcolor=black@0:ow=${padW}:oh=${padH}`);
      contentSteps.push(`crop=w=${w}:h=${h}:x=${padOx}:y=${padOy}`);
    }
  }
  // Phase 10: chroma-key (verified against real ffmpeg) — EXPORT only, no preview equivalent
  // (canvasEngine.js draws proxy frames straight to canvas; real-time per-pixel color-keying in
  // JS on every redraw was judged too expensive for this pass — see 04-video-editor.md §0's Phase
  // 10 entry for the full reasoning, including why blend-mode below went the OPPOSITE way
  // — preview-only, not export-only).
  const chromaKeyEffect = (clip.effects || []).find((e) => e.type === 'chromaKey' && e.enabled);
  if (chromaKeyEffect) {
    const { color, similarity, blend } = chromaKeyEffect.params;
    if (chromaKeyEffect.params.shadow || chromaKeyEffect.params.cleanup) {
      contentSteps.push('format=rgba', `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='alpha(X\\,Y)*${chromaFfmpegExpr(chromaKeyEffect.params)}'`);
    } else contentSteps.push(`colorkey=${color}:${similarity}:${blend}`);
  }
  // Phase 11 (§0): color grading/LUT/curves — deliberately placed AFTER chroma-key, not before —
  // colorkey has to see the clip's ORIGINAL captured color to key out the real green screen;
  // grading it first would shift that color away from `chromaKeyEffect.params.color` and cause
  // keying to miss. All 3 are EXPORT-only (verified against real ffmpeg — see the phase's own
  // write-up in 04-video-editor.md §0 for the eq/hue/lut3d/curves syntax spike): a live per-pixel
  // preview equivalent for LUT/curves was judged too expensive for this pass, same reasoning
  // Phase 10 used for chroma-key preview; colorGrade DOES get a preview approximation, but via
  // Canvas2D's native `ctx.filter` (frontend/src/video/timelineUtils.js's colorGradeFilterFor) —
  // cheap because the browser does it natively, same reasoning Phase 10 used for blend-mode.
  const colorGradeEffect = (clip.effects || []).find((e) => e.type === 'colorGrade' && e.enabled);
  if (colorGradeEffect) {
    const { brightness = 0, contrast = 1, saturation = 1, gamma = 1, hue = 0 } = colorGradeEffect.params;
    contentSteps.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`);
    // `eq` has no hue parameter of its own — a separate `hue` filter handles it, only emitted
    // when non-zero to keep the common case's filter string shorter.
    if (hue) contentSteps.push(`hue=h=${hue}`);
  }
  const lutEffect = (clip.effects || []).find((e) => e.type === 'lut' && e.enabled);
  if (lutEffect) {
    // Same 2-layer path escaping as fontFilePath below (escapeWindowsPathForFilter converts
    // backslashes to forward slashes and escapes the drive-letter colon, quoteFilterValue wraps
    // in filtergraph-safe single quotes) — verified against a real ffmpeg lut3d= call with a
    // Windows path containing both a drive letter and a space.
    const escapedLutPath = escapeWindowsPathForFilter(lutEffect.params.path);
    contentSteps.push(`lut3d=file=${quoteFilterValue(escapedLutPath)}`);
  }
  const curvesEffect = (clip.effects || []).find((e) => e.type === 'curves' && e.enabled);
  if (curvesEffect) {
    // Fixed ffmpeg built-in presets only (see CURVES_PRESETS in EffectsPanel.jsx for the exact
    // list ffmpeg itself defines) — no custom point editor, same "giữ đơn giản, chưa ai cần chỉnh
    // số" scope cut Phase 9's transition duration UI already made for this codebase.
    contentSteps.push(`curves=preset=${curvesEffect.params.preset}`);
  }
  contentSteps.push('format=yuva420p');
  if (isPropertyAnimated(clip, 'opacity')) {
    // colorchannelmixer's `aa` option does NOT accept time expressions (verified against real
    // ffmpeg — rejects with "Undefined constant... in 't)'"); `geq`'s alpha plane DOES, via
    // uppercase `T` (also verified for real) — r/g/b pass the source pixel through unchanged,
    // only alpha is computed from the animated-opacity expression (0..1 scaled to geq's 0..255).
    const times = sampleAnimatedTimesMs(clip, ['opacity']);
    const points = times.map((timeMs) => ({
      timeSec: toSec(timeMs),
      value: computeCanvasPlacement(evaluateClipTransformForExport(clip, timeMs), resolution).opacity,
    }));
    const opacityExpr = buildFfmpegTimeExpr(points, 'T');
    contentSteps.push(`geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='(${opacityExpr})*alpha(X\\,Y)'`);
  } else {
    // Alpha channel carries the static `opacity` into the overlay below — the ffmpeg-native
    // equivalent of Player.jsx's CSS `opacity` on a <video> sitting over a black container:
    // alpha-blending a frame with black at alpha=opacity is mathematically identical to scaling
    // its own RGB by opacity, which is exactly what colorchannelmixer's alpha-scale step does
    // once composited by `overlay` onto the black `[bg]` canvas.
    contentSteps.push(`colorchannelmixer=aa=${staticPlacement.opacity}`);
  }

  const contentLabel = `${label}c`;
  const bgLabel = `${label}bg`;
  let bgSteps = transparentBg
    ? `color=c=black@0.0:s=${width}x${height}:d=${clipDurationSec}:r=${fps},format=yuva420p`
    : `color=c=black:s=${width}x${height}:d=${clipDurationSec}:r=${fps}`;
  if (clip.background?.mode === 'color') bgSteps = `color=c=${clip.background.color.replace('#', '0x')}:s=${width}x${height}:d=${clipDurationSec}:r=${fps},format=yuva420p`;
  if (clip.background?.mode === 'blur') bgSteps = `[${inputIdx}:v]${buildSpeedAdjustedVideoSteps(clip, fps).join(',')},scale=${Math.ceil(width * 1.08)}:${Math.ceil(height * 1.08)}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20,setsar=1,format=yuva420p`;
  const parts = [
    `${bgSteps}[${bgLabel}]`,
    `[${inputIdx}:v]${contentSteps.join(',')}[${contentLabel}]`,
    `[${bgLabel}][${contentLabel}]overlay=x=${destXExpr}:y=${destYExpr}:shortest=1[${label}pre]`,
  ];

  let currentLabel = `${label}pre`;
  const fadeInSec = toSec(clip.videoFadeInMs || 0);
  const fadeOutSec = toSec(clip.videoFadeOutMs || 0);
  if (fadeInSec > 0 || fadeOutSec > 0) {
    const fadeSteps = [];
    if (fadeInSec > 0) fadeSteps.push(`fade=t=in:st=0:d=${fadeInSec}`);
    if (fadeOutSec > 0) fadeSteps.push(`fade=t=out:st=${Math.max(0, clipDurationSec - fadeOutSec)}:d=${fadeOutSec}`);
    const nextLabel = `${label}fade`;
    parts.push(`[${currentLabel}]${fadeSteps.join(',')}[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  if (clip.text?.content) {
    if (!fontFilePath) throw new Error(`Clip ${clip.id} has text overlay but no fontFilePath was provided to buildRenderPlan()`);
    // Two-layer escape, same as Phase 0's render-spike.js: drawtext's own text-value parser
    // (escapeDrawtextText) THEN the outer filtergraph quoting (quoteFilterValue) — explicit
    // fontfile= (not relying on fontconfig system lookup) is required per
    // docs/decisions/0016-video-render-spike.md's own finding.
    const fontsize = clip.text.fontSize || 36;
    const color = clip.text.color || 'white';
    const textX = clip.text.x ?? '(w-text_w)/2';
    // Default centers a SINGLE line; N lines need the whole block (N*text_h) centered instead —
    // see drawtextLineExprs()'s own comment for why this can't just embed a raw '\n' in one line.
    const yExprForLine = clip.text.y != null
      ? (i) => `${clip.text.y}+${i}*text_h`
      : (i, n) => `(h-text_h*${n})/2+${i}*text_h`;
    const exprs = drawtextLineExprs(clip.text.content, { fontFilePath, fontsize, color, xExpr: textX, yExprForLine });
    exprs.forEach((expr, i) => {
      const nextLabel = `${label}txt${i}`;
      parts.push(`[${currentLabel}]${expr}[${nextLabel}]`);
      currentLabel = nextLabel;
    });
  }

  parts.push(`[${currentLabel}]null[${label}]`); // stable terminal label regardless of which optional steps ran
  return parts.join(';');
}

// buildClipAudioBranch(clip, inputIdx, label, streamSelector) -> filtergraph fragment producing
// `[label]`: this clip's audio (from `streamSelector`, e.g. "a" for a dedicated audio-track clip
// or "a" on a video input for the embedded-audio fallback), trimmed to match its video counterpart
// exactly, with speed/reverse (Phase 8) + loudness normalize (Phase 15) + volume + optional fade.
// NEVER called for a frozen (speed 0) clip — see buildSilentAudioBranch() below and its own call
// site. `normalize` (Phase 15, §0) is deliberately a single fixed EBU R128 target (I=-16 LUFS,
// TP=-1.5, LRA=11 — ffmpeg's own `loudnorm` filter defaults, the standard streaming-loudness
// preset), not a custom-tunable slider — same "giữ đơn giản, chưa ai cần chỉnh số" scope cut
// Phase 9's transition duration and Phase 11's curves preset already made. Single-pass (not
// `loudnorm`'s own documented 2-pass measure-then-apply mode) for the same reason: 2-pass needs a
// first ffmpeg run just to MEASURE the input's stats before the real encode can even start,
// roughly doubling this clip's own processing time for a correction most voice-recording use cases
// don't need frame-accurate — single-pass loudnorm already gets audibly close (verified against
// real ffmpeg, see the golden fixture). Placed BEFORE `volume=`/fade — normalize sets the clip's
// OWN baseline loudness; the user's own volume/fade is an intentional adjustment layered on top of
// that baseline, not a replacement for it.
function buildClipAudioBranch(clip, inputIdx, label, streamSelector) {
  const clipDurationSec = toSec(clip.timelineOutMs - clip.timelineInMs);
  const volume = clip.volume ?? 1;
  const steps = [...buildSpeedAdjustedAudioSteps(clip)];
  if (clip.audioChannel && clip.audioChannel !== 'none') steps.push('aformat=channel_layouts=stereo');
  if (clip.audioChannel === 'left') steps.push('pan=stereo|c0=c0|c1=c0');
  if (clip.audioChannel === 'right') steps.push('pan=stereo|c0=c1|c1=c1');
  if (clip.audioChannel === 'mono') steps.push('pan=mono|c0=0.5*c0+0.5*c1');
  const normalizeEffect = (clip.effects || []).find((e) => e.type === 'normalize' && e.enabled);
  if (normalizeEffect) steps.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  steps.push(`volume=${volume}`);
  const fadeInSec = toSec(clip.audioFadeInMs || 0);
  const fadeOutSec = toSec(clip.audioFadeOutMs || 0);
  if (fadeInSec > 0) steps.push(`afade=t=in:st=0:d=${fadeInSec}`);
  if (fadeOutSec > 0) steps.push(`afade=t=out:st=${Math.max(0, clipDurationSec - fadeOutSec)}:d=${fadeOutSec}`);
  return `[${inputIdx}:${streamSelector}]${steps.join(',')}[${label}]`;
}

// buildSilentAudioBranch(clip, label) -> filtergraph fragment producing `[label]`: exactly
// `clip`'s own timeline duration of silence — used in place of buildClipAudioBranch() for a
// FROZEN (speed 0) clip's embedded-audio fallback (Phase 8): a single held video frame has no
// meaningful "its own audio" to fall back to, and export mutes it entirely for the same reason
// canvasEngine.js's findAudioSourceClip() excludes a frozen clip from ever driving preview's
// clock — a source filter (`anullsrc`, verified against real ffmpeg), not `[inputIdx:a]`, so it
// needs no asset input at all.
function buildSilentAudioBranch(clip, label) {
  const clipDurationSec = toSec(clip.timelineOutMs - clip.timelineInMs);
  return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${clipDurationSec},asetpts=PTS-STARTPTS[${label}]`;
}

// buildGapSegment(durationSec, label, resolution, fps, transparentBg) -> filtergraph fragment
// producing output pad `[label]`: `durationSec` of plain black (opaque) or alpha-zero black
// (transparent), no asset `-i` input needed at all — a synthesized stand-in for "nothing on this
// track here" that concatenates/overlays exactly like a real clip's own composited output (verified
// against real ffmpeg, backend/video/spike/absolute-time-spike.js Test 1/2). Mirrors
// buildClipVideoBranch's own bgSteps line so a gap and a real clip's background use the identical
// `color=` shape for whichever background type this track needs.
function buildGapSegment(durationSec, label, resolution, fps, transparentBg) {
  const { width, height } = resolution;
  const bgSteps = transparentBg
    ? `color=c=black@0.0:s=${width}x${height}:d=${durationSec}:r=${fps},format=yuva420p`
    : `color=c=black:s=${width}x${height}:d=${durationSec}:r=${fps}`;
  return `${bgSteps}[${label}]`;
}

// buildTrackLayer(clips, transitions, resolution, fps, fontFilePath, inputIndexFor, labelPrefix,
// transparentBg) -> { filterParts, outputLabel, durationSec }: builds ONE video track's own
// composited output stream — the per-clip-composite + concat/xfade fold this file always used for
// "the" video track before Phase 12 (§0), when there was only ever one. `buildRenderPlan()` below
// calls this once for the base track (labelPrefix 'v', transparentBg false — byte-identical to
// pre-Phase-12 output, same `v0`/`v1`/.../`vjoin1`/`vout` labels as before) and again for every
// additional visible video track (labelPrefix `ov1`/`ov2`/..., transparentBg true) to produce an
// overlay LAYER it then composites onto the running result.
//
// 08-H S7 (absolute-time compositing): this track's own SEGMENT list is real clips PLUS a
// synthesized gap segment (buildGapSegment()) wherever clipsWithGaps() finds real project-time
// space before a clip that nothing on this track fills — a leading gap (first clip's timelineInMs
// > 0) or an inter-clip gap. This is what makes the base track's own t=0 line up with project t=0:
// before this, a track's clips were concatenated back-to-back regardless of any gap between them,
// so a clip at project-time 5s and one at project-time 0s on a DIFFERENT track both started playing
// from the same point in the export ("Documented, not silently wrong" — this file's own former
// header comment). Every video track (base AND overlay) gap-fills the exact same way, so
// buildRenderPlan()'s overlay composite step (plain `overlay=x=0:y=0`) already aligns them
// correctly with NO separate `tpad`/time-shift needed there — verified in
// spike/absolute-time-spike.js Test 2. When a track has no gaps at all (the common case today),
// this produces byte-identical filtergraph output to before — same labels, same fold shape.
function buildTrackLayer(clips, transitions, resolution, fps, fontFilePath, inputIndexFor, labelPrefix, transparentBg) {
  const { CENTERED_TIMING, transitionFrames } = require('../../../shared/video-transition-timing');
  const centered = transitions.some(t => t.timingMode === CENTERED_TIMING && clips.some(c=>c.id===t.fromClipId));
  const filterParts = [];
  const segments = [];
  clipsWithGaps(clips).forEach(({ clip, gapBeforeSec }) => {
    if (gapBeforeSec > 0) {
      const gapLabel = `${labelPrefix}gap${segments.length}`;
      filterParts.push(buildGapSegment(gapBeforeSec, gapLabel, resolution, fps, transparentBg));
      segments.push({ label: gapLabel, durationSec: gapBeforeSec });
    }
    const clipLabel = `${labelPrefix}${segments.length}`;
    const incoming = transitions.find(t => t.toClipId === clip.id && t.timingMode === CENTERED_TIMING);
    const outgoing = transitions.find(t => t.fromClipId === clip.id && t.timingMode === CENTERED_TIMING);
    const before = incoming ? transitionFrames(incoming, fps).before : 0;
    const after = outgoing ? transitionFrames(outgoing, fps).after : 0;
    const rawLabel = centered ? `${clipLabel}raw` : clipLabel;
    filterParts.push(buildClipVideoBranch(clip, inputIndexFor(clip.assetId), rawLabel, resolution, fps, fontFilePath, transparentBg));
    if (centered) filterParts.push(`[${rawLabel}]fps=${fps},settb=1/${fps},setpts=N,tpad=start_mode=clone:start=${before}:stop_mode=clone:stop=${after},trim=end_frame=${Math.round((clip.timelineOutMs - clip.timelineInMs) * fps / 1000) + before + after},setpts=N[${clipLabel}]`);
    segments.push({ clip, label: clipLabel, durationSec: toSec(clip.timelineOutMs - clip.timelineInMs) + (before + after) / fps });
  });
  const hasGaps = segments.length !== clips.length;

  const outputLabel = `[${labelPrefix}out]`;
  let durationSec;
  // Phase 9: a transition between 2 ADJACENT clips ON THIS TRACK is rendered as a real `xfade`
  // crossfade instead of a hard concat AT THAT ONE JOIN ONLY — `transitions` is the whole project's
  // list, but `fromClipId`/`toClipId` are globally-unique clip IDs, so `.find()` below only ever
  // matches a pair that's actually adjacent on THIS track's own fold; a gap segment never has a
  // `.clip`, so it can never match one, and never needs to — no transition can span a real gap.
  if (transitions.length === 0 && !hasGaps) {
    const labels = segments.map((s) => `[${s.label}]`);
    filterParts.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=0${outputLabel}`);
    durationSec = toSec(clips[clips.length - 1].timelineOutMs);
  } else {
    let runningLabel = `[${segments[0].label}]`;
    durationSec = segments[0].durationSec;
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const cur = segments[i];
      const joinLabel = `${labelPrefix}join${i}`;
      const transition = prev.clip && cur.clip
        ? transitions.find((t) => t.fromClipId === prev.clip.id && t.toClipId === cur.clip.id)
        : undefined;
      if (transition) {
        const xfadeDurationSec = toSec(transition.durationMs);
        const offsetSec = durationSec - xfadeDurationSec; // xfade offset = where in the RUNNING result the crossfade begins
        let effect = require('../../../shared/video-transition-catalog.json').find(t => t.type === (transition.type || 'crossfade'))?.ffmpeg;
        if (!effect) throw new Error('Unsupported transition type');
        if (transition.type === 'pull-out') {
          const sample = plane => `b${plane}(W/2+(X-W/2)/(1+P),H/2+(Y-H/2)/(1+P))`;
          const pixel = `if(eq(PLANE,0),${sample(0)},if(eq(PLANE,1),${sample(1)},if(eq(PLANE,2),${sample(2)},${sample(3)})))`;
          effect = `custom:expr='A*P+(${pixel})*(1-P)'`;
        }
        filterParts.push(`${runningLabel}[${cur.label}]xfade=transition=${effect}:duration=${xfadeDurationSec}:offset=${offsetSec}[${joinLabel}]`);
        durationSec += cur.durationSec - xfadeDurationSec;
      } else {
        filterParts.push(`${runningLabel}[${cur.label}]concat=n=2:v=1:a=0[${joinLabel}]`);
        durationSec += cur.durationSec;
      }
      runningLabel = `[${joinLabel}]`;
    }
    filterParts.push(`${runningLabel}null${outputLabel}`); // stable terminal label regardless of fold length
  }

  return { filterParts, outputLabel, durationSec };
}

// dominantBlendModeFor(clips) -> the Canvas2D-style blend mode name (EffectsPanel.jsx's
// BLEND_MODES) used to composite an ENTIRE overlay track onto the running result: the first
// enabled `blendMode` effect found across the track's own clips (already sorted into timeline
// order by the caller), or 'normal' if none. Phase 12 (§0) scope cut, documented there in full:
// blend mode is applied per TRACK, not per clip — 2 clips on the same overlay track with different
// blend modes both render using whichever is found first. A real but narrow gap (most real usage
// puts one blend intent per overlay track), not silently wrong.
function dominantBlendModeFor(clips) {
  for (const clip of clips) {
    const effect = (clip.effects || []).find((e) => e.type === 'blendMode' && e.enabled);
    if (effect) return effect.params.mode;
  }
  return 'normal';
}

// buildRenderPlan(projectState, { assetPaths, outputPath, fontFilePath }) -> { args,
// totalDurationMs, inputPaths }. assetPaths: { [assetId]: absoluteSourceFilePath } — every
// assetId referenced by any clip used in the render MUST have an entry (thrown clearly
// otherwise). fontFilePath is only required if some clip has `clip.text` set (thrown clearly
// otherwise, from buildClipVideoBranch). Caller (backend/agent/videoJobs.js) resolves both from
// the video_assets DB table + backend/video/fontResolver.js, same as every other video-job kind —
// this module has no DB/fs access on purpose (a pure planner, unit-testable without ffmpeg or a
// database at all).
// Phase 16 (§0): `resolutionOverride`/`crf` let a caller export at a DIFFERENT resolution/quality
// than the project's own canvas (backend/video/renderPresets.js's job to compute the override from
// a preset id — this module stays agnostic of what a "preset" even is, same "pure planner, no
// policy" precedent every other option here already follows). Both default to the exact
// pre-Phase-16 behavior (project's own resolution, CRF 18) so every existing caller/test that never
// passes them renders byte-identical to before.

module.exports = { sampleAnimatedTimesMs, buildAtempoChain, buildSpeedAdjustedVideoSteps, buildSpeedAdjustedAudioSteps, sortedClips, clipsWithGaps, toSec, drawtextLineExprs, makeInputResolver, buildClipVideoBranch, buildClipAudioBranch, buildSilentAudioBranch, buildGapSegment, buildTrackLayer, dominantBlendModeFor };
