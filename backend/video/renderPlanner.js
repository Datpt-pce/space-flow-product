// Render Planner — Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5).
// Pure function: validated project state (Phase 1) + resolved asset file paths -> a real ffmpeg
// `-filter_complex` command (concat FILTER, not demuxer — required because per-clip
// trim/scale/rotate/fade is mandatory, which the demuxer can't do; same reasoning as Phase 0's
// render-spike.js). No fs/process access here at all — backend/agent/videoJobs.js's `render` kind
// is what actually spawns ffmpeg with these args.
//
// Scope decisions (MVP, "Video MVP" closing phase — see file header of 04-video-editor.md §0 for
// the full write-up):
//   - ONE video track (the first, by `.order`, with clips) played as a straight sequential concat,
//     in clip order. Phase 12 (§0) added real N-track export on top of this: every OTHER visible
//     video track composites onto this base bottom-to-top (blend-mode via ffmpeg's `blend` filter,
//     or plain alpha `overlay` for the default/normal case) — see buildRenderPlan()'s own comment
//     for the composite-ordering details and the scope cuts that come with it (per-track not
//     per-clip blend mode, base's own duration still drives total export length).
//   - 08-H S7 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md):
//     timeline GAPS on any video track are now gap-filled (buildGapSegment(), a synthesized black/
//     transparent `color=` segment) instead of skipped — every video track's own t=0 lines up with
//     project t=0 as a result, so a clip at project-time 5s on one track and project-time 0s on
//     another correctly play at their own real positions, not in lockstep from each track's own
//     compressed start (the prior, now-fixed, documented limitation — see
//     backend/video/spike/absolute-time-spike.js for the real-ffmpeg verification this was built
//     against, and buildTrackLayer()'s own comment for the mechanism). The embedded-audio fallback
//     (no dedicated audio track) stays in sync with this via the same clipsWithGaps() call. A
//     DEDICATED audio track's own internal gaps are now gap-filled the same way (see
//     buildRenderPlan()'s own comment on that branch) — was a documented, still-open gap for S7,
//     closed in a later pass.
//   - `crop` is NOT a schema field (shared/video-commands/state.js only has `transform`, same gap
//     Player.jsx's own header comment already noted) — position/scale/rotation/opacity ARE real
//     schema fields (`clip.transform`) and ARE fully rendered here via a
//     black-canvas + overlay + colorchannelmixer(alpha) composite per clip, matching what
//     Player.jsx already approximates with CSS in the browser.
//   - `clip.volume` (default 1), `clip.audioFadeInMs`/`audioFadeOutMs` (default 0),
//     `clip.videoFadeInMs`/`videoFadeOutMs` (default 0), and `clip.text` ({content, fontSize,
//     color, x, y}, optional, drawtext-burned) are NEW optional clip fields this phase introduces
//     — nothing else defined them, and nothing renders/authors them without a render step to
//     consume them. All are additive/optional (absent = exactly today's behavior), set via the
//     existing generic SetProperty command (shared/video-commands) — no new command types needed.
//   - Audio: if the audio track has any clips, they are the ENTIRE final audio mix (an explicit,
//     deliberately-authored audio timeline wins). If the audio track is empty, each video clip's
//     OWN embedded audio (same trim points) is used instead — so the simple "import one clip,
//     export" case keeps its real audio without the user having to duplicate anything onto a
//     separate audio track. `videoTrack.muted` suppresses that fallback either way.

const {
  escapeWindowsPathForFilter, escapeDrawtextText, quoteFilterValue,
} = require('./ffmpegArgs');
const { computeCanvasPlacement, normalizedCropFor, isIdentityCrop } = require('../../shared/video-transform');
const { chromaFfmpegExpr } = require('../../shared/video-chroma');
const { maskFor, maskFfmpegExpr } = require('../../shared/video-mask');
const {
  keyframesForProperty, isPropertyAnimated, evaluateClipTransformForExport,
} = require('../../shared/video-keyframes');
const { buildFfmpegTimeExpr } = require('./keyframeExpr');

