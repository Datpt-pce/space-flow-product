// Video Editor Phase 5 (specs/space-flow-master-plan/04-video-editor.md §5): pure-logic tests for
// computeCanvasPlacement() — the single source of truth backend/video/renderPlanner.js and the
// frontend Canvas preview spike both derive their own placement math from.
// Run with: node shared/video-transform.test.js

const assert = require('assert');
const { computeCanvasPlacement } = require('./video-transform');

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

const RESOLUTION = { width: 1920, height: 1080 };

function main() {
  check('default transform (scale=1, no position/rotation) -> fills the whole canvas exactly, centered at 0,0', () => {
    const p = computeCanvasPlacement({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, RESOLUTION);
    assert.deepStrictEqual(p, { destWidth: 1920, destHeight: 1080, destX: 0, destY: 0, opacity: 1, rotationDeg: 0, rotationRadians: 0 });
  });

  check('missing/undefined transform -> same defaults as an explicit identity transform', () => {
    const p = computeCanvasPlacement(undefined, RESOLUTION);
    assert.strictEqual(p.destWidth, 1920);
    assert.strictEqual(p.destHeight, 1080);
    assert.strictEqual(p.destX, 0);
    assert.strictEqual(p.destY, 0);
    assert.strictEqual(p.opacity, 1);
  });

  check('scaleX/scaleY < 1 -> smaller content, still centered on the canvas', () => {
    const p = computeCanvasPlacement({ scaleX: 0.5, scaleY: 0.5, x: 0, y: 0 }, RESOLUTION);
    assert.strictEqual(p.destWidth, 960);
    assert.strictEqual(p.destHeight, 540);
    assert.strictEqual(p.destX, 480); // (1920-960)/2
    assert.strictEqual(p.destY, 270); // (1080-540)/2
  });

  check('x/y offset shifts the centered placement, does not replace it', () => {
    const p = computeCanvasPlacement({ scaleX: 0.5, scaleY: 0.5, x: 100, y: -50 }, RESOLUTION);
    assert.strictEqual(p.destX, 580); // 480 + 100
    assert.strictEqual(p.destY, 220); // 270 - 50
  });

  check('rotation converts degrees to radians correctly', () => {
    const p = computeCanvasPlacement({ rotation: 90 }, RESOLUTION);
    assert.strictEqual(p.rotationDeg, 90);
    assert.ok(Math.abs(p.rotationRadians - Math.PI / 2) < 1e-9);
  });

  check('opacity passes through unchanged, defaults to 1 when absent', () => {
    assert.strictEqual(computeCanvasPlacement({ opacity: 0.4 }, RESOLUTION).opacity, 0.4);
    assert.strictEqual(computeCanvasPlacement({}, RESOLUTION).opacity, 1);
  });

  check('destWidth/destHeight never round down to 0 or negative for a near-zero scale', () => {
    const p = computeCanvasPlacement({ scaleX: 0.0001, scaleY: 0.0001 }, RESOLUTION);
    assert.ok(p.destWidth >= 2 && p.destHeight >= 2);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
