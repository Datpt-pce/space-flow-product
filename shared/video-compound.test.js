const assert = require('node:assert/strict');
const { planCompoundUnpack, remapKeyframes } = require('./video-compound');
const { evaluateClipTransform } = require('./video-keyframes');
const command = require('./video-commands/UnpackCompoundClip');
let n = 0; const id = () => `new-${++n}`;
for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'custom', 'hold']) {
  const source = { timelineInMs: 0, timelineOutMs: 2000, keyframes: [
    { id: 'a', propertyPath: 'transform.x', timeMs: 0, value: 10, easing, easingX1: 0.2, easingY1: -0.5, easingX2: 0.7, easingY2: 1.5 },
    { id: 'b', propertyPath: 'transform.x', timeMs: 2000, value: 210, easing: 'linear' },
  ] };
  for (const speed of easing === 'hold' ? [0.5, 2] : [0.5, 2, -2]) {
    const keys = remapKeyframes(source, 200, 1800, speed, id);
    assert.ok(keys.every(k => k.timeMs >= 0 && k.timeMs <= 1600 / Math.abs(speed)), 'subdivision keeps keyframes within strict duration bounds');
    const clip = { keyframes: keys };
    for (let t = 0; t <= 1600 / Math.abs(speed); t += 5) {
      const originalTime = speed > 0 ? 200 + t * speed : 1800 + t * speed;
      assert.ok(Math.abs(evaluateClipTransform(clip, t).x - evaluateClipTransform(source, originalTime).x) < 0.00002, `${easing} at ${speed}x / ${t}`);
    }
  }
}
const resolution = { width: 320, height: 568 };
const base = { schemaVersion: 1, resolution, fps: 25, tracks: [], transitions: [] };
const nested = { ...base, tracks: [{ id: 'nested', type: 'video', order: 0, visible: true, muted: false, clips: [
  { id: 'left', assetId: 'a', sourceInMs: 100, sourceOutMs: 4100, timelineInMs: 0, timelineOutMs: 2000, speed: 2, keyframes: [], groupId: 'group' },
  { id: 'right', assetId: 'b', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 2000, timelineOutMs: 4000, speed: 1, keyframes: [], groupId: 'group' },
] }], transitions: [] };
const compound = { id: 'compound', assetId: 'rendered', compoundRef: { timelineProjectId: 'nested', pinnedSeq: 7 }, sourceInMs: 1000, sourceOutMs: 3000, timelineInMs: 5000, timelineOutMs: 6000, speed: 2 };
const parent = { ...base, tracks: [{ id: 'parent', type: 'video', order: 0, clips: [compound] }] };
const args = planCompoundUnpack(parent, 'parent', 'compound', nested, id);
assert.deepEqual(args.newTracks[0].clips.map(c => [c.timelineInMs, c.timelineOutMs, c.sourceInMs, c.sourceOutMs, c.speed]), [[5000, 5500, 2100, 4100, 4], [5500, 6000, 0, 1000, 2]]);
assert.deepEqual(args.newTransitions, []);
assert.notEqual(args.newTracks[0].clips[0].groupId, 'group');
assert.equal(args.newTracks[0].clips[0].groupId, args.newTracks[0].clips[1].groupId);
command.validate(parent, args);
assert.deepEqual(command.invert(command.apply(parent, args), args), parent);
const reversed = planCompoundUnpack({ ...parent, tracks: [{ ...parent.tracks[0], clips: [{ ...compound, speed: -2 }] }] }, 'parent', 'compound', nested, id);
assert.equal(reversed.newTracks[0].clips[0].assetId, 'b');
assert.equal(reversed.newTracks[0].clips[0].speed, -2);
assert.throws(() => planCompoundUnpack(parent, 'parent', 'compound', { ...nested, transitions: [{ id: 'transition', fromClipId: 'left', toClipId: 'right', type: 'fade', durationMs: 200 }] }, id), /chuyển cảnh/);
assert.throws(() => planCompoundUnpack({ ...parent, tracks: [...parent.tracks, { id: 'under', type: 'video', order: -1, clips: [{ timelineInMs: 0, timelineOutMs: 10000 }] }] }, 'parent', 'compound', nested, id), /bên dưới/);
assert.throws(() => planCompoundUnpack({ ...parent, tracks: [{ ...parent.tracks[0], clips: [{ ...compound, effects: [{ type: 'chromaKey' }] }] }] }, 'parent', 'compound', nested, id), /hiệu ứng/);
console.log('PASS compound trim/retime/reverse source mapping, exact cropped easing curves, transition/group identity and undo');
