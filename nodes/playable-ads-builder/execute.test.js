const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { test, afterEach } = require('node:test');
const childProcess = require('node:child_process');
const nativeSpawn = childProcess.spawn;
let intercept;
// Capture a delegating spawn before loading the node; never launch a real codec
// in deterministic failure/retry tests. Other modules keep their original spawn.
childProcess.spawn = (...args) => (intercept || nativeSpawn)(...args);
const { prepareVideo, embeddedBytes, MAX_HTML_BYTES, runTool } = require('./compressVideo');
const execute = require('./execute');
childProcess.spawn = nativeSpawn;
const { NETWORKS, buildHtml } = require('./template');
const { pathToItem, itemToPath } = require('../../backend/utils/items');

const temporaryRoot = path.resolve(os.tmpdir());
const directories = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'sf-playable-test-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  intercept = undefined;
  for (const directory of directories.splice(0)) {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('sf-playable-test-'));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
const config = {
  title: 'Quảng cáo 🎮', linkDownloadAndroid: 'https://example.com/android',
  linkDownloadIos: 'https://example.com/ios',
  states: [{ start: 0.5, end: 2.5, loop: true, pauseBeforeExit: true, exitOnClick: true }],
};
function context() {
  const logs = [];
  return { logs, log: (line) => logs.push(line), progress: () => {} };
}
function fakeCodecs(sizes = [3_000_000], { duration = 30, audio = true, failEncode = false } = {}) {
  const calls = [];
  let outputIndex = 0;
  intercept = (executable, args) => {
    calls.push({ executable, args });
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = () => { setImmediate(() => proc.emit('close', null)); return true; };
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        proc.stdout.write(JSON.stringify({ format: { duration }, streams: [
          { codec_type: 'video', avg_frame_rate: '60/1' }, ...(audio ? [{ codec_type: 'audio' }] : []),
        ] }));
      } else if (failEncode) {
        proc.stderr.write('encoder fixture failure');
        proc.emit('close', 1);
        return;
      } else if (args[args.indexOf('-pass') + 1] === '2') {
        fs.writeFileSync(args.at(-1), Buffer.alloc(sizes[Math.min(outputIndex++, sizes.length - 1)], 7));
      }
      proc.emit('close', 0);
    });
    return proc;
  };
  return calls;
}
function assertScratchRemoved(calls) {
  for (const { args } of calls.filter(({ args }) => args.includes('-passlogfile'))) {
    assert.equal(fs.existsSync(path.dirname(args[args.indexOf('-passlogfile') + 1])), false);
  }
}

test('small batch retains source bytes, Unicode title/states, platform URLs and every network', async () => {
  const directory = fixture();
  const paths = ['Tên video 🎮.mp4', 'Second.mp4'].map((name) => path.join(directory, name));
  for (const file of paths) fs.writeFileSync(file, Buffer.from('existing small video'));
  intercept = () => { throw new Error('Fitting videos must not need FFmpeg'); };
  const result = await execute({ videos_in: paths.map((file) => pathToItem(file)) }, config, context());
  assert.equal(result.files_out.length, paths.length * Object.keys(NETWORKS).length * 2);
  for (const item of result.files_out) {
    const output = itemToPath(item);
    const html = fs.readFileSync(output, 'utf8');
    assert.ok(fs.statSync(output).size < MAX_HTML_BYTES);
    assert.ok(html.includes(Buffer.from('existing small video').toString('base64')));
    assert.ok(html.includes(`var _states = ${JSON.stringify(config.states, null, 4)};`));
    assert.ok(html.includes(output.includes(`${path.sep}AND${path.sep}`) ? config.linkDownloadAndroid : config.linkDownloadIos));
    assert.ok(html.includes(output.includes('Second') ? '<title>Second</title>' : '<title>Tên video 🎮</title>'));
  }
});

test('strict byte boundary and Base64 padding: limit - 1 fits, exactly limit fails', async () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(embeddedBytes), [0, 4, 4, 4, 8]);
  const file = path.join(fixture(), 'boundary.mp4');
  fs.writeFileSync(file, Buffer.alloc(3));
  assert.equal((await prepareVideo(file, MAX_HTML_BYTES - 5)).length, 3);
  await assert.rejects(prepareVideo(file, MAX_HTML_BYTES - 4), /HTML\/config quá lớn/);
  fs.writeFileSync(file, '');
  await assert.rejects(prepareVideo(file, 0), /rỗng/);
});

