// 08-H H4 (specs/ai-creative-operations-platform/08-v2/08-h-preview-and-render-parity.md):
// "Shared transform/keyframe/easing/transition test vectors" — buildFfmpegTimeExpr() is the
// renderer's OWN reconstruction of an animated property as a piecewise-linear ffmpeg expression
// (a second implementation of the curve, distinct from shared/video-keyframes.js's
// interpolateAtTime(), which preview/canvasEngine.js reads directly). This file has 2 kinds of
// test vectors:
//   1. structural — buildFfmpegTimeExpr()'s own edge cases (empty/single-point/zero-span/negative/
//      long-decimal), independent of any real keyframe data.
//   2. parity — for every easing curve this app supports, sample the SAME way
//      renderPlanner.js's real render path does (sampleAnimatedTimesMs()) and confirm the emitted
//      ffmpeg expression, evaluated at a fine time grid, stays within tolerance of
//      interpolateAtTime()'s own canonical value at that same instant — the actual preview/export
//      drift risk this work package exists to bound. Evaluated via evalFfmpegExpr() below, a
//      minimal parser for the EXACT `if(lt(...),...)`/chord shape buildFfmpegTimeExpr() emits (not
//      a general ffmpeg expression parser) — deliberately not `eval`/`Function` even though the
//      input is always internally-generated, to keep this test free of eval-like patterns.
// Run with: node backend/video/keyframeExpr.test.js

const assert = require('assert');
const { buildFfmpegTimeExpr } = require('./keyframeExpr');
const { sampleAnimatedTimesMs } = require('./renderPlanner');
const { keyframesForProperty, interpolateAtTime } = require('../../shared/video-keyframes');

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

// evalFfmpegExpr(exprStr, timeVar, tVal) -> number. Parses exactly the shape buildFfmpegTimeExpr()
// emits: nested `if(lt(timeVar,N),THEN,ELSE)` (commas escaped as `\,`), leaves are either a plain
// number, the bare timeVar, or the `(A+(B-A)*(timeVar-C)/D)` chord formula.
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function evalLeaf(segment, timeVar, tVal) {
  if (segment === timeVar) return tVal;
  if (/^-?\d+(\.\d+)?$/.test(segment)) return Number(segment);
  const chordRe = new RegExp(`^\\(([-\\d.]+)\\+\\(([-\\d.]+)-([-\\d.]+)\\)\\*\\(${timeVar}-([-\\d.]+)\\)\\/([-\\d.]+)\\)$`);
  const m = segment.match(chordRe);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[4]);
    const d = Number(m[5]);
    return a + ((b - a) * (tVal - c)) / d;
  }
  throw new Error(`evalFfmpegExpr: unrecognized leaf shape "${segment}"`);
}

function evalFfmpegExpr(exprStr, timeVar, tVal) {
  function evalNode(s) {
    const trimmed = s.trim();
    if (trimmed.startsWith('if(') && trimmed.endsWith(')')) {
      const [condStr, thenStr, elseStr] = splitTopLevel(trimmed.slice(3, -1));
      const ltMatch = condStr.match(/^lt\((.+)\)$/);
      const [aStr, bStr] = splitTopLevel(ltMatch[1]);
      return evalNode(aStr) < evalNode(bStr) ? evalNode(thenStr) : evalNode(elseStr);
    }
    return evalLeaf(trimmed, timeVar, tVal);
  }
  return evalNode(exprStr.replace(/\\,/g, ','));
}

