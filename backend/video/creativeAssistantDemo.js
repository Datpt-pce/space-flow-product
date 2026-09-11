const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { Resvg } = require('@resvg/resvg-js');
const { createDraft } = require('../../shared/creative-assistant');
const run = (bin, args) => exec(bin, args, { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const ffmpeg = args => run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args.map(String)]);

function wave(seconds, sample) {
  const rate = 48000, count = Math.round(seconds * rate), buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / rate))) * 32767), 44 + i * 2);
  return buffer;
}
async function createDemo(directory) {
  if (process.platform !== 'win32') throw new Error('Demo giọng mẫu cần Windows Speech. Trên Linux, nhập media và transcript của bạn để chạy cùng luồng dựng.');
  await fs.mkdir(directory, { recursive: true });
  const draft = createDraft('Một video cà phê Luma, buổi sáng nhẹ nhàng, mở đầu cuốn hút, cuối mời khám phá.');
  draft.name = 'Luma · A slower morning'; draft.language = 'en'; draft.overlayText = 'MAKE ROOM FOR YOUR MORNING';
  draft.script.hook.lines = ['What if your morning felt slower?', 'Start with a cup of Luma.'];
  draft.script.body.lines = ['A quiet moment. A warm cup.', 'Make this little ritual your own.'];
  draft.script.outro.lines = ['Discover your next morning with Luma.'];
  const lines = { hook: ['Let me try that again.', ...draft.script.hook.lines, 'That was the last take.'], body: draft.script.body.lines, outro: draft.script.outro.lines };
  const manifest = Object.entries(lines).flatMap(([role, texts]) => texts.map((text, i) => ({ text, path: path.join(directory, `${role}-voice-${i}.wav`) })));
  const manifestPath = path.join(directory, 'voice-input.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'creativeAssistantVoice.ps1'), '-Manifest', manifestPath]);
  const files = {}, speech = {};
  for (const [role, texts] of Object.entries(lines)) {
    const entries = manifest.filter(m => path.basename(m.path).startsWith(role + '-'));
    let at = role === 'hook' ? 650 : 250;
    const cues = [], filters = [], inputs = [];
    for (const [i, entry] of entries.entries()) {
      const metadata = await require('./assetService').probeMetadata(entry.path);
      const duration = metadata.durationMs, tokens = texts[i].split(/\s+/);
      const words = tokens.map((word, k) => ({ word, startMs: at + k * duration / tokens.length, endMs: at + (k + 1) * duration / tokens.length }));
      cues.push({ id: `${role}-${i}`, startMs: at, endMs: at + duration, content: texts[i], speaker: 'speaker-1', action: 'keep', words });
      inputs.push('-i', entry.path); filters.push(`[${i}:a]adelay=${Math.round(at)}:all=1[a${i}]`);
      at += duration + (role === 'hook' ? 1000 : 250);
    }
    const duration = Math.ceil((at + 250) / (1000 / 30)) / 30;
    filters.push(entries.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${entries.length}:normalize=0,apad,atrim=duration=${duration}[voice]`);
    const voice = path.join(directory, role + '-voice.wav');
    await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[voice]', '-ar', '48000', '-ac', '2', voice]);
    const label = role === 'hook' ? 'A SLOWER MORNING' : role === 'body' ? 'YOUR DAILY RITUAL' : 'DISCOVER LUMA';
    const bg = role === 'body' ? '#b48a65' : '#223c32';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="${bg}"/><circle cx="560" cy="320" r="360" fill="#ffffff" opacity=".045"/><circle cx="150" cy="1040" r="410" fill="#d6b186" opacity=".09"/><ellipse cx="360" cy="853" rx="230" ry="50" fill="#101e18" opacity=".3"/><ellipse cx="360" cy="819" rx="205" ry="35" fill="#e6d9be"/><path d="M510 595 C670 555 665 760 515 755" fill="none" stroke="#eddfc7" stroke-width="40"/><path d="M190 568 L220 795 Q360 870 500 795 L530 568 Z" fill="#f2e7d2"/><ellipse cx="360" cy="568" rx="170" ry="43" fill="#d1b994"/><ellipse cx="360" cy="568" rx="147" ry="30" fill="#513723"/><path d="M330 496 Q285 450 335 407 M390 481 Q435 438 387 390" fill="none" stroke="#f2e7d2" stroke-width="8" opacity=".4"/><text x="360" y="716" text-anchor="middle" font-family="Arial" font-size="48" letter-spacing="8" fill="#244033">LUMA</text><text x="360" y="965" text-anchor="middle" font-family="Arial" font-size="26" letter-spacing="4" fill="#f7ecd5">${label}</text><text x="360" y="1200" text-anchor="middle" font-family="Arial" font-size="16" fill="#f7ecd5" opacity=".6">CREATIVE ASSISTANT · SIMULATED SOURCE</text></svg>`;
    const poster = path.join(directory, role + '.png'); await fs.writeFile(poster, new Resvg(svg).render().asPng());
    files[role] = path.join(directory, role + '.mp4');
    await ffmpeg(['-loop', '1', '-framerate', '30', '-i', poster, '-i', voice, '-t', duration, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', files[role]]);
    speech[role] = { origin: 'simulation:authored-sentence-timing', cues };
  }
  files.logo = path.join(directory, 'logo.png');
  await fs.writeFile(files.logo, new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="160"><rect width="440" height="160" rx="32" fill="#f4e9d5"/><text x="220" y="108" text-anchor="middle" font-family="Arial" font-size="72" letter-spacing="9" fill="#244033">LUMA</text></svg>').render().asPng());
  files.music = path.join(directory, 'morning-music.wav');
  const chords = [[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]];
  await fs.writeFile(files.music, wave(32, t => {
    const beat = t % 2, env = Math.min(1, beat / .05) * Math.exp(-beat * 1.4);
    const chord = chords[Math.floor(t / 8) % 4];
    return env * chord.reduce((v, f) => v + Math.sin(t * 2 * Math.PI * f) * .12 + Math.sin(t * 4 * Math.PI * f) * .025, 0) * Math.min(1, t / .4, (32 - t) / .4);
  }));
  files.sfx = path.join(directory, 'soft-chime.wav');
  await fs.writeFile(files.sfx, wave(.8, t => Math.min(1, t / .01) * Math.exp(-t * 7) * (Math.sin(2 * Math.PI * 880 * t) + .4 * Math.sin(2 * Math.PI * 1320 * t)) * .3));
  const explanation = 'Demo dùng đồ họa và giọng tổng hợp, mô phỏng hook AI lệch lời. Timestamp cấp câu được đo từ audio; timestamp cấp từ chia theo câu để minh họa, chưa phải kết quả ASR. Body/outro đã tạo sẵn trước khi lập timeline. Có thể chạy Đọc lời AI để thay transcript bằng nhận dạng thực.';
  await fs.writeFile(path.join(directory, 'scenario.json'), JSON.stringify({ draft, speech, explanation }, null, 2));
  return { draft, files, speech, explanation };
}
module.exports = { createDemo };
