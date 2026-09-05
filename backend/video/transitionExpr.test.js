// 08-H H4 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md): "Còn lại"
// note — transition/xfade timing vector riêng cho renderPlanner's xfade offset math. Same spirit as
// keyframeExpr.test.js's parity vectors: the renderer's own filter-string output is checked against
// an INDEPENDENT closed-form recomputation from raw clip data, not a replay of buildTrackLayer's own
// running-durationSec fold/accumulator (backend/video/renderPlanner.js, ~line 559-580). Structural
// only, no ffmpeg involved — that's backend/video/__tests__/golden/render.test.js's job.
// Run with: node backend/video/transitionExpr.test.js

const assert = require('assert');
const { buildRenderPlan } = require('./renderPlanner');

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

function baseState(clips, transitions) {
  return {
    schemaVersion: 1,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    colorSpace: 'sRGB',
    audioRate: 48000,
    sequence: { markers: [] },
    tracks: [
      { id: 'track-v1', type: 'video', order: 0, locked: false, muted: false, visible: true, clips },
      { id: 'track-a1', type: 'audio', order: 1, locked: false, muted: false, visible: true, clips: [] },
    ],
    transitions,
  };
}

function mkClip(id, assetId, timelineInMs, timelineOutMs) {
  return {
    id,
    assetId,
    sourceInMs: 0,
    sourceOutMs: timelineOutMs - timelineInMs,
    timelineInMs,
    timelineOutMs,
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
  };
}

// closedFormXfade(clips, transitions) -> { offsets: [{offsetSec, xfadeDurationSec}], totalDurationSec }
// An independent derivation from raw timelineIn/OutMs + transition durationMs — not a copy of
// buildTrackLayer's internal fold. Clips assumed sorted by timelineInMs on one track, no overlaps
// (same assumption renderPlanner itself makes). Rebuilds the gap-then-clip segment list from first
// principles: a gap exists whenever the next clip's timelineInMs is later than the running
// end-of-track position — independent of clipsWithGaps()'s own implementation.
function closedFormSegmentsSec(clips) {
  const segments = [];
  let trackEndMs = 0;
  clips.forEach((clip) => {
    if (clip.timelineInMs > trackEndMs) {
      segments.push({ clipId: null, durationSec: (clip.timelineInMs - trackEndMs) / 1000 });
    }
    segments.push({ clipId: clip.id, durationSec: (clip.timelineOutMs - clip.timelineInMs) / 1000 });
    trackEndMs = clip.timelineOutMs;
  });
  return segments;
}

function closedFormXfade(clips, transitions) {
  const segments = closedFormSegmentsSec(clips);
  const transitionAt = (fromId, toId) => transitions.find((t) => t.fromClipId === fromId && t.toClipId === toId);
  let runningSec = segments[0].durationSec;
  const offsets = []; // left-to-right order, one entry per join that actually has a transition
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    const transition = prev.clipId && cur.clipId ? transitionAt(prev.clipId, cur.clipId) : undefined;
    if (transition) {
      const xfadeDurationSec = transition.durationMs / 1000;
      offsets.push({ offsetSec: runningSec - xfadeDurationSec, xfadeDurationSec });
      runningSec += cur.durationSec - xfadeDurationSec;
    } else {
      runningSec += cur.durationSec;
    }
  }
  return { offsets, totalDurationSec: runningSec };
}

function extractXfadeOccurrences(filterStr) {
  const re = /xfade=transition=fade:duration=([\d.]+):offset=(-?[\d.]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(filterStr))) {
    out.push({ durationSec: Number(m[1]), offsetSec: Number(m[2]) });
  }
  return out;
}

function assertOffsetsMatch(actual, expected, label) {
  assert.strictEqual(actual.length, expected.offsets.length, `${label}: expected ${expected.offsets.length} xfade join(s), got ${actual.length}`);
  actual.forEach((a, i) => {
    assert.ok(
      Math.abs(a.offsetSec - expected.offsets[i].offsetSec) <= TOLERANCE,
      `${label}: join ${i} offset — actual=${a.offsetSec}, expected=${expected.offsets[i].offsetSec}`,
    );
  });
}

const TOLERANCE = 0.001; // closed-form arithmetic match, not curve sampling — 2%-style slack doesn't apply here

