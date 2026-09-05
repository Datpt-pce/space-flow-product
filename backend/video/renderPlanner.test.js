// Render Planner — Video Editor Phase 4 (specs/space-flow-master-plan/04-video-editor.md §5):
// pure-logic tests for the filter_complex STRING building (no ffmpeg/fs involved — that's what
// backend/video/__tests__/golden/ exercises against real ffmpeg). Run with:
// node backend/video/renderPlanner.test.js

const assert = require('assert');
const { buildRenderPlan } = require('./renderPlanner');
const { escapeDrawtextText, quoteFilterValue } = require('./ffmpegArgs');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function baseState(overrides = {}) {
  return {
    schemaVersion: 1,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    colorSpace: 'sRGB',
    audioRate: 48000,
    sequence: { markers: [] },
    tracks: [
      {
        id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true,
        clips: [
          { id: 'clip-1', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 5000, timelineInMs: 0, timelineOutMs: 5000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] },
        ],
      },
      { id: 'track-a1', type: 'audio', order: 1, locked: false, muted: false, visible: true, clips: [] },
    ],
    transitions: [],
    ...overrides,
  };
}

function main() {
  check('single clip, no audio track -> falls back to the clip\'s own embedded audio', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    assert.ok(plan.args.includes('-i'));
    assert.strictEqual(plan.inputPaths.length, 1);
    assert.ok(plan.args.join(' ').includes('-map [vout]'.replace(' ', ' '))); // sanity: -map and [vout] both present
    assert.ok(plan.args.includes('[vout]'));
    assert.ok(plan.args.includes('[aout]')); // fallback audio branch built from the video clip itself
    assert.strictEqual(plan.totalDurationMs, 5000);
  });

  check('video track muted -> no audio fallback, no [aout] map, output is -an', () => {
    const state = baseState();
    state.tracks[0].muted = true;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    assert.ok(!plan.args.includes('[aout]'));
    assert.ok(plan.args.includes('-an'));
  });

  check('explicit audio track mixes with video audio', () => {
    const state = baseState();
    state.tracks[1].clips.push({ id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, volume: 0.8, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    assert.strictEqual(plan.inputPaths.length, 2);
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('volume=0.8')); // the audio TRACK clip's own volume, not a default 1
  });

  check('Phase 16 follow-up: a MUTED audio track falls back to the video clip\'s own embedded audio, matching preview\'s own findAudioSourceClip() behavior', () => {
    const state = baseState();
    state.tracks[1].muted = true;
    state.tracks[1].clips.push({ id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, volume: 0.8, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('volume=0.8'), 'a muted audio track\'s own clip must never be burned in');
    assert.ok(plan.args.includes('[aout]')); // still SOME audio — the base video clip's own embedded track
  });

  check('2 clips concatenated -> concat=n=2, total duration = sum of both', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('concat=n=2:v=1:a=0'));
    assert.strictEqual(plan.totalDurationMs, 8000); // 5000 + 3000
    assert.strictEqual(plan.inputPaths.length, 1); // same asset, deduped to 1 -i
  });

  // 08-H S7 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md) —
  // gap-fill / absolute-time compositing. Real-ffmpeg pixel/duration proof lives in
  // backend/video/__tests__/golden/render.test.js Fixtures 22-23; these are the fast, pure-logic
  // filter-string-shape counterparts (same division of labor this file's own header comment
  // describes for every other feature).
  check('08-H S7: a real gap between 2 clips inserts a black gap segment sized to the gap, total duration INCLUDES it', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 6000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] });
    // clip-1: 0-5000. Real 1000ms gap (5000-6000). clip-2: 6000-8000.
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black:s=1920x1080:d=1:r=30'), `expected a 1s opaque black gap segment, got: ${filterStr}`);
    assert.strictEqual(plan.totalDurationMs, 8000, 'total duration must include the gap, not just the 2 clips\' own durations (5000)');
  });

  check('08-H S7: a LEADING gap (first clip does not start at timelineInMs 0) is filled too', () => {
    const state = baseState();
    state.tracks[0].clips[0].timelineInMs = 2000;
    state.tracks[0].clips[0].timelineOutMs = 7000; // same 5000ms own duration, just starts later
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black:s=1920x1080:d=2:r=30'), `expected a 2s leading gap segment, got: ${filterStr}`);
    assert.strictEqual(plan.totalDurationMs, 7000, 'total duration is measured from project t=0, including the leading gap');
  });

  check('08-H S7: NO gap anywhere -> byte-identical to the pre-S7 single concat=n=N shape, no gap segment emitted', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('gap'), `expected no gap segment/label at all when clips are touching, got: ${filterStr}`);
    assert.ok(filterStr.includes('[v0][v1]concat=n=2:v=1:a=0[vout]'), `expected the exact pre-S7 single-concat shape, got: ${filterStr}`);
  });

  check('08-H S7: gap on an OVERLAY track uses a TRANSPARENT (alpha-zero) gap segment, not opaque black', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{ id: 'ov-clip', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 3000, timelineOutMs: 4000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black@0.0:s=1920x1080:d=3:r=30,format=yuva420p'), `expected a 3s TRANSPARENT leading gap segment on the overlay track, got: ${filterStr}`);
    // The composite step itself needs NO change — plain overlay=x=0:y=0, no tpad — because
    // gap-filling already aligns both tracks on project t=0 (verified in
    // backend/video/spike/absolute-time-spike.js Test 2).
    assert.ok(filterStr.includes('overlay=x=0:y=0:eof_action=pass'));
    assert.ok(!filterStr.includes('tpad'), 'no tpad step should be needed for overlay TRACK alignment (only sticker clips use tpad)');
  });

  check('08-H S7: a transition can only join 2 REAL clips, never span a gap — gap segments always plain-concat', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 6000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    state.transitions.push({ id: 't1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 300 }); // invalid in practice (not touching) — proves the render layer doesn't crash/misapply xfade across a gap either way
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('xfade'), 'a transition between 2 clips with a real gap between them must never produce an xfade step');
  });

  check('08-H: a real gap between 2 clips on a DEDICATED audio track is filled with silence, keeping clip-2 at its real absolute position', () => {
    const state = baseState();
    state.tracks[1].clips.push(
      { id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, effects: [], keyframes: [] },
      { id: 'aclip-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, effects: [], keyframes: [] },
    );
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=3'), `expected a 3s silence segment filling the audio-track gap, got: ${filterStr}`);
    assert.ok(filterStr.includes('concat=n=3:v=0:a=1['), `expected concat over 3 segments (clip, gap, clip), got: ${filterStr}`);
  });

  check('clip out-of-order in the array is still rendered in TIMELINE order', () => {
    const state = baseState();
    state.tracks[0].clips = [
      { id: 'clip-late', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 5000, timelineOutMs: 6000, speed: 1, transform: {}, effects: [], keyframes: [] },
      { id: 'clip-early', assetId: 'asset-1', sourceInMs: 1000, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] },
    ];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const earlyIdx = filterStr.indexOf('start=1:end=2'); // clip-early's sourceIn/OutMs in seconds
    const lateIdx = filterStr.indexOf('start=0:end=1'); // clip-late's
    assert.ok(earlyIdx !== -1 && lateIdx !== -1 && earlyIdx < lateIdx, 'clip-early (timelineInMs=0) must be built before clip-late (timelineInMs=5000) regardless of array order');
  });

  check('rotation adds a rotate= filter step only when non-zero', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.rotation = 90;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('rotate='));
  });

  check('no rotation -> no rotate= filter step at all', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('rotate='));
  });

  check('video fade in/out adds a fade= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].videoFadeInMs = 500;
    state.tracks[0].clips[0].videoFadeOutMs = 500;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('fade=t=in:st=0:d=0.5'));
    assert.ok(filterStr.includes('fade=t=out:st=4.5:d=0.5')); // 5s clip - 0.5s fade-out
  });

  check('clip.text without a fontFilePath throws a clear error', () => {
    const state = baseState();
    state.tracks[0].clips[0].text = { content: 'Hello' };
    assert.throws(
      () => buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' }),
      /fontFilePath/,
    );
  });

  check('clip.text WITH a fontFilePath builds a drawtext step, escaping special characters', () => {
    const state = baseState();
    state.tracks[0].clips[0].text = { content: "It's 10:30" };
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4', fontFilePath: 'C:\\Windows\\Fonts\\arial.ttf' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('drawtext=fontfile='));
    // 2-layer escape, same convention as Phase 0's render-spike.js: drawtext's own text-value
    // escape (escapeDrawtextText) THEN the outer filtergraph single-quote wrapping
    // (quoteFilterValue) — reuse those exact functions here rather than hand-writing the doubly-
    // escaped string, since quoteFilterValue's own quote-escaping further transforms the result.
    const expectedQuotedText = quoteFilterValue(escapeDrawtextText("It's 10:30"));
    assert.ok(filterStr.includes(`text=${expectedQuotedText}`));
  });

  check('missing asset path throws a clear, specific error (not a cryptic ffmpeg failure later)', () => {
    assert.throws(
      () => buildRenderPlan(baseState(), { assetPaths: {}, outputPath: '/out.mp4' }),
      /No resolved file path for asset "asset-1"/,
    );
  });

  check('project with no video clips at all throws a clear error', () => {
    const state = baseState();
    state.tracks[0].clips = [];
    assert.throws(() => buildRenderPlan(state, { assetPaths: {}, outputPath: '/out.mp4' }), /no video clips/);
  });

  check('Phase 7: clip with no keyframes at all -> overlay x=/y= are plain numbers, byte-identical to pre-Phase-7 output', () => {
    const state = baseState();
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // 1920x1080 canvas, identity transform -> destWidth=1920/destHeight=1080 (fills canvas) -> centered at x=0,y=0.
    assert.ok(filterStr.includes('overlay=x=0:y=0:shortest=1'));
  });

  check('Phase 7: x keyframed -> overlay x= becomes a time expression, y stays a plain number', () => {
    const state = baseState();
    state.tracks[0].clips[0].keyframes = [
      { id: 'k1', propertyPath: 'transform.x', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k2', propertyPath: 'transform.x', timeMs: 5000, value: 100, easing: 'linear' },
    ];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('overlay=x=if(lt(t'), 'expected a time-varying x= expression');
    assert.ok(filterStr.includes(':y=0:shortest=1'), 'y should stay a plain static number — only x was keyframed');
  });

  check('Phase 7: opacity keyframed -> geq alpha expression replaces colorchannelmixer', () => {
    const state = baseState();
    state.tracks[0].clips[0].keyframes = [
      { id: 'k1', propertyPath: 'transform.opacity', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k2', propertyPath: 'transform.opacity', timeMs: 5000, value: 1, easing: 'linear' },
    ];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes("geq=r='r(X\\,Y)'"), 'expected a geq alpha step, not colorchannelmixer');
    assert.ok(!filterStr.includes('colorchannelmixer'), 'colorchannelmixer should be replaced entirely, not both present');
  });

  check('Phase 7: opacity NOT keyframed -> exactly the old colorchannelmixer=aa=<number> step', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.opacity = 0.42;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('colorchannelmixer=aa=0.42'));
    assert.ok(!filterStr.includes('geq='));
  });

  check('Phase 7: scaleX/rotation keyframes are IGNORED in export (deliberate scope cut) — output uses the static base value', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.rotation = 45;
    state.tracks[0].clips[0].keyframes = [
      { id: 'k1', propertyPath: 'transform.rotation', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k2', propertyPath: 'transform.rotation', timeMs: 5000, value: 90, easing: 'linear' },
    ];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // Static base value (45deg), not a time expression, and not either keyframed endpoint (0/90).
    assert.ok(filterStr.includes(`rotate=${(45 * Math.PI) / 180}`));
    assert.ok(!filterStr.includes('rotate=if(lt('));
  });

  check('Phase 8: speed 1 (default) -> byte-identical trim/setpts to pre-Phase-8 output', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('trim=start=0:end=5,setpts=PTS-STARTPTS,scale='));
  });

  check('Phase 8: speed 2 -> setpts divides by the magnitude, no reverse filter', () => {
    const state = baseState();
    state.tracks[0].clips[0].speed = 2;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('setpts=(PTS-STARTPTS)/2'));
    assert.ok(filterStr.includes('atempo=2'));
    assert.ok(!filterStr.includes('reverse'));
  });

  check('Phase 8: negative speed -> reverse (video) + areverse (audio) filters added', () => {
    const state = baseState();
    state.tracks[0].clips[0].speed = -1;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes(',reverse,'));
    assert.ok(filterStr.includes('areverse'));
  });

  check('Phase 8: speed 0.25 -> chained atempo (0.5 * 0.5), single atempo=0.25 is invalid in real ffmpeg', () => {
    const state = baseState();
    state.tracks[0].clips[0].speed = 0.25;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('atempo=0.5,atempo=0.5'));
  });

  check('Phase 8: speed 0 (freeze-frame) -> loop filter, no reverse/setpts-divide, and SILENT fallback audio (anullsrc, not [inputIdx:a])', () => {
    const state = baseState();
    state.tracks[0].clips[0].speed = 0;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('loop=loop=-1:size=1'));
    assert.ok(filterStr.includes('anullsrc'));
    assert.ok(!filterStr.includes('[0:a]atrim')); // the clip's own embedded audio must NOT be used
  });

  check('Phase 9: no transitions -> exactly the old single N-input concat, byte-identical', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('[v0][v1]concat=n=2:v=1:a=0[vout]'));
    assert.ok(!filterStr.includes('xfade'));
    assert.strictEqual(plan.totalDurationMs, 8000);
  });

  check('Phase 9: transition between 2 clips -> xfade replaces that join, totalDurationMs shrinks by the transition duration', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    state.transitions = [{ id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('[v0][v1]xfade=transition=fade:duration=0.5:offset=4.5'));
    assert.strictEqual(plan.totalDurationMs, 7500); // 5000 + 3000 - 500
  });

  check('Phase 9: 3 clips, transition on only the 2nd join -> mixed concat + xfade chain', () => {
    const state = baseState();
    state.tracks[0].clips.push(
      { id: 'clip-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] },
      { id: 'clip-3', assetId: 'asset-3', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 8000, timelineOutMs: 10000, speed: 1, transform: {}, effects: [], keyframes: [] },
    );
    state.transitions = [{ id: 'trans-1', fromClipId: 'clip-2', toClipId: 'clip-3', durationMs: 1000, params: {} }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4', 'asset-3': '/media/c.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('[v0][v1]concat=n=2:v=1:a=0[vjoin1]'));
    assert.ok(filterStr.includes('[vjoin1][v2]xfade=transition=fade:duration=1:offset=7[vjoin2]'));
    assert.strictEqual(plan.totalDurationMs, 9000); // 5000+3000+2000 - 1000
  });

  check('Phase 9: embedded-audio fallback trims the START of the audio right after a transition, to stay in sync with the shortened video', () => {
    const state = baseState();
    state.tracks[0].clips.push({ id: 'clip-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 8000, speed: 1, transform: {}, effects: [], keyframes: [] });
    state.transitions = [{ id: 'trans-1', fromClipId: 'clip-1', toClipId: 'clip-2', durationMs: 500, params: {} }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('atrim=start=0.5,asetpts=PTS-STARTPTS[mix0c1trimmed]'));
  });

  check('Phase 10: no chromaKey effect -> no colorkey= step, byte-identical to before', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('colorkey'));
  });

  check('Phase 10: enabled chromaKey effect -> colorkey= step with its params', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'chromaKey', enabled: true, order: 0, params: { color: '0x00FF00', similarity: 0.3, blend: 0.1 } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('colorkey=0x00FF00:0.3:0.1'));
  });

  check('Phase 10: DISABLED chromaKey effect -> no colorkey= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'chromaKey', enabled: false, order: 0, params: { color: '0x00FF00', similarity: 0.3, blend: 0.1 } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('colorkey'));
  });

  check('Phase 11: no colorGrade/lut/curves effects -> no eq=/hue=/lut3d=/curves= steps, byte-identical to before', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('eq='));
    assert.ok(!filterStr.includes('hue='));
    assert.ok(!filterStr.includes('lut3d='));
    assert.ok(!filterStr.includes('curves='));
  });

  check('Phase 11: enabled colorGrade effect -> eq= step with its params, and hue= only when hue is non-zero', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'colorGrade', enabled: true, order: 0, params: { brightness: 0.2, contrast: 1.5, saturation: 0.5, gamma: 1.2, hue: 0 } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('eq=brightness=0.2:contrast=1.5:saturation=0.5:gamma=1.2'), filterStr);
    assert.ok(!filterStr.includes('hue='), filterStr);
  });

  check('Phase 11: colorGrade with non-zero hue -> a separate hue=h= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'colorGrade', enabled: true, order: 0, params: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 90 } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('hue=h=90'), filterStr);
  });

  check('Phase 11: DISABLED colorGrade effect -> no eq=/hue= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'colorGrade', enabled: false, order: 0, params: { brightness: 0.5, contrast: 1, saturation: 1, gamma: 1, hue: 90 } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('eq='));
    assert.ok(!filterStr.includes('hue='));
  });

  check('Phase 11: enabled lut effect -> lut3d=file= step with the escaped/quoted path (Windows path with drive letter + space)', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'lut', enabled: true, order: 0, params: { path: 'C:\\Users\\Name\\my luts\\invert.cube' } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes(`lut3d=file=${quoteFilterValue('C\\:/Users/Name/my luts/invert.cube')}`), filterStr);
  });

  check('Phase 11: DISABLED lut effect -> no lut3d= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'lut', enabled: false, order: 0, params: { path: 'C:\\invert.cube' } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('lut3d='));
  });

  check('Phase 11: enabled curves effect -> curves=preset= step with its preset', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'curves', enabled: true, order: 0, params: { preset: 'vintage' } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('curves=preset=vintage'), filterStr);
  });

  check('Phase 11: DISABLED curves effect -> no curves= step', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [{ id: 'fx1', type: 'curves', enabled: false, order: 0, params: { preset: 'vintage' } }];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('curves='));
  });

  check('Phase 11: colorGrade/lut/curves are ordered AFTER colorkey (chroma-key sees the ORIGINAL captured color, not the graded one)', () => {
    const state = baseState();
    state.tracks[0].clips[0].effects = [
      { id: 'fx1', type: 'chromaKey', enabled: true, order: 0, params: { color: '0x00FF00', similarity: 0.3, blend: 0.1 } },
      { id: 'fx2', type: 'colorGrade', enabled: true, order: 1, params: { brightness: 0.2, contrast: 1, saturation: 1, gamma: 1, hue: 0 } },
      { id: 'fx3', type: 'lut', enabled: true, order: 2, params: { path: 'C:\\invert.cube' } },
      { id: 'fx4', type: 'curves', enabled: true, order: 3, params: { preset: 'vintage' } },
    ];
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const colorkeyIdx = filterStr.indexOf('colorkey');
    const eqIdx = filterStr.indexOf('eq=');
    const lutIdx = filterStr.indexOf('lut3d=');
    const curvesIdx = filterStr.indexOf('curves=');
    assert.ok(colorkeyIdx !== -1 && eqIdx !== -1 && lutIdx !== -1 && curvesIdx !== -1, filterStr);
    assert.ok(colorkeyIdx < eqIdx && eqIdx < lutIdx && lutIdx < curvesIdx, `expected colorkey < eq < lut3d < curves ordering, got ${filterStr}`);
  });

  check('Phase 12: still exactly 1 video track -> -map [vout] directly, no ov*/blend/overlay= composite steps at all', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('ov1'));
    assert.ok(!filterStr.includes('blend='));
    assert.ok(plan.args.includes('[vout]')); // literal -map target, byte-identical to pre-Phase-12
  });

  check('Phase 12: 2nd visible video track (no blendMode effect) -> composited via plain alpha overlay=...eof_action=pass onto a TRANSPARENT-bg layer', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black@0.0:'), 'overlay track clip must render onto a transparent, not opaque, background');
    assert.ok(filterStr.includes('[vout][ov1out]overlay=x=0:y=0:eof_action=pass[ov1composite]'), filterStr);
    assert.ok(!filterStr.includes('blend='), 'normal mode must use plain overlay=, not blend=');
    assert.ok(plan.args.includes('[ov1composite]'), '-map target must be the composited output, not the base [vout]');
  });

  check('Phase 12: overlay clip with an enabled blendMode effect -> blend=all_mode=<mode>:eof_action=pass, wrapped in format=gbrp/format=yuv420p', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{
        id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, keyframes: [],
        effects: [{ id: 'fx1', type: 'blendMode', enabled: true, order: 0, params: { mode: 'multiply' } }],
      }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('[vout]format=gbrp,split[ov1base][ov1blendbase]'), filterStr);
    assert.ok(filterStr.includes('[ov1color]format=gbrp[ov1rgb]'), filterStr);
    assert.ok(filterStr.includes('[ov1blendbase][ov1rgb]blend=all_mode=multiply:eof_action=pass[ov1blended]'), filterStr);
    assert.ok(filterStr.includes('[ov1base][ov1blended][ov1mask]maskedmerge,format=yuv420p[ov1composite]'), filterStr);
    assert.ok(!filterStr.includes('overlay=x=0:y=0:eof_action=pass'), 'a non-normal blend mode must NOT also emit the plain alpha-overlay step');
  });

  check('Phase 12: DISABLED blendMode effect on the overlay clip -> falls back to normal (plain overlay=), not blend=', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{
        id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, keyframes: [],
        effects: [{ id: 'fx1', type: 'blendMode', enabled: false, order: 0, params: { mode: 'screen' } }],
      }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('blend='));
    assert.ok(filterStr.includes('overlay=x=0:y=0:eof_action=pass'));
  });

  check('Phase 12: 2 clips on the SAME overlay track, different blend modes -> the FIRST (timeline order) wins for the whole track', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [
        {
          id: 'ovl-2', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 1000, timelineOutMs: 2000, speed: 1, transform: {}, keyframes: [],
          effects: [{ id: 'fx2', type: 'blendMode', enabled: true, order: 0, params: { mode: 'screen' } }],
        },
        {
          id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1, transform: {}, keyframes: [],
          effects: [{ id: 'fx1', type: 'blendMode', enabled: true, order: 0, params: { mode: 'multiply' } }],
        },
      ],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // ovl-1 (timelineInMs=0, added SECOND to the array but EARLIER on the timeline) must win, despite array order.
    assert.ok(filterStr.includes('all_mode=multiply'), filterStr);
    assert.ok(!filterStr.includes('all_mode=screen'), filterStr);
  });

  check('Phase 12: overlay track with visible:false is skipped entirely -> -map [vout] directly, as if it did not exist', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: false,
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('ov1'));
    assert.ok(plan.args.includes('[vout]'));
  });

  // 08-F F3 (specs/.../08-v2/08-f-timeline-authoring.md): the BASE track used to ignore `.visible`
  // entirely (a documented scope cut) — canvasEngine.js's findActiveVideoClips() has never
  // special-cased a base track, it filters `.visible` uniformly, so hiding the only video track
  // made preview show nothing while export still burned it in. These 2 tests prove the fix.
  check('08-F F3: the base track itself respects `.visible` — hiding it promotes the next visible video track to base instead of still rendering the hidden one', () => {
    const state = baseState();
    state.tracks[0].visible = false; // track-v1 (order:0), previously always the base regardless
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // track-v2 (the only visible one) must be the BASE now — no ov1/blend= multi-track compositing
    // (same "single track" shape as the plain 1-track test above), and asset-2's input must be the
    // one feeding the base concat, not asset-1's (hidden track) — dedupe-on-demand in
    // makeInputResolver() means an asset never referenced by an actually-processed clip never gets
    // an `-i` entry at all.
    assert.ok(!filterStr.includes('ov1'), filterStr);
    assert.ok(!filterStr.includes('blend='), filterStr);
    assert.ok(plan.args.includes('/media/b.mp4'));
    assert.ok(plan.args.includes('/media/a.mp4'), 'hidden video retains independently unmuted audio');
    assert.ok(!plan.args[plan.args.indexOf('-filter_complex') + 1].includes('[1:v]'), 'hidden source is not composed visually');
  });

  check('08-F F3: every video track hidden -> throws a clear error instead of silently rendering the hidden one', () => {
    const state = baseState();
    state.tracks[0].visible = false;
    assert.throws(() => buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' }), /no video clips to render/);
  });

  check('Phase 12: base track selection is by `.order`, not array position — a video track earlier in the array with a HIGHER order becomes the overlay', () => {
    const state = baseState();
    // Put the higher-order track FIRST in the array — array position must not matter.
    state.tracks.unshift({
      id: 'track-v0', type: 'video', order: 5, locked: false, muted: false, visible: true,
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    // track-v1 (order:0, has clip-1/asset-1) must still be the BASE (its own clip content branch uses input for asset-1),
    // track-v0 (order:5) must be the overlay despite coming first in the array.
    assert.ok(filterStr.includes('[vout][ov1out]overlay'), filterStr);
  });

  check('Phase 12: 3 video tracks (base + 2 overlays) -> composites chain sequentially, final -map targets the LAST composite', () => {
    const state = baseState();
    state.tracks.splice(1, 0,
      { id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true, clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }] },
      { id: 'track-v3', type: 'video', order: 2, locked: false, muted: false, visible: true, clips: [{ id: 'ovl-2', assetId: 'asset-3', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }] },
    );
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4', 'asset-3': '/media/c.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('[vout][ov1out]overlay=x=0:y=0:eof_action=pass[ov1composite]'), filterStr);
    assert.ok(filterStr.includes('[ov1composite][ov2out]overlay=x=0:y=0:eof_action=pass[ov2composite]'), filterStr);
    assert.ok(plan.args.includes('[ov2composite]'));
  });

  // 08-H (acceptance §5): SUPERSEDES the old Phase 12 behavior this test used to lock in
  // ("totalDurationMs is unaffected by overlay tracks") — an overlay longer than the base track
  // used to be silently cut off; verified against real ffmpeg first, see
  // backend/video/spike/max-duration-spike.js.
  check('08-H: totalDurationMs extends to cover an overlay track LONGER than the base — base gets tpad=stop_duration padding', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      // Overlay clip is deliberately LONGER than the base's own 5s clip.
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 9000, timelineInMs: 0, timelineOutMs: 9000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    assert.strictEqual(plan.totalDurationMs, 9000, 'total duration must now cover the longer overlay, not just the base');
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black:s=1920x1080:d=4:r=30[vpad0]'), `expected a 4s (9s-5s) black pad segment; filtergraph: ${filterStr}`);
    assert.ok(filterStr.includes('[vout][vpad0]concat=n=2:v=1:a=0[vpadded]'), `expected the base to be extended via concat (not tpad — see renderPlanner.js's own comment on why); filtergraph: ${filterStr}`);
  });

  check('08-H: base track LONGER than every overlay/sticker/caption -> no pad step at all, byte-identical to before', () => {
    const state = baseState();
    state.tracks.splice(1, 0, {
      id: 'track-v2', type: 'video', order: 1, locked: false, muted: false, visible: true,
      clips: [{ id: 'ovl-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0, timelineOutMs: 2000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp4' }, outputPath: '/out.mp4' });
    assert.strictEqual(plan.totalDurationMs, 5000);
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('vpad0') && !filterStr.includes('vpadded'), 'base is already the longest track — must not add a no-op pad step');
  });

  check('Phase 13: no caption track -> no drawtext step at all, byte-identical to before', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('drawtext'));
    assert.ok(plan.args.includes('[vout]'));
  });

  check('Phase 13: caption cue -> drawtext step gated by enable=between(t,startSec,endSec), bottom-center default position', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true,
      clips: [{
        id: 'cue-1', timelineInMs: 1000, timelineOutMs: 3000, sourceInMs: 0, sourceOutMs: 2000,
        speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Hello' },
      }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4', fontFilePath: 'C:\\Windows\\Fonts\\arial.ttf' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes("enable='between(t\\,1\\,3)'"), filterStr);
    assert.ok(filterStr.includes('y=(h-text_h*1-0.08*h)+0*text_h'), filterStr); // bottom-anchored, NOT clip.text's centered default; *1/+0*text_h is the single-line case of the N-line-aware formula (08-H5 multiline fix)
    assert.ok(filterStr.includes('box=1:boxcolor=black@0.5'), filterStr);
    assert.ok(plan.args.includes('[caption0_0]'), 'final -map target must be the caption-burned output');
  });

  check('Phase 13: caption cue without a fontFilePath throws a clear error', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true,
      clips: [{ id: 'cue-1', timelineInMs: 0, timelineOutMs: 1000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Hi' } }],
    });
    assert.throws(
      () => buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' }),
      /fontFilePath/,
    );
  });

  check('Phase 13: caption clip with no text.content (e.g. mid-edit) is skipped, not burned', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true,
      clips: [{ id: 'cue-1', timelineInMs: 0, timelineOutMs: 1000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [], text: { content: '' } }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('drawtext'));
  });

  check('Phase 13: caption track with visible:false is skipped entirely', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: false,
      clips: [{ id: 'cue-1', timelineInMs: 0, timelineOutMs: 1000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Hi' } }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('drawtext'));
  });

  check('Phase 13: 2 caption cues -> chained drawtext steps, each with its OWN enable window, in timeline order', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true,
      clips: [
        { id: 'cue-2', timelineInMs: 5000, timelineOutMs: 6000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Second' } },
        { id: 'cue-1', timelineInMs: 1000, timelineOutMs: 2000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'First' } },
      ],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4', fontFilePath: 'C:\\Windows\\Fonts\\arial.ttf' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const firstIdx = filterStr.indexOf("text='First'");
    const secondIdx = filterStr.indexOf("text='Second'");
    assert.ok(firstIdx !== -1 && secondIdx !== -1 && firstIdx < secondIdx, 'earlier-timeline cue must be chained first, regardless of array order');
    assert.ok(filterStr.includes("enable='between(t\\,1\\,2)'"), filterStr);
    assert.ok(filterStr.includes("enable='between(t\\,5\\,6)'"), filterStr);
    assert.ok(plan.args.includes('[caption1_0]'), '-map must target the LAST chained caption step');
  });

  check('08-H5: multi-line caption content (real newline, from the CaptionPanel textarea) never embeds a raw \\n inside one drawtext\'s own text= value', () => {
    // A raw newline byte inside a single drawtext's text= value is not safely parseable by
    // ffmpeg's own filtergraph string parser (verified against real ffmpeg — see
    // drawtextLineExprs()'s own comment in renderPlanner.js) — this is a structural guarantee the
    // real-ffmpeg golden fixture (H5's multi-line fixture) can't fully substitute for, since a
    // parser-level crash would need to be reproduced on the exact platform that breaks.
    const state = baseState();
    state.tracks.push({
      id: 'track-cap1', type: 'caption', order: 2, locked: false, muted: false, visible: true,
      clips: [{
        id: 'cue-1', timelineInMs: 1000, timelineOutMs: 3000, sourceInMs: 0, sourceOutMs: 2000,
        speed: 1, transform: {}, effects: [], keyframes: [], text: { content: 'Line one\nLine two' },
      }],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4', fontFilePath: 'C:\\Windows\\Fonts\\arial.ttf' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('\n'.repeat(1) + 'Line two') && !/text='[^']*\n[^']*'/.test(filterStr), 'no drawtext text= value may contain a raw newline byte');
    assert.ok(filterStr.includes("text='Line one'"), filterStr);
    assert.ok(filterStr.includes("text='Line two'"), filterStr);
    // 2nd line stacks BELOW the 1st by exactly 1 line-height (text_h), both sharing the same
    // N-line-aware bottom anchor (see drawtextLineExprs() call site in buildRenderPlan()).
    assert.ok(filterStr.includes('(h-text_h*2-0.08*h)+0*text_h'), filterStr);
    assert.ok(filterStr.includes('(h-text_h*2-0.08*h)+1*text_h'), filterStr);
    assert.ok(plan.args.includes('[caption0_1]'), '-map must target the LAST chained line of the LAST cue');
  });

  check('08-H5: multi-line clip.text (title overlay, not a caption) also chains one drawtext per line, centered as a whole block', () => {
    const state = baseState();
    state.tracks[0].clips[0].text = { content: 'Top\nBottom', fontSize: 40 };
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4', fontFilePath: 'C:\\Windows\\Fonts\\arial.ttf' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!/text='[^']*\n[^']*'/.test(filterStr), 'no drawtext text= value may contain a raw newline byte');
    assert.ok(filterStr.includes("text='Top'"), filterStr);
    assert.ok(filterStr.includes("text='Bottom'"), filterStr);
    assert.ok(filterStr.includes('(h-text_h*2)/2+0*text_h'), filterStr);
    assert.ok(filterStr.includes('(h-text_h*2)/2+1*text_h'), filterStr);
  });

  check('Phase 14: image asset input gets -loop 1 -framerate, video asset input stays a plain -i', () => {
    const state = baseState();
    const plan = buildRenderPlan(state, {
      assetPaths: { 'asset-1': '/media/a.mp4' }, assetKinds: { 'asset-1': 'video' }, outputPath: '/out.mp4',
    });
    const iIdx = plan.args.indexOf('-i');
    assert.ok(!plan.args.slice(0, iIdx).includes('-loop'), 'a video input must not get -loop');
  });

  check('Phase 14: no sticker track -> no tpad/sticker step at all, byte-identical to before', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('tpad'));
  });

  check('Phase 14: sticker clip -> image input gets -loop 1 -framerate, content branch tpad-shifted to its timelineInMs, overlaid with eof_action=pass', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-sticker1', type: 'sticker', order: 2, locked: false, muted: false, visible: true,
      clips: [{
        id: 'sticker-1', assetId: 'asset-img', timelineInMs: 2000, timelineOutMs: 4000, sourceInMs: 0, sourceOutMs: 2000,
        speed: 1, transform: { x: 0, y: 0, scaleX: 0.3, scaleY: 0.3, rotation: 0, opacity: 1 }, effects: [], keyframes: [],
      }],
    });
    const plan = buildRenderPlan(state, {
      assetPaths: { 'asset-1': '/media/a.mp4', 'asset-img': '/media/logo.png' },
      assetKinds: { 'asset-1': 'video', 'asset-img': 'image' },
      outputPath: '/out.mp4',
    });
    const imgIdx = plan.args.indexOf('/media/logo.png');
    assert.ok(imgIdx > 0, 'image path must be a real -i input');
    assert.deepStrictEqual(plan.args.slice(imgIdx - 5, imgIdx - 1), ['-loop', '1', '-framerate', '30']);
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black@0.0') && filterStr.includes('d=2'), 'leading gap remains transparent');
    assert.ok(filterStr.includes('overlay=x=0:y=0:eof_action=pass[ov1composite]'), filterStr);
    assert.ok(plan.args.includes('[ov1composite]'), '-map must target the sticker-composited output');
  });

  check('Phase 14: sticker track with visible:false is skipped entirely', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-sticker1', type: 'sticker', order: 2, locked: false, muted: false, visible: false,
      clips: [{ id: 'sticker-1', assetId: 'asset-img', timelineInMs: 0, timelineOutMs: 1000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] }],
    });
    const plan = buildRenderPlan(state, {
      assetPaths: { 'asset-1': '/media/a.mp4', 'asset-img': '/media/logo.png' },
      assetKinds: { 'asset-img': 'image' },
      outputPath: '/out.mp4',
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('tpad'));
  });

  check('Phase 14: 2 sticker clips composite in TIMELINE order regardless of array order, each with its own tpad offset', () => {
    const state = baseState();
    state.tracks.push({
      id: 'track-sticker1', type: 'sticker', order: 2, locked: false, muted: false, visible: true,
      clips: [
        { id: 'sticker-late', assetId: 'asset-img', timelineInMs: 3000, timelineOutMs: 4000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] },
        { id: 'sticker-early', assetId: 'asset-img', timelineInMs: 0, timelineOutMs: 1000, sourceInMs: 0, sourceOutMs: 1000, speed: 1, transform: {}, effects: [], keyframes: [] },
      ],
    });
    const plan = buildRenderPlan(state, {
      assetPaths: { 'asset-1': '/media/a.mp4', 'asset-img': '/media/logo.png' },
      assetKinds: { 'asset-img': 'image' },
      outputPath: '/out.mp4',
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const earlyIdx = filterStr.indexOf('[ov10bg]');
    const lateIdx = filterStr.indexOf('[ov12bg]');
    assert.ok(earlyIdx !== -1 && lateIdx !== -1 && earlyIdx < lateIdx, 'earlier-timeline sticker must be chained first, regardless of array order');
    assert.ok(filterStr.includes('[ov1gap1]') && filterStr.includes('d=2'), 'two clips retain their intervening transparent gap');
    assert.ok(plan.args.includes('[ov1composite]'), '-map must target the composed sticker track');
  });

  check('Phase 15: no normalize effect -> no loudnorm= step, byte-identical to before', () => {
    const state = baseState();
    state.tracks[1].clips.push({ id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, volume: 1, effects: [], keyframes: [] });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('loudnorm'));
  });

  check('Phase 15: enabled normalize effect -> loudnorm= step BEFORE volume=, fixed EBU R128 defaults', () => {
    const state = baseState();
    state.tracks[1].clips.push({
      id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, volume: 0.8,
      effects: [{ id: 'fx1', type: 'normalize', enabled: true, order: 0, params: {} }], keyframes: [],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('loudnorm=I=-16:TP=-1.5:LRA=11'), filterStr);
    assert.ok(filterStr.indexOf('loudnorm=') < filterStr.indexOf('volume=0.8'), 'loudnorm must come before volume in the filter chain');
  });

  check('Phase 16: no resolutionOverride/crf -> project\'s own resolution + CRF 18, byte-identical to before', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('s=1920x1080'), filterStr); // baseState()'s own project resolution
    assert.ok(plan.args.includes('18'));
  });

  check('Phase 16: resolutionOverride/crf -> the OVERRIDE resolution drives the whole filtergraph, not the project\'s own', () => {
    const plan = buildRenderPlan(baseState(), {
      assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4',
      resolutionOverride: { width: 640, height: 360 }, crf: 22,
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('s=640x360'), filterStr);
    assert.ok(!filterStr.includes('s=1920x1080'), filterStr);
    const crfIdx = plan.args.indexOf('-crf');
    assert.strictEqual(plan.args[crfIdx + 1], '22');
  });

  check('08-G G3: no clip.crop at all -> no crop= filter step, byte-identical to pre-crop output', () => {
    const plan = buildRenderPlan(baseState(), { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('crop='));
  });

  check('08-G G3: identity clip.crop ({x:0,y:0,width:1,height:1}) -> no crop= filter step either', () => {
    const state = baseState();
    state.tracks[0].clips[0].crop = { x: 0, y: 0, width: 1, height: 1 };
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('crop='));
  });

  check('08-G G3: a real crop emits crop=w=in_w*W:h=in_h*H:x=in_w*X:y=in_h*Y BEFORE scale=', () => {
    const state = baseState();
    state.tracks[0].clips[0].crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.6 };
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('crop=w=in_w*0.5:h=in_h*0.6:x=in_w*0.25:y=in_h*0.1'), filterStr);
    assert.ok(filterStr.indexOf('crop=') < filterStr.indexOf('scale='), 'crop must come before scale in the filter chain');
  });

  check('08-G G3 ADR 0035: default pivot (0.5/0.5, center) -> byte-identical to pre-pivot rotate= output, no pad=/crop= steps', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.rotation = 45;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes(`rotate=${(45 * Math.PI) / 180}:fillcolor=black@0:ow=rotw(`), filterStr);
    assert.ok(!filterStr.includes('pad='), filterStr);
  });

  check('08-G G3 ADR 0035: an off-center pivot emits pad=/rotate=(fixed size)/crop= instead of rotw()/roth() expansion', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.rotation = 45;
    state.tracks[0].clips[0].transform.pivotX = 0;
    state.tracks[0].clips[0].transform.pivotY = 0;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('pad=w='), filterStr);
    assert.ok(!filterStr.includes('rotw('), filterStr);
    assert.ok(filterStr.indexOf('pad=') < filterStr.indexOf('rotate='), 'pad must come before rotate');
    assert.ok(filterStr.indexOf('rotate=') < filterStr.lastIndexOf('crop='), 'rotate must come before the pivot crop-back (crop= also used earlier by G3 crop/mask when present, hence lastIndexOf)');
  });

  check('08-G G3 ADR 0035: off-center pivot with rotation=0 -> no rotate=/pad=/pivot-crop steps at all (nothing to rotate)', () => {
    const state = baseState();
    state.tracks[0].clips[0].transform.pivotX = 0.1;
    state.tracks[0].clips[0].transform.pivotY = 0.9;
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('rotate='), filterStr);
    assert.ok(!filterStr.includes('pad='), filterStr);
  });

  check('Phase 15: DISABLED normalize effect -> no loudnorm= step', () => {
    const state = baseState();
    state.tracks[1].clips.push({
      id: 'aclip-1', assetId: 'asset-2', sourceInMs: 0, sourceOutMs: 3000, timelineInMs: 0, timelineOutMs: 3000, speed: 1, volume: 1,
      effects: [{ id: 'fx1', type: 'normalize', enabled: false, order: 0, params: {} }], keyframes: [],
    });
    const plan = buildRenderPlan(state, { assetPaths: { 'asset-1': '/media/a.mp4', 'asset-2': '/media/b.mp3' }, outputPath: '/out.mp4' });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(!filterStr.includes('loudnorm'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
