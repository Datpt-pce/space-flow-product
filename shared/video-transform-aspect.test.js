const assert = require('node:assert/strict');
const { computeCanvasPlacement } = require('./video-transform');
for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
  for (const source of [{ width: 900, height: 1600 }, { width: 1600, height: 900 }, { width: 800, height: 800 }]) {
    const box = computeCanvasPlacement({}, canvas, source);
    assert.ok(Math.abs(box.destWidth / box.destHeight - source.width / source.height) < 0.003);
    assert.ok(box.destWidth <= canvas.width && box.destHeight <= canvas.height);
    assert.ok(Math.abs(box.destX * 2 + box.destWidth - canvas.width) <= 1);
    assert.ok(Math.abs(box.destY * 2 + box.destHeight - canvas.height) <= 1);
  }
}
const crop = computeCanvasPlacement({}, { width: 1920, height: 1080 }, { width: 1600, height: 900 }, { width: 0.5, height: 1 });
assert.ok(Math.abs(crop.destWidth / crop.destHeight - 800 / 900) < 0.002);
const scaled = computeCanvasPlacement({ scaleX: 0.5, scaleY: 0.5, x: 30 }, { width: 1920, height: 1080 }, { width: 900, height: 1600 });
assert.equal(scaled.destHeight, 540);
assert.ok(Math.abs(scaled.destWidth / scaled.destHeight - 900 / 1600) < 0.003);
assert.equal(scaled.destX, Math.round((1920 - scaled.destWidth) / 2) + 30);
console.log('Aspect placement: 9 canvas/source combinations, crop, scale and centering PASS');
