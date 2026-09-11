// Video Editor Phase 7 (specs/space-flow-master-plan/04-video-editor.md §5): pure-logic tests for
// applyEasing(). Run with: node shared/video-easing.test.js

const assert = require('assert');
const { applyEasing } = require('./video-easing');

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

function main() {
  for (const name of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']) {
    check(`${name}: endpoints are exact — applyEasing(name,0)=0, applyEasing(name,1)=1`, () => {
      assert.strictEqual(applyEasing(name, 0), 0);
      assert.strictEqual(applyEasing(name, 1), 1);
    });
  }

  check('hold: a step function — 0 everywhere strictly before t=1, only 1 exactly AT t=1 (the "value stays put, then jumps" NLE behavior)', () => {
    assert.strictEqual(applyEasing('hold', 0), 0);
    assert.strictEqual(applyEasing('hold', 0.25), 0);
    assert.strictEqual(applyEasing('hold', 0.5), 0);
    assert.strictEqual(applyEasing('hold', 0.999), 0);
    assert.strictEqual(applyEasing('hold', 1), 1);
  });

  check('linear: t=0.5 -> 0.5 exactly', () => {
    assert.strictEqual(applyEasing('linear', 0.5), 0.5);
  });

  check('ease-in: slower at the start than linear (eased(0.5) < 0.5)', () => {
    assert.ok(applyEasing('ease-in', 0.5) < 0.5);
  });

  check('ease-out: faster at the start than linear (eased(0.5) > 0.5)', () => {
    assert.ok(applyEasing('ease-out', 0.5) > 0.5);
  });

  check('ease-in-out: symmetric around t=0.5 -> exactly 0.5', () => {
    assert.strictEqual(applyEasing('ease-in-out', 0.5), 0.5);
  });

  check('unknown/missing easing name falls back to linear, does not throw', () => {
    assert.strictEqual(applyEasing('bezier-nonexistent', 0.5), 0.5);
    assert.strictEqual(applyEasing(undefined, 0.25), 0.25);
  });

  check('out-of-range t is clamped to [0,1]', () => {
    assert.strictEqual(applyEasing('linear', -0.5), 0);
    assert.strictEqual(applyEasing('linear', 1.5), 1);
  });

  // ---- ADR 0036: custom cubic-bezier easing ----
  check('custom bezier: endpoints are exact regardless of control points', () => {
    const custom = { name: 'custom', x1: 0.17, y1: 0.67, x2: 0.83, y2: 0.67 }; // CSS "ease-in-out" quintic-ish preset, arbitrary real-world values
    assert.strictEqual(applyEasing(custom, 0), 0);
    assert.strictEqual(applyEasing(custom, 1), 1);
  });

  check('custom bezier: a symmetric S-curve (CSS "ease" preset values) is close to but not exactly linear at the midpoint', () => {
    // CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1.0) — a well-known reference curve.
    const cssEase = { name: 'custom', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
    const mid = applyEasing(cssEase, 0.5);
    assert.ok(mid > 0.5 && mid < 1, `expected CSS ease's midpoint to be past halfway (fast start, slow end), got ${mid}`);
  });

  check('custom bezier: a straight-diagonal control (0,0)-(1,1) reproduces linear exactly', () => {
    const straight = { name: 'custom', x1: 0, y1: 0, x2: 1, y2: 1 };
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      assert.ok(Math.abs(applyEasing(straight, t) - t) < 1e-6, `t=${t}: expected ~${t}, got ${applyEasing(straight, t)}`);
    }
  });

  check('custom bezier: Y control points beyond [0,1] produce overshoot (value > 1 mid-curve)', () => {
    const overshoot = { name: 'custom', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
    let maxVal = 0;
    for (let t = 0; t <= 1; t += 0.05) maxVal = Math.max(maxVal, applyEasing(overshoot, t));
    assert.ok(maxVal > 1, `expected an overshoot curve to exceed 1 somewhere, max was ${maxVal}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