test('final HTML byte guard rejects a source that grows after the initial size check', async () => {
  const directory = fixture();
  const file = path.join(directory, 'growing.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  const nativeStat = fs.statSync;
  fs.statSync = (target, ...args) => {
    const stat = nativeStat(target, ...args);
    if (target === file) stat.size = 3; // simulate earlier small size, before read
    return stat;
  };
  try {
    await assert.rejects(execute({}, { ...config, video_path: file }, context()), /phải dưới 5.000.000 byte/);
    assert.equal(fs.existsSync(path.join(directory, 'AND', 'growing', 'growing_applovin.html')), false);
  } finally {
    fs.statSync = nativeStat;
  }
});

test('compress once per video using largest UTF-8 variant, then reuse for all outputs', async () => {
  const file = path.join(fixture(), 'large.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000, 1));
  const before = fs.readFileSync(file);
  const calls = fakeCodecs();
  const runConfig = { ...config, video_path: file, linkDownloadIos: `https://example.com/${'ệ'.repeat(100_000)}` };
  const result = await execute({}, runConfig, context());
  assert.equal(calls.length, 3); // one probe + exactly two passes, not per network/platform
  const expectedOverhead = Math.max(...Object.values(NETWORKS).map((network) => Buffer.byteLength(
    buildHtml({ ...network, title: config.title, url: runConfig.linkDownloadIos, states: config.states, base64Video: '' }),
  )));
  const budget = Math.floor((4_800_000 - expectedOverhead) / 4) * 3;
  assert.equal(calls[1].args[calls[1].args.indexOf('-b:v') + 1], String(Math.floor((budget - 64_000) * 8 / 30 - 64_000)));
  for (const item of result.files_out) assert.ok(fs.statSync(itemToPath(item)).size < MAX_HTML_BYTES);
  assert.deepEqual(fs.readFileSync(file), before);
  assertScratchRemoved(calls);
});

test('overshoot retries lower bitrate and FPS, preserves audio, cleans scratch', async () => {
  const file = path.join(fixture(), 'retry.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  const calls = fakeCodecs([4_000_000, 3_000_000]);
  assert.equal((await prepareVideo(file, 10_000, context())).length, 3_000_000);
  assert.equal(calls.length, 5);
  const first = calls[1].args;
  const retry = calls[3].args;
  assert.ok(Number(retry[retry.indexOf('-b:v') + 1]) < Number(first[first.indexOf('-b:v') + 1]));
  assert.match(retry[retry.indexOf('-vf') + 1], /fps=24/);
  assert.ok(calls[2].args.includes('aac'));
  assertScratchRemoved(calls);
});

test('unachievable output stops after three attempts and writes no HTML', async () => {
  const directory = fixture();
  const file = path.join(directory, 'impossible.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  const calls = fakeCodecs([4_000_000]);
  await assert.rejects(execute({}, { ...config, video_path: file }, context()), /Không thể nén/);
  assert.equal(calls.length, 7);
  assert.deepEqual(fs.readdirSync(directory), ['impossible.mp4']);
  assertScratchRemoved(calls);
});

test('invalid duration and infeasible bitrate fail without encoding; silent input keeps no audio', async () => {
  const file = path.join(fixture(), 'invalid.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  let calls = fakeCodecs([], { duration: 'N/A' });
  await assert.rejects(prepareVideo(file, 10_000), /thời lượng/);
  assert.equal(calls.length, 1);
  calls = fakeCodecs([], { duration: 3600 });
  await assert.rejects(prepareVideo(file, 10_000), /Không thể nén/);
  assert.equal(calls.length, 1);
  calls = fakeCodecs([3_000_000], { audio: false });
  await prepareVideo(file, 10_000);
  assert.ok(calls[2].args.includes('-an'));
  assert.equal(calls[2].args.includes('aac'), false);
  assertScratchRemoved(calls);
});

test('codec failure cleans scratch and does not overwrite previously exported HTML', async () => {
  const directory = fixture();
  const file = path.join(directory, 'broken.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  const prior = path.join(directory, 'AND', 'broken', 'broken_applovin.html');
  fs.mkdirSync(path.dirname(prior), { recursive: true });
  fs.writeFileSync(prior, 'previous valid export');
  const calls = fakeCodecs([], { failEncode: true });
  await assert.rejects(execute({}, { ...config, video_path: file }, context()), /encoder fixture failure/);
  assert.equal(fs.readFileSync(prior, 'utf8'), 'previous valid export');
  assertScratchRemoved(calls);
});

test('missing binary reports installation guidance', async () => {
  await assert.rejects(runTool(path.join(fixture(), 'missing-ffmpeg'), []), /Cài FFmpeg/);
});

test('cancellation and timeout terminate process and wait for close', async () => {
  const controller = new AbortController();
  const pending = runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /hủy/);
  await assert.rejects(runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }), /quá thời gian/);
});

test('abort during encoding cleans temporary pass directory', async () => {
  const file = path.join(fixture(), 'cancel.mp4');
  fs.writeFileSync(file, Buffer.alloc(4_000_000));
  const calls = fakeCodecs();
  const codecSpawn = intercept;
  const controller = new AbortController();
  intercept = (executable, args) => {
    if (!args.includes('-pass')) return codecSpawn(executable, args);
    calls.push({ executable, args });
    const proc = nativeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
    setTimeout(() => controller.abort(), 100);
    return proc;
  };
  await assert.rejects(prepareVideo(file, 10_000, { signal: controller.signal }), /hủy/);
  assertScratchRemoved(calls);
});

for (const media of [
  { label: 'portrait with audio', size: '1080x1920', fps: 60, duration: 3, audio: true },
  { label: 'landscape silent 15 FPS', size: '1280x720', fps: 15, duration: 6, audio: false },
]) test(`real FFmpeg: ${media.label}, embedded MP4 decodes, duration/source retained`, { timeout: 120_000 }, async (t) => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  if ([ffmpeg, ffprobe].some((binary) => childProcess.spawnSync(binary, ['-version'], { windowsHide: true }).error?.code === 'ENOENT')) {
    t.skip('FFmpeg/ffprobe unavailable; real codec proof requires both');
    return;
  }
  const directory = fixture();
  const file = path.join(directory, 'Nguồn video có dấu.mp4');
  await runTool(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${media.size}:rate=${media.fps}:duration=${media.duration}`,
    ...(media.audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${media.duration}`] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0',
    ...(media.audio ? ['-c:a', 'aac', '-shortest'] : ['-an']), file]);
  assert.ok(fs.statSync(file).size > 4_000_000, 'fixture must exercise compression');
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const originalHash = hash();
  const ctx = context();
  const result = await execute({}, { ...config, video_path: file }, ctx);
  assert.equal(result.files_out.length, 10);
  const encodedVideos = result.files_out.map((item) => {
    const output = itemToPath(item);
    assert.ok(fs.statSync(output).size < MAX_HTML_BYTES);
    const html = fs.readFileSync(output, 'utf8');
    return html.match(/data:video\/mp4;base64,([A-Za-z0-9+/=]+)/)[1];
  });
  assert.equal(new Set(encodedVideos).size, 1);
  const embedded = path.join(directory, 'embedded.mp4');
  fs.writeFileSync(embedded, Buffer.from(encodedVideos[0], 'base64'));
  const probe = JSON.parse(await runTool(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', embedded]));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.ok(Math.max(video.width, video.height) <= 1280);
  assert.ok(media.fps === 15 ? video.avg_frame_rate === '15/1' : ['30/1', '24/1'].includes(video.avg_frame_rate));
  assert.ok(Math.abs(Number(probe.format.duration) - media.duration) < 0.1);
  assert.equal(probe.streams.find((stream) => stream.codec_type === 'audio')?.codec_name, media.audio ? 'aac' : undefined);
  assert.equal(video.width > video.height, media.size === '1280x720');
  await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', embedded, '-f', 'null', '-']);
  assert.equal(hash(), originalHash);
  console.log(`REAL CODEC: source ${fs.statSync(file).size} bytes; largest HTML ${Math.max(...result.files_out.map((item) => fs.statSync(itemToPath(item)).size))} bytes; ${video.width}x${video.height}; ${probe.format.duration}s`);
});