// sampleAnimatedTimesMs(clip, propertyKeys, samplesPerEasedSegment) -> sorted, deduped
// clip-relative timeMs to sample at: every keyframe time for each of `propertyKeys`, plus
// `samplesPerEasedSegment - 1` interior points for any segment whose STARTING keyframe uses a
// non-'linear' easing — buildFfmpegTimeExpr() only ever draws straight lines between the points
// it's given, so an eased curve needs to already be flattened into enough extra points to look
// right; a genuinely linear segment needs none (its own 2 endpoints are already exact).
const { sampleAnimatedTimesMs, buildAtempoChain, buildSpeedAdjustedVideoSteps, buildSpeedAdjustedAudioSteps, sortedClips, clipsWithGaps, toSec, drawtextLineExprs, makeInputResolver, buildClipVideoBranch, buildClipAudioBranch, buildSilentAudioBranch, buildGapSegment, buildTrackLayer, dominantBlendModeFor } = require('./render/clipComposition');

function buildRenderPlan(projectState, { assetPaths, assetKinds = {}, assetDimensions = {}, assetAudio = {}, outputPath, fontFilePath, resolutionOverride, crf = 18 }) {
  projectState = { ...projectState, tracks: projectState.tracks.map(track => ({
    ...track, clips: track.clips.map(clip => assetDimensions[clip.assetId]
      ? { ...clip, sourceSize: assetDimensions[clip.assetId] } : { ...clip }),
  })) };
  const resolution = resolutionOverride || projectState.resolution;
  const { fps } = projectState;
  // Phase 12 (§0): every video track WITH CLIPS renders now, not just the first — sorted by
  // `.order` (canvasEngine.js's own bottom-to-top convention) so track-array position no longer
  // matters, same as preview. 08-F F3 (specs/.../08-v2/08-f-timeline-authoring.md): `baseTrack`
  // selection now ALSO respects `.visible`, closing a preview/export parity gap this comment used
  // to accept as a deliberate scope cut — `canvasEngine.js`'s findActiveVideoClips() has never
  // special-cased a "base" track, it filters `.visible` uniformly for every video track, so hiding
  // the only video track made preview correctly show nothing while export still burned it in
  // (same bug class as the muted-audio-track export fix, docs/issues/2026-08-29). `.visible` is
  // still what picks the overlay tracks below; a hidden track just never becomes a candidate for
  // EITHER role now, matching canvasEngine.js exactly.
  const videoTracksWithClips = (projectState.tracks || [])
    .filter((t) => ['video', 'image', 'sticker'].includes(t.type) && t.visible && t.clips.length > 0)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (videoTracksWithClips.length === 0) throw new Error('Project has no video clips to render (every video track is hidden or empty)');
  const [baseTrack, ...overlayTracks] = videoTracksWithClips;
  const audioTracks = projectState.tracks.filter(t => ['audio', 'video'].includes(t.type) && !t.muted && t.clips.length > 0);

  const videoClips = sortedClips(baseTrack);
  const { inputIndexFor, inputPaths } = makeInputResolver(assetPaths, assetKinds);
  for (const track of projectState.tracks) for (const clip of track.clips) if (clip.maskAssetId) clip.maskInputIndex = inputIndexFor(clip.maskAssetId);

  const transitions = projectState.transitions || [];

  const filterParts = [];
  const baseLayer = buildTrackLayer(videoClips, transitions, resolution, fps, fontFilePath, inputIndexFor, 'v', false);
  const baseDurationSec = baseLayer.durationSec;

  // 08-H (acceptance §5, "project duration lấy từ ... max effective element end, không mặc định từ
  // base video track"): build every overlay LAYER now (pure — filterParts not pushed to the real
  // graph yet) so every layer's own content duration is known BEFORE compositing the FIRST one onto
  // the base. Padding has to happen up front: `overlay=...:eof_action=pass` truncates the WHOLE
  // composite to input0's own length regardless of how much longer input1 runs (this file's own
  // prior documented scope cut, now fixed) — padding only after the first overlay would already be
  // too late for that one. Verified against real ffmpeg first, see
  // backend/video/spike/max-duration-spike.js — same "spike before touching the real code path"
  // discipline as absolute-time-spike.js/ADR 0016.
  const overlayLayers = [];
  overlayTracks.forEach((track, idx) => {
    // `.visible` already filtered above (videoTracksWithClips) — every entry here is visible.
    const clips = sortedClips(track);
    if (clips.length === 0) return;
    const labelPrefix = `ov${idx + 1}`;
    const layer = buildTrackLayer(clips, transitions, resolution, fps, fontFilePath, inputIndexFor, labelPrefix, true);
    overlayLayers.push({ labelPrefix, layer, mode: dominantBlendModeFor(clips) });
  });

  // Sticker/caption clips don't go through buildTrackLayer (no concat/xfade fold, no transitions —
  // see their own composite loops below) so their own effective end is just the max `timelineOutMs`
  // across their clips, computed here ahead of those loops purely to feed this max-duration
  // calculation (`stickerClips`/`captionCues` themselves are computed again, unchanged, further
  // down — kept there so their own loops stay next to the comments explaining THEM, not duplicated).
  const stickerEndsMs = (projectState.tracks || [])
    .filter((t) => t.type === 'sticker' && t.visible !== false)
    .flatMap((t) => sortedClips(t)).map((c) => c.timelineOutMs);
  const captionEndsMs = (projectState.tracks || [])
    .filter((t) => t.type === 'caption' && t.visible !== false)
    .flatMap((t) => sortedClips(t)).filter((c) => c.text?.content).map((c) => c.timelineOutMs);
  const maxDurationSec = Math.max(
    baseDurationSec,
    ...overlayLayers.map((o) => o.layer.durationSec),
    ...stickerEndsMs.map(toSec),
    ...captionEndsMs.map(toSec),
    ...audioTracks.map(t => Math.max(...t.clips.map(c => toSec(c.timelineOutMs))) - (t.type === 'video'
      ? transitions.filter(tr => tr.timingMode !== 'centered-v1' && t.clips.some(c => c.id === tr.toClipId)).reduce((sum, tr) => sum + toSec(tr.durationMs), 0) : 0)),
  );

  filterParts.push(...baseLayer.filterParts);
  // Pad via buildGapSegment()+concat — the SAME mechanism this file already uses for every
  // internal/leading gap (buildTrackLayer's own clipsWithGaps() call), not `tpad=stop_duration`.
  // `tpad` was the FIRST approach tried (see max-duration-spike.js's git history) and looked correct
  // in isolated spike runs, but turned out FLAKY under real load: `tpad` immediately followed by
  // `overlay=...:eof_action=pass` where both composited streams end at (or very near) the same
  // instant occasionally made ffmpeg's overlay filter emit a wildly wrong frame count (observed:
  // 1025s instead of 3s, non-deterministic, reproduced in ~50% of runs in a tight loop) — a real
  // ffmpeg filtergraph race, not a logic bug in this file. Looping the exact same filtergraph 20x
  // with `concat` instead of `tpad` for the pad segment produced the correct duration EVERY time —
  // `concat` is the same proven-reliable primitive every other gap in this file already goes
  // through, so the base's own padded tail is indistinguishable (to the downstream `overlay` step)
  // from a real trailing project-time gap.
  let runningVideoLabel = baseLayer.outputLabel;
  // Fractional-frame transition sums can differ by floating-point noise.
  if (maxDurationSec - baseDurationSec > 1e-6) {
    const padLabel = '[vpad0]';
    const paddedLabel = '[vpadded]';
    filterParts.push(buildGapSegment(maxDurationSec - baseDurationSec, 'vpad0', resolution, fps, false));
    filterParts.push(`${baseLayer.outputLabel}${padLabel}concat=n=2:v=1:a=0${paddedLabel}`);
    runningVideoLabel = paddedLabel;
  }
  const videoTotalDurationSec = maxDurationSec;

  // Phase 12 (§0): additional visible video tracks are composited bottom-to-top on top of the
  // base, each as its own fully independent layer (own concat/xfade fold via buildTrackLayer,
  // rendered onto a TRANSPARENT background so a keyed-out/out-of-bounds pixel reveals whatever is
  // underneath, not this layer's own canvas — the pre-Phase-12 gap this closes; see
  // 04-video-editor.md §0's Phase 10 entry for the original limitation).
  //
  // Composite ordering below is load-bearing, verified against real ffmpeg (spike, not guessed):
  // the RUNNING composite so far is ALWAYS input0 ("main"/"top" in ffmpeg's own terms, for both
  // `overlay` and `blend`) and the new overlay layer is ALWAYS input1 ("secondary"/"bottom") — the
  // only ordering where `eof_action=pass` correctly reveals the running composite once a SHORTER
  // overlay layer's own stream ends, instead of freezing/smearing its last frame over the rest of
  // the base's duration (verified: the reverse ordering either freezes the overlay's last frame via
  // `repeat`, or truncates the WHOLE output down to the overlay's own shorter length via
  // `pass`/`endall` — neither acceptable). One real, narrow consequence, documented rather than
  // silently wrong: `blend`'s asymmetric modes (only `overlay` among this app's 5 exposed modes —
  // multiply/screen/darken/lighten are commutative, order doesn't change their result) evaluate as
  // blend(base, overlayClip) instead of blend(overlayClip, base) — the opposite of
  // canvasEngine.js's preview, which always treats the freshly-drawn overlay clip as the "source".
  //
  // 08-H: total export duration is now `maxDurationSec` (max across base/overlay/sticker/caption),
  // not just the base track's own duration — the base layer above is already padded to it via
  // `tpad=stop_duration`, so every overlay composited here (whatever its own length) plays out
  // against a running composite that's already the right final length; an overlay SHORTER than
  // `maxDurationSec` still reveals what's underneath once its own stream ends, exactly as before.
  //
  // Audio: unchanged — the embedded-audio fallback below (no dedicated audio track) still only ever
  // uses the BASE track's own clips, now possibly shorter than the padded video; ffmpeg simply stops
  // emitting audio samples once that stream ends; no `-shortest`, so this does not truncate video. An
  // overlay track's own embedded audio is never mixed into the export; put it on a dedicated audio
  // track instead.
  overlayLayers.forEach(({ labelPrefix, layer, mode }) => {
    filterParts.push(...layer.filterParts);
    const compositeLabel = `[${labelPrefix}composite]`;
    if (mode === 'normal') {
      filterParts.push(`${runningVideoLabel}${layer.outputLabel}overlay=x=0:y=0:eof_action=pass${compositeLabel}`);
    } else {
      // `blend` operates on raw pixel PLANES, not RGB channels directly — forcing `gbrp` (planar
      // RGB, no chroma subsampling) around it is required for a correct per-channel result
      // (verified against real ffmpeg: applying it straight to yuva420p streams measurably bleeds
      // luma/chroma across channels — e.g. multiplying pure red by gray came out with a nonzero
      // green channel).
      // Blend RGB under the overlay alpha, retaining the underlying frame
      // outside a cropped/rotated/masked image and throughout sparse gaps.
      const key = labelPrefix;
      filterParts.push(`${runningVideoLabel}format=gbrp,split[${key}base][${key}blendbase]`);
      filterParts.push(`${layer.outputLabel}split[${key}color][${key}alpha]`);
      filterParts.push(`[${key}alpha]alphaextract,tpad=stop_duration=${videoTotalDurationSec}:color=black,format=gbrp[${key}mask]`);
      filterParts.push(`[${key}color]format=gbrp[${key}rgb]`);
      filterParts.push(`[${key}blendbase][${key}rgb]blend=all_mode=${mode}:eof_action=pass[${key}blended]`);
      filterParts.push(`[${key}base][${key}blended][${key}mask]maskedmerge,format=yuv420p${compositeLabel}`);
    }
    runningVideoLabel = compositeLabel;
  });

  // Phase 13 (§0): manual captions burn onto the FINAL composited video, one `drawtext` step per
  // cue gated to its own window via `enable='between(t,...)'` (verified against real ffmpeg —
  // chaining N of these onto a labeled filter_complex graph works exactly like Phase 12's spike
  // already proved for `overlay`/`blend`'s own `enable`). A caption cue's `timelineInMs`/
  // `timelineOutMs` is used AS-IS as seconds into the rendered output — which is now CORRECT
  // (08-H S7): before the base video track was gap-filled, this assumed the base track had no
  // leading gap, or caption timing would drift by that gap's duration; now the base track's own
  // t=0 always lines up with project t=0, so captions (already absolute-time by construction) line
  // up with it automatically, no separate fix needed here. Every visible 'caption' track's clips
  // burn in, sorted by timeline order across ALL such tracks together (so 2 caption tracks — e.g.
  // 2 languages — burn in a stable, deterministic order rather than whichever track happens first
  // in the array).
  const captionCues = (projectState.tracks || [])
    .filter((t) => t.type === 'caption' && t.visible !== false)
    .flatMap((t) => sortedClips(t))
    .filter((c) => c.text?.content)
    .sort((a, b) => a.timelineInMs - b.timelineInMs);
  captionCues.forEach((cue, i) => {
    if (cue.captionAssetId) {
      const input=inputIndexFor(cue.captionAssetId), nextLabel=`[caption${i}]`;
      filterParts.push(`[${input}:v]scale=${resolution.width}:${resolution.height},format=rgba[captionImage${i}]`);
      filterParts.push(`${runningVideoLabel}[captionImage${i}]overlay=0:0:eof_action=pass:enable='gte(t\\,${toSec(cue.timelineInMs)})*lt(t\\,${toSec(cue.timelineOutMs)})'${nextLabel}`);
      runningVideoLabel=nextLabel;
      return;
    }
    if (!fontFilePath) throw new Error(`Caption cue ${cue.id} needs a fontFilePath but none was provided to buildRenderPlan()`);
    const fontsize = cue.text.fontSize || 32;
    const color = cue.text.color || 'white';
    // Bottom-center with an 8% margin + a semi-transparent box behind the text (the standard
    // subtitle look) — a DIFFERENT default than `clip.text`'s own vertically-CENTERED default
    // (buildClipVideoBranch above, meant for a single-clip title overlay, not a caption track) —
    // deliberately not shared, this is a separate rendering path with a separate purpose.
    const textX = cue.text.x ?? '(w-text_w)/2';
    // Anchor the whole caption block above the bottom 8% margin.
    // drawtext's text_h varies with each line's glyphs (e.g. accents/descenders).
    // A fixed line height prevents adjacent caption lines from overlapping.
    const lineHeight = fontsize * 1.2;
    const yExprForLine = cue.text.y != null
      ? (i2) => `${cue.text.y}+${i2}*${lineHeight}`
      : (i2, n) => `(h-${lineHeight}*${n}-0.08*h)+${i2}*${lineHeight}`;
    const startSec = toSec(cue.timelineInMs);
    const endSec = toSec(cue.timelineOutMs);
    const exprs = drawtextLineExprs(cue.text.content, {
      fontFilePath, fontsize, color, xExpr: textX, yExprForLine,
      extraOpts: `${cue.text.preset === 'outline' ? ':borderw=2:bordercolor=black' : ':box=1:boxcolor=black@0.5:boxborderw=8'}:enable='gte(t\\,${startSec})*lt(t\\,${endSec})'`,
    });
    exprs.forEach((expr, lineIdx) => {
      const nextLabel = `[caption${i}_${lineIdx}]`;
      filterParts.push(`${runningVideoLabel}${expr}${nextLabel}`);
      runningVideoLabel = nextLabel;
    });
  });

  // Every unmuted audio/video track participates, matching AudioMixer. Each
  // track retains its gaps; mixing never concatenates independent sources.
  const audioLayers = [];
  audioTracks.forEach((track, trackIndex) => {
    const labels = [], prefix = `mix${trackIndex}`;
    clipsWithGaps(sortedClips(track)).forEach(({ clip, gapBeforeSec }, i) => {
      if (gapBeforeSec > 0) {
        const gap = `${prefix}gap${i}`;
        filterParts.push(buildSilentAudioBranch({ timelineInMs: 0, timelineOutMs: gapBeforeSec * 1000 }, gap)); labels.push(`[${gap}]`);
      }
      let label = `${prefix}c${i}`;
      filterParts.push((clip.speed ?? 1) === 0 || assetKinds[clip.assetId] === 'image' || assetAudio[clip.assetId] === false
        ? buildSilentAudioBranch(clip, label) : buildClipAudioBranch(clip, inputIndexFor(clip.assetId), label, 'a'));
      const incoming = track.type === 'video' && transitions.find(t => t.toClipId === clip.id && t.timingMode !== 'centered-v1');
      if (incoming) {
        filterParts.push(`[${label}]atrim=start=${toSec(incoming.durationMs)},asetpts=PTS-STARTPTS[${label}trimmed]`); label += 'trimmed';
      }
      labels.push(`[${label}]`);
    });
    const label = `${prefix}out`;
    filterParts.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[${label}]`); audioLayers.push(`[${label}]`);
  });
  const audioLabel = audioLayers.length ? '[aout]' : null;
  const audioSamples = Math.round(videoTotalDurationSec * 48000);
  // Bound Lab audio by samples: a short synthetic-silence layer can leave the
  // mix without timestamps, making unbounded apad + time-based atrim never end.
  const audioTail = projectState.sequence?.transitionTiming === 'centered-v1'
    ? `aresample=48000,apad=whole_len=${audioSamples},atrim=end_sample=${audioSamples},asetpts=N/SR/TB`
    : `apad,atrim=duration=${videoTotalDurationSec}`;
  if (audioLayers.length) filterParts.push(`${audioLayers.join('')}${audioLayers.length > 1 ? `amix=inputs=${audioLayers.length}:duration=longest:normalize=0,` : ''}${audioTail}[aout]`);

  const totalDurationMs = Math.round(videoTotalDurationSec * 1000);

  // Paths go in as separate spawn() array elements (never inside the filtergraph string), so no
  // filtergraph-level escaping applies here — escapeWindowsPathForFilter is only needed for the
  // fontfile= path INSIDE -filter_complex (buildClipVideoBranch's drawtext branch above).
  // Phase 14 (§0): an image input gets `-loop 1 -framerate <fps>` so ffmpeg decodes it as an
  // indefinitely-repeating video stream (verified against real ffmpeg) — every clip branch above
  // (buildClipVideoBranch's `trim=start=...:end=...`) already assumes its `[idx:v]` input has at
  // least as many frames as the clip's own sourceIn/OutMs range; a plain `-i` on a still image
  // would only ever produce ONE frame and fail that trim for any sticker clip longer than 1/fps.
  const args = ['-y', ...inputPaths.flatMap((entry) => (
    entry.kind === 'image' ? ['-loop', '1', '-framerate', String(fps), '-i', entry.path] : ['-i', entry.path]
  ))];
  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', runningVideoLabel);
  if (audioLabel) args.push('-map', audioLabel);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps));
  args.push(audioLabel ? '-c:a' : '-an', ...(audioLabel ? ['aac', '-b:a', '192k'] : []));
  args.push('-progress', 'pipe:1', '-nostats', outputPath);

  return { args, totalDurationMs, inputPaths };
}

module.exports = {
  buildRenderPlan, buildClipVideoBranch, buildClipAudioBranch, sampleAnimatedTimesMs,
};
