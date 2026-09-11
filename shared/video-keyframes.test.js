// Video Editor Phase 7 (specs/space-flow-master-plan/04-video-editor.md §5): pure-logic tests for
// shared/video-keyframes.js. Run with: node shared/video-keyframes.test.js

const assert = require('assert');
const { interpolateAtTime, evaluateClipTransform, isPropertyAnimated } = require('./video-keyframes');

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

function baseClip() {
  return {
    id: 'clip-1', assetId: 'asset-1', sourceInMs: 0, sourceOutMs: 5000,
    timelineInMs: 0, timelineOutMs: 5000, speed: 1,
    transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [], keyframes: [],
  };
}

function main() {
  // ---- interpolateAtTime ----
  check('interpolateAtTime: empty keyframes -> undefined (caller falls back to static default)', () => {
    assert.strictEqual(interpolateAtTime([], 1000), undefined);
  });

  check('interpolateAtTime: single keyframe -> constant at every time', () => {
    const kfs = [{ timeMs: 1000, value: 5, easing: 'linear' }];
    assert.strictEqual(interpolateAtTime(kfs, 0), 5);
    assert.strictEqual(interpolateAtTime(kfs, 1000), 5);
    assert.strictEqual(interpolateAtTime(kfs, 9999), 5);
  });

  check('interpolateAtTime: before first / after last keyframe -> held at the edge value', () => {
    const kfs = [{ timeMs: 1000, value: 0, easing: 'linear' }, { timeMs: 2000, value: 100, easing: 'linear' }];
    assert.strictEqual(interpolateAtTime(kfs, 0), 0);
    assert.strictEqual(interpolateAtTime(kfs, 3000), 100);
  });

  check('interpolateAtTime: linear midpoint between 2 keyframes', () => {
    const kfs = [{ timeMs: 1000, value: 0, easing: 'linear' }, { timeMs: 2000, value: 100, easing: 'linear' }];
    assert.strictEqual(interpolateAtTime(kfs, 1500), 50);
  });

  check('interpolateAtTime: 3 keyframes, picks the right segment', () => {
    const kfs = [
      { timeMs: 0, value: 0, easing: 'linear' },
      { timeMs: 1000, value: 100, easing: 'linear' },
      { timeMs: 2000, value: 0, easing: 'linear' },
    ];
    assert.strictEqual(interpolateAtTime(kfs, 500), 50); // first segment
    assert.strictEqual(interpolateAtTime(kfs, 1500), 50); // second segment
  });

  check('interpolateAtTime: easing on the STARTING keyframe controls the segment (ease-in slower at start)', () => {
    const kfs = [{ timeMs: 0, value: 0, easing: 'ease-in' }, { timeMs: 1000, value: 100, easing: 'linear' }];
    assert.ok(interpolateAtTime(kfs, 500) < 50); // ease-in: slower than linear at the midpoint
  });

  check('interpolateAtTime: hold easing steps instead of interpolating — stays at the starting value, jumps only at the ending keyframe\'s own time', () => {
    const kfs = [{ timeMs: 0, value: 0, easing: 'hold' }, { timeMs: 1000, value: 100, easing: 'linear' }];
    assert.strictEqual(interpolateAtTime(kfs, 0), 0);
    assert.strictEqual(interpolateAtTime(kfs, 500), 0);
    assert.strictEqual(interpolateAtTime(kfs, 999), 0);
    assert.strictEqual(interpolateAtTime(kfs, 1000), 100);
  });

  check('interpolateAtTime: easing:"custom" reads the STARTING keyframe\'s own easingX1/Y1/X2/Y2 bezier control points (ADR 0036)', () => {
    const kfs = [
      { timeMs: 0, value: 0, easing: 'custom', easingX1: 0, easingY1: 0, easingX2: 1, easingY2: 1 }, // straight diagonal -> ~linear
      { timeMs: 1000, value: 100, easing: 'linear' },
    ];
    assert.ok(Math.abs(interpolateAtTime(kfs, 500) - 50) < 0.01);
  });

  check('interpolateAtTime: unsorted input still works (function does not assume pre-sort by caller)', () => {
    // Deliberately reversed order — keyframesForProperty() sorts before calling this, but this
    // function's own bounds-check logic (timeMs<=first/timeMs>=last) depends on `keyframes[0]`
    // truly being the earliest, so this documents that contract rather than silently working by luck.
    const kfs = [{ timeMs: 1000, value: 100, easing: 'linear' }, { timeMs: 0, value: 0, easing: 'linear' }];
    // Interpreted literally (first entry = kfs[0] = timeMs:1000) — NOT sorted by this function.
    assert.strictEqual(interpolateAtTime(kfs, 0), 100); // "before first" per kfs[0], not per real chronology
  });

  // ---- evaluateClipTransform ----
  check('evaluateClipTransform: no keyframes at all -> exactly the static clip.transform (passthrough)', () => {
    const clip = baseClip();
    // pivotX/pivotY (08-G G3 rotation pivot, ADR 0035) aren't in baseClip()'s own transform object,
    // so they come back at their TRANSFORM_DEFAULTS (0.5/0.5, center) — this test's expected object
    // was never updated when ADR 0035 added them, a stale regression unrelated to and predating
    // this hold-easing pass, caught by simply running this file again.
    assert.deepStrictEqual(evaluateClipTransform(clip, 2500), { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, pivotX: 0.5, pivotY: 0.5 });
  });

  check('evaluateClipTransform: only opacity keyframed -> other 5 properties stay static', () => {
    const clip = baseClip();
    clip.keyframes = [
      { id: 'k1', propertyPath: 'transform.opacity', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k2', propertyPath: 'transform.opacity', timeMs: 5000, value: 1, easing: 'linear' },
    ];
    const at2500 = evaluateClipTransform(clip, 2500);
    assert.strictEqual(at2500.opacity, 0.5);
    assert.strictEqual(at2500.x, 10); // untouched, static
    assert.strictEqual(at2500.y, 20); // untouched, static
  });

  check('evaluateClipTransform: 2 independently-animated properties do not interfere', () => {
    const clip = baseClip();
    clip.keyframes = [
      { id: 'k1', propertyPath: 'transform.x', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k2', propertyPath: 'transform.x', timeMs: 1000, value: 100, easing: 'linear' },
      { id: 'k3', propertyPath: 'transform.rotation', timeMs: 0, value: 0, easing: 'linear' },
      { id: 'k4', propertyPath: 'transform.rotation', timeMs: 1000, value: 90, easing: 'linear' },
    ];
    const at500 = evaluateClipTransform(clip, 500);
    assert.strictEqual(at500.x, 50);
    assert.strictEqual(at500.rotation, 45);
    assert.strictEqual(at500.scaleX, 1); // untouched
  });

  check('evaluateClipTransform: missing clip.transform entirely -> falls back to defaults', () => {
    const clip = { ...baseClip(), transform: undefined };
    const result = evaluateClipTransform(clip, 0);
    assert.strictEqual(result.scaleX, 1);
    assert.strictEqual(result.opacity, 1);
  });

  check('isPropertyAnimated: true only for a property with at least 1 keyframe', () => {
    const clip = baseClip();
    clip.keyframes = [{ id: 'k1', propertyPath: 'transform.opacity', timeMs: 0, value: 1, easing: 'linear' }];
    assert.strictEqual(isPropertyAnimated(clip, 'opacity'), true);
    assert.strictEqual(isPropertyAnimated(clip, 'x'), false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
