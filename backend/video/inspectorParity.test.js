const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runVideoJob } = require('../agent/videoJobs');
const { MASK_DEFAULTS } = require('../../shared/video-mask');
const { TEXT_DEFAULTS, SHAPE_DEFAULTS, vectorSvg } = require('../../shared/video-vector');
const { Resvg } = require('@resvg/resvg-js');
const root = path.resolve(__dirname, '../../logs/inspector-parity-proof');
fs.mkdirSync(root, { recursive: true });
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const pixel = (file, x, y) => [...ff(['-ss', '0.4', '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']).subarray(0, 3)];
const clip = extra => ({ id: 'c', assetId: 'source', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: 0, timelineOutMs: 1000, speed: 1,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [], ...extra });
const state = clips => ({ schemaVersion: 1, resolution: { width: 640, height: 360 }, fps: 24, audioRate: 48000, transitions: [], sequence: { markers: [] },
  tracks: [{ id: 'v', type: 'video', order: 0, visible: true, muted: true, clips }] });
(async () => {
  const source = path.join(root, 'portrait.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=200x400:d=1:r=24', '-pix_fmt', 'yuv420p', source]);
  for (const [name, extra] of [['contain', {}], ['mask', { mask: { ...MASK_DEFAULTS } }], ['invert', { mask: { ...MASK_DEFAULTS, invert: true } }],
    ['color', { background: { mode: 'color', color: '#0000ff' } }], ['blur', { background: { mode: 'blur', color: '#000000' } }]]) {
    const outputPath = path.join(root, `${name}.mp4`);
    await runVideoJob('render', { projectState: state([clip(extra)]), rawAssetPaths: { source }, rawAssetKinds: { source: 'video' }, outputPath }, () => {});
    const middle = pixel(outputPath, 320, 180), edge = pixel(outputPath, 20, 180);
    if (name === 'invert') assert.ok(middle.every(v => v < 15), `${name}: center ${middle}`);
    else assert.ok(middle[0] > 200 && middle[1] < 20, `${name}: center ${middle}`);
    if (name === 'color') assert.ok(edge[2] > 200 && edge[0] < 20, `${name}: edge ${edge}`);
    else if (name === 'blur') assert.ok(edge[0] > 200, `${name}: edge ${edge}`);
    else assert.ok(edge.every(v => v < 15), `${name}: edge ${edge}`);
    if (name === 'mask') assert.ok(pixel(outputPath, 320, 20).every(v => v < 15));
    console.log(`PASS real FFmpeg ${name}`);
  }
  const baseline = new Resvg(vectorSvg({ text: TEXT_DEFAULTS })).render().asPng();
  for (const change of [{ bold: true }, { italic: true }, { underline: true }, { strokeEnabled: true, strokeWidth: 8 }, { backgroundEnabled: true },
    { glowEnabled: true }, { shadowEnabled: true }, { curve: 40 }, { letterSpacing: 12 }, { align: 'left' }]) {
    const rendered = new Resvg(vectorSvg({ text: { ...TEXT_DEFAULTS, ...change } })).render().asPng();
    assert.notDeepEqual(rendered, baseline, `Text property must change pixels: ${JSON.stringify(change)}`);
  }
  const shapes = ['rectangle', 'ellipse', 'triangle', 'star'].map(type => new Resvg(vectorSvg({ shape: { ...SHAPE_DEFAULTS, type } })).render().asPng());
  assert.equal(new Set(shapes.map(buffer => buffer.toString('base64'))).size, 4);
  console.log('PASS vector raster properties: 10 text variants and 4 shapes');
  for (const type of ['text', 'brush', 'draw']) {
    const mask = { ...MASK_DEFAULTS, type, paths: [[[.2, .2], [.8, .2], [.8, .8], [.2, .8]]], text: 'A', fontSize: 600, brushWidth: .15 };
    const outputPath = path.join(root, `mask-${type}.mp4`);
    await runVideoJob('render', { projectState: state([clip({ mask })]), rawAssetPaths: { source }, rawAssetKinds: { source: 'video' }, outputPath }, () => {});
    const frame = ff(['-i', outputPath, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    let red = 0; for (let i = 0; i < frame.length; i += 3) if (frame[i] > 150 && frame[i + 1] < 30) red++;
    assert.ok(red > 100 && red < 180 * 360 * .8, `${type} has a real partial matte: ${red}`);
    console.log(`PASS real FFmpeg ${type} mask`);
  }
  const darkGreen = path.join(root, 'dark-green.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=0x008000:s=200x400:d=1:r=24', '-pix_fmt', 'yuv420p', darkGreen]);
  for (const shadow of [0, 1]) {
    const outputPath = path.join(root, `chroma-shadow-${shadow}.mp4`);
    const effects = [{ id: 'chroma', type: 'chromaKey', enabled: true, params: { color: '0x00ff00', similarity: .05, blend: .05, shadow, cleanup: .01 } }];
    await runVideoJob('render', { projectState: state([clip({ effects })]), rawAssetPaths: { source: darkGreen }, rawAssetKinds: { source: 'video' }, outputPath }, () => {});
    const middle = pixel(outputPath, 320, 180);
    assert.ok(shadow ? middle.every(v => v < 15) : middle[1] > 70, `shadow ${shadow}: ${middle}`);
  }
  console.log('PASS real FFmpeg chroma shadow compensation');
  const stereo = path.join(root, 'stereo.wav');
  ff(['-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*440*t)|0.2*sin(2*PI*880*t):s=48000:d=1', stereo]);
  const strength = (pcm, channel, hz) => {
    let real = 0, imaginary = 0;
    const count = pcm.length / 8;
    for (let i = 0; i < count; i++) { const v = pcm.readFloatLE(i * 8 + channel * 4), phase = 2 * Math.PI * hz * i / 48000; real += v * Math.cos(phase); imaginary += v * Math.sin(phase); }
    return Math.hypot(real, imaginary) / count;
  };
  for (const channel of ['left', 'right', 'mono', 'mix']) {
    const project = state([clip({})]);
    project.tracks.push({ id: 'a1', type: 'audio', order: 1, visible: true, muted: false, clips: [clip({ id: 'audio1', assetId: 'stereo', audioChannel: channel === 'mix' ? 'left' : channel })] });
    if (channel === 'mix') project.tracks.push({ id: 'a2', type: 'audio', order: 2, visible: true, muted: false, clips: [clip({ id: 'audio2', assetId: 'stereo', audioChannel: 'right' })] });
    const outputPath = path.join(root, `audio-${channel}.mp4`);
    await runVideoJob('render', { projectState: project, rawAssetPaths: { source, stereo }, rawAssetKinds: { source: 'video', stereo: 'audio' }, outputPath }, () => {});
    const pcm = ff(['-i', outputPath, '-vn', '-ar', '48000', '-ac', '2', '-f', 'f32le', '-']);
    for (const side of [0, 1]) {
      const low = strength(pcm, side, 440), high = strength(pcm, side, 880);
      if (channel === 'left') assert.ok(low > high * 20, `left fill preserves only 440 Hz (${low}, ${high})`);
      else if (channel === 'right') assert.ok(high > low * 20, `right fill preserves only 880 Hz (${low}, ${high})`);
      else assert.ok(low > .03 && high > .03, `${channel} retains both sources (${low}, ${high})`);
    }
    console.log(`PASS real FFmpeg audio ${channel}`);
  }
  const blueImage = path.join(root, 'blue.png');
  ff(['-f', 'lavfi', '-i', 'color=c=blue:s=200x400', '-frames:v', '1', blueImage]);
  for (const videoOrder of [0, 3]) {
    const project = state([clip({})]); project.tracks[0].order = videoOrder;
    project.tracks.push({ id: 'image', type: 'sticker', order: 1, visible: true, muted: true, clips: [clip({ id: 'image', assetId: 'blue' })] });
    project.tracks.push({ id: 'shape', type: 'shape', order: 2, visible: true, muted: true, clips: [clip({ id: 'shape', assetId: undefined, shape: { ...SHAPE_DEFAULTS, width: 100, height: 100 } })] });
    const outputPath = path.join(root, `layer-order-${videoOrder}.mp4`);
    await runVideoJob('render', { projectState: project, rawAssetPaths: { source, blue: blueImage }, rawAssetKinds: { source: 'video', blue: 'image' }, outputPath }, () => {});
    const center = pixel(outputPath, 320, 180);
    assert.ok(videoOrder === 3 ? center[0] > 200 && center[1] < 20 : center.every(v => Math.abs(v - 153) < 10), `layer order ${videoOrder}: ${center}`);
  }
  console.log('PASS real FFmpeg mixed image/shape/video layer order');
})().catch(error => { console.error(error); process.exitCode = 1; });
