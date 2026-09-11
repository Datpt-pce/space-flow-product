const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runVideoJob } = require('../agent/videoJobs');
const root = path.resolve(__dirname, '../../logs/sticker-blend-proof');
fs.mkdirSync(root, { recursive: true });
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'buffer' });
const clip = (id, assetId, start, end, extra = {}) => ({ id, assetId, sourceInMs: 0, sourceOutMs: end - start, timelineInMs: start, timelineOutMs: end, speed: 1, effects: [], keyframes: [], transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, ...extra });
const pixel = (file, t, x, y) => [...ff(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=4:4:${x}:${y}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']).subarray(0, 3)];
(async () => {
  const base = path.join(root, 'base.mp4'), sticker = path.join(root, 'sticker.png');
  ff(['-f', 'lavfi', '-i', 'color=c=0x808080:s=160x160:d=3:r=24', '-pix_fmt', 'yuv420p', base]);
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=80x80:d=1', '-frames:v', '1', sticker]);
  for (const mode of ['multiply', 'screen', 'overlay', 'darken', 'lighten']) {
    const output = path.join(root, `${mode}.mp4`);
    const state = { schemaVersion: 1, resolution: { width: 160, height: 160 }, fps: 24, audioRate: 48000, sequence: { markers: [] }, transitions: [], tracks: [
      { id: 'v', type: 'video', visible: true, muted: true, order: 0, clips: [clip('v', 'base', 0, 3000)] },
      { id: 's', type: 'sticker', visible: true, order: 1, clips: [clip('s', 'sticker', 1000, 2000, { transform: { x: 0, y: 0, scaleX: .5, scaleY: .5, rotation: 0, opacity: 1 }, effects: [{ id: 'e', type: 'blendMode', enabled: true, params: { mode } }] })] },
    ] };
    await runVideoJob('render', { projectState: state, rawAssetPaths: { base, sticker }, rawAssetKinds: { base: 'video', sticker: 'image' }, outputPath: output }, () => {});
    for (const t of [.5, 2.5]) assert.ok(pixel(output, t, 80, 80).every(v => Math.abs(v - 128) < 12), `${mode}: sparse timing ${t}`);
    assert.ok(pixel(output, 1.5, 4, 4).every(v => Math.abs(v - 128) < 12), `${mode}: transparent margin`);
    const actual = pixel(output, 1.5, 80, 80);
    const expected = { multiply: [128, 0, 0], screen: [255, 128, 128], overlay: [255, 0, 0], darken: [128, 0, 0], lighten: [255, 128, 128] }[mode];
    assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 15), `${mode}: pixel ${actual}, expected ${expected}`);
    console.log(`PASS ${mode}: blend color, alpha margin, sparse timing`);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