function main() {
  // --- 1. Structural edge cases ---
  check('empty points -> null', () => {
    assert.strictEqual(buildFfmpegTimeExpr([], 't'), null);
  });

  check('single point -> a plain formatted number, no if/lt at all', () => {
    const expr = buildFfmpegTimeExpr([{ timeSec: 0, value: 42 }], 't');
    assert.strictEqual(expr, '42');
  });

  check('2 points -> held-before, chord, held-after, evaluates exactly at both knots and midpoint', () => {
    const points = [{ timeSec: 0, value: 0 }, { timeSec: 2, value: 100 }];
    const expr = buildFfmpegTimeExpr(points, 't');
    assert.strictEqual(evalFfmpegExpr(expr, 't', -1), 0, 'before first point holds first value');
    assert.strictEqual(evalFfmpegExpr(expr, 't', 0), 0);
    assert.strictEqual(evalFfmpegExpr(expr, 't', 1), 50, 'linear midpoint');
    assert.strictEqual(evalFfmpegExpr(expr, 't', 2), 100);
    assert.strictEqual(evalFfmpegExpr(expr, 't', 5), 100, 'after last point holds last value');
  });

  check('zero-span segment (2 points at the same timeSec) -> held at the later value, no divide-by-zero', () => {
    const points = [{ timeSec: 1, value: 10 }, { timeSec: 1, value: 20 }, { timeSec: 3, value: 30 }];
    const expr = buildFfmpegTimeExpr(points, 't');
    assert.ok(!expr.includes('/0'), `must never emit a literal /0, got: ${expr}`);
    assert.strictEqual(evalFfmpegExpr(expr, 't', 1), 20, 'at the exact zero-span instant, the LATER keyframe wins');
  });

  check('uppercase T timeVar (geq/opacity) produces a T-based expression, independent of lowercase t', () => {
    const points = [{ timeSec: 0, value: 0 }, { timeSec: 1, value: 1 }];
    const expr = buildFfmpegTimeExpr(points, 'T');
    assert.ok(expr.includes('lt(T\\,'), `expected the T variable in the expression, got: ${expr}`);
    assert.strictEqual(evalFfmpegExpr(expr, 'T', 0.5), 0.5);
  });

  check('long-decimal / negative values are formatted to <=6 decimals, no scientific notation', () => {
    const points = [{ timeSec: 0, value: 0.1 + 0.2 }, { timeSec: 1, value: -1000000 }]; // 0.1+0.2 float noise
    const expr = buildFfmpegTimeExpr(points, 't');
    assert.ok(!/e[-+]/i.test(expr), `must never contain scientific notation, got: ${expr}`);
    assert.ok(expr.includes('0.3'), `float noise must be rounded away, got: ${expr}`);
  });

  check('every comma in the expression is escaped as \\, (filtergraph-level separator safety)', () => {
    const points = [{ timeSec: 0, value: 0 }, { timeSec: 1, value: 1 }, { timeSec: 2, value: 2 }];
    const expr = buildFfmpegTimeExpr(points, 't');
    assert.ok(!/[^\\],/.test(expr), `found an unescaped comma in: ${expr}`);
  });

  // --- 2. Parity vectors: renderer's ffmpeg reconstruction vs the canonical evaluator, per easing ---
  const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
  // Empirically bounded for granted: all 4 curves are quadratic (max curvature 2, see
  // shared/video-easing.js), 6 samples/segment (renderPlanner.js's own default) over a unit
  // interval -> worst-case chord/curve deviation is w^2*|f''|/8 with w=1/6, well under 1% of the
  // value range — 2% is a deliberately generous, documented starting tolerance, not a tuned
  // pixel-accuracy budget (that belongs to H8's real-ffmpeg golden suite, out of scope here).
  const TOLERANCE_FRACTION = 0.02;

  EASINGS.forEach((easing) => {
    check(`parity — "${easing}": ffmpeg-reconstructed expr tracks interpolateAtTime() within ${TOLERANCE_FRACTION * 100}% of the value range across the whole segment`, () => {
      const clip = {
        keyframes: [
          { propertyPath: 'transform.x', timeMs: 0, value: 0, easing },
          { propertyPath: 'transform.x', timeMs: 1000, value: 200, easing: 'linear' },
        ],
      };
      const kfs = keyframesForProperty(clip, 'transform.x');
      const sampleTimesMs = sampleAnimatedTimesMs(clip, ['x']);
      if (easing !== 'linear') {
        assert.ok(sampleTimesMs.length > 2, 'a non-linear easing must produce interior samples, not just the 2 knots');
      }
      const points = sampleTimesMs.map((timeMs) => ({
        timeSec: timeMs / 1000,
        value: interpolateAtTime(kfs, timeMs),
      }));
      const expr = buildFfmpegTimeExpr(points, 't');
      const valueRange = 200;
      const toleranceAbs = valueRange * TOLERANCE_FRACTION;
      for (let ms = 0; ms <= 1000; ms += 25) {
        const truth = interpolateAtTime(kfs, ms);
        const reconstructed = evalFfmpegExpr(expr, 't', ms / 1000);
        assert.ok(
          Math.abs(truth - reconstructed) <= toleranceAbs,
          `at t=${ms}ms: truth=${truth}, ffmpeg-reconstructed=${reconstructed}, diff exceeds ${toleranceAbs}`,
        );
      }
    });
  });

  check('parity — near-exact match at every knot returned by sampleAnimatedTimesMs (by construction, only formatNum\'s own 6-decimal rounding as slack)', () => {
    const clip = {
      keyframes: [
        { propertyPath: 'transform.opacity', timeMs: 0, value: 0, easing: 'ease-in-out' },
        { propertyPath: 'transform.opacity', timeMs: 500, value: 1, easing: 'ease-out' },
        { propertyPath: 'transform.opacity', timeMs: 1000, value: 0.2, easing: 'linear' },
      ],
    };
    const kfs = keyframesForProperty(clip, 'transform.opacity');
    const sampleTimesMs = sampleAnimatedTimesMs(clip, ['opacity']);
    const points = sampleTimesMs.map((timeMs) => ({ timeSec: timeMs / 1000, value: interpolateAtTime(kfs, timeMs) }));
    const expr = buildFfmpegTimeExpr(points, 'T');
    sampleTimesMs.forEach((timeMs) => {
      const truth = interpolateAtTime(kfs, timeMs);
      const reconstructed = evalFfmpegExpr(expr, 'T', timeMs / 1000);
      assert.ok(Math.abs(truth - reconstructed) < 1e-4, `knot at t=${timeMs}ms must match within formatNum's own rounding slack: truth=${truth}, got=${reconstructed}`);
    });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
