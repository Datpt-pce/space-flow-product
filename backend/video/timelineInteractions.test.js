const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runVideoJob } = require('../agent/videoJobs');
const { TEXT_DEFAULTS, vectorSvg, vectorSize } = require('../../shared/video-vector');
const { listSystemFonts } = require('./systemFonts');
const { runCommand, invertCommand } = require('../../shared/video-commands');
const root = path.resolve(__dirname, '../../logs/timeline-interactions-render');
fs.mkdirSync(root, { recursive: true });
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const clip = (id, start) => ({ id, assetId: 'source', sourceInMs: 0, sourceOutMs: 1000, timelineInMs: start, timelineOutMs: start + 1000, speed: 1, effects: [], keyframes: [], transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
(async () => {
  const families = await listSystemFonts(); assert.ok(families.length > 10); assert.ok(families.every(f => typeof f === 'string'));
  console.log(`PASS system font enumeration: ${families.length} families`);
  const text = { text: { ...TEXT_DEFAULTS, content: 'AA\nBB', backgroundEnabled: true, lineSpacing: 100, backgroundPaddingX: 20, backgroundPaddingY: 30, backgroundRadius: 15 } };
  const svg = vectorSvg(text, () => 100);
  assert.match(svg, /width="140" height="318.4" rx="15"/);
  const lines = vectorSvg({ text: { ...text.text, backgroundMode: 'lines' } }, () => 100);
  assert.equal((lines.match(/data-text-background/g) || []).length, 2);
  assert.ok(vectorSize(text).height >= 274);
  console.log('PASS measured text background follows line spacing, mode, padding and radius');
  const state = { schemaVersion: 1, resolution: { width: 320, height: 180 }, fps: 24, audioRate: 48000, sequence: { markers: [] },
    tracks: [{ id: 'v', type: 'video', order: 0, locked: false, visible: true, muted: true, clips: [clip('a', 0), clip('b', 1000)] }],
    transitions: [{ id: 't', fromClipId: 'a', toClipId: 'b', durationMs: 400, params: {} }] };
  const args = { deletions: [{ trackId: 'v', index: 0, clip: state.tracks[0].clips[0] }], transitions: state.transitions };
  const deleted = runCommand(state, 'DeleteClips', args); assert.equal(deleted.transitions.length, 0); assert.equal(deleted.tracks[0].clips.length, 1);
  assert.deepEqual(invertCommand(deleted, 'DeleteClips', args), state);
  console.log('PASS deleting referenced clip and transition is invertible');
  const moveState = structuredClone(state); moveState.transitions = [];
  const moveArgs = { newTracks: [{ id: 'new-v', type: 'video', order: 1, clips: [], visible: true, locked: false, muted: true }], moves: [{ clipId: 'a', fromTrackId: 'v', toTrackId: 'new-v', fromIndex: 0, fromTimelineInMs: 0, toTimelineInMs: 0 }] };
  const moved = runCommand(moveState, 'MoveClips', moveArgs);
  assert.deepEqual(invertCommand(moved, 'MoveClips', moveArgs), moveState);
  assert.equal(moveArgs.newTracks[0].clips.length, 0);
  console.log('PASS move to a new track preserves clip identities, array order and one-step undo');
  const source = path.join(root, 'source.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1:r=24', '-pix_fmt', 'yuv420p', source]);
  const frames = [];
  for (const type of ['crossfade', 'pull-in', 'pull-out']) {
    const projectState = structuredClone(state); projectState.transitions[0].type = type;
    const outputPath = path.join(root, `${type}.mp4`);
    await runVideoJob('render', { projectState, rawAssetPaths: { source }, rawAssetKinds: { source: 'video' }, outputPath }, () => {});
    frames.push(ff(['-ss', '0.8', '-i', outputPath, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']));
    console.log(`PASS actual FFmpeg ${type}`);
  }
  assert.notDeepEqual(frames[0], frames[1]); assert.notDeepEqual(frames[0], frames[2]); assert.notDeepEqual(frames[1], frames[2]);
})().catch(err => { console.error(err); process.exitCode = 1; });