function main() {
  check('2 clips, 1 transition: xfade offset matches independent closed form across several transition durations', () => {
    [200, 500, 2000].forEach((transitionMs) => {
      const clips = [mkClip('c1', 'a1', 0, 5000), mkClip('c2', 'a2', 5000, 8000)];
      const transitions = [{ id: 't1', fromClipId: 'c1', toClipId: 'c2', durationMs: transitionMs, params: {} }];
      const plan = buildRenderPlan(baseState(clips, transitions), {
        assetPaths: { a1: '/media/a.mp4', a2: '/media/b.mp4' },
        outputPath: '/out.mp4',
      });
      const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
      const actual = extractXfadeOccurrences(filterStr);
      const expected = closedFormXfade(clips, transitions);
      assertOffsetsMatch(actual, expected, `transitionMs=${transitionMs}`);
      assert.ok(
        Math.abs(plan.totalDurationMs / 1000 - expected.totalDurationSec) <= TOLERANCE,
        `transitionMs=${transitionMs}: totalDuration actual=${plan.totalDurationMs / 1000} expected=${expected.totalDurationSec}`,
      );
    });
  });

  check('3 clips, transition on only the 2nd join: offset matches closed form', () => {
    const clips = [mkClip('c1', 'a1', 0, 5000), mkClip('c2', 'a2', 5000, 8000), mkClip('c3', 'a3', 8000, 10000)];
    const transitions = [{ id: 't1', fromClipId: 'c2', toClipId: 'c3', durationMs: 1000, params: {} }];
    const plan = buildRenderPlan(baseState(clips, transitions), {
      assetPaths: { a1: '/media/a.mp4', a2: '/media/b.mp4', a3: '/media/c.mp4' },
      outputPath: '/out.mp4',
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const actual = extractXfadeOccurrences(filterStr);
    const expected = closedFormXfade(clips, transitions);
    assertOffsetsMatch(actual, expected, 'single mid-chain transition');
    assert.ok(Math.abs(plan.totalDurationMs / 1000 - expected.totalDurationSec) <= TOLERANCE);
  });

  check('3 clips, transitions on BOTH joins (chained xfade): each offset independently matches closed form — compounding shrink not miscalculated', () => {
    const clips = [mkClip('c1', 'a1', 0, 5000), mkClip('c2', 'a2', 5000, 8000), mkClip('c3', 'a3', 8000, 12000)];
    const transitions = [
      { id: 't1', fromClipId: 'c1', toClipId: 'c2', durationMs: 500, params: {} },
      { id: 't2', fromClipId: 'c2', toClipId: 'c3', durationMs: 800, params: {} },
    ];
    const plan = buildRenderPlan(baseState(clips, transitions), {
      assetPaths: { a1: '/media/a.mp4', a2: '/media/b.mp4', a3: '/media/c.mp4' },
      outputPath: '/out.mp4',
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    const actual = extractXfadeOccurrences(filterStr);
    const expected = closedFormXfade(clips, transitions);
    assertOffsetsMatch(actual, expected, 'chained double transition');
    assert.ok(
      Math.abs(plan.totalDurationMs / 1000 - expected.totalDurationSec) <= TOLERANCE,
      `totalDuration actual=${plan.totalDurationMs / 1000} expected=${expected.totalDurationSec}`,
    );
  });

  check('gap + transition on the same track: a real gap before a transitioned pair does not perturb the xfade offset math', () => {
    // clip1 0-2000, GAP 2000-5000, clip2 5000-8000, transition clip2->clip3, clip3 8000-11000
    const clips = [mkClip('c1', 'a1', 0, 2000), mkClip('c2', 'a2', 5000, 8000), mkClip('c3', 'a3', 8000, 11000)];
    const transitions = [{ id: 't1', fromClipId: 'c2', toClipId: 'c3', durationMs: 600, params: {} }];
    const plan = buildRenderPlan(baseState(clips, transitions), {
      assetPaths: { a1: '/media/a.mp4', a2: '/media/b.mp4', a3: '/media/c.mp4' },
      outputPath: '/out.mp4',
    });
    const filterStr = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.ok(filterStr.includes('color=c=black'), 'the gap must still be filled with a real gap segment');
    const actual = extractXfadeOccurrences(filterStr);
    const expected = closedFormXfade(clips, transitions);
    assertOffsetsMatch(actual, expected, 'gap + transition composition');
    assert.ok(
      Math.abs(plan.totalDurationMs / 1000 - expected.totalDurationSec) <= TOLERANCE,
      `totalDuration actual=${plan.totalDurationMs / 1000} expected=${expected.totalDurationSec}`,
    );
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
