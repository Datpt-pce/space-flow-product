const { assertAllInvariants } = require('./video-commands/invariants');
const { splitCaptionCues, validateSpeech, wrapCaption } = require('./video-speech');
const { TEXT_DEFAULTS } = require('./video-vector');
const ROLES = ['hook', 'body', 'outro'];
const BINDINGS = [...ROLES, 'logo', 'music', 'sfx'];
const wordsOf = text => String(text).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const fail = message => { throw new Error(message); };
const text = (v, max, label, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim()) ? v : fail(`${label} không hợp lệ.`);

function createDraft(idea = '') {
  return { schemaVersion: 1, name: 'Creative Assistant', idea, language: 'vi',
    script: Object.fromEntries(ROLES.map(role => [role, { lines: [], targetDurationMs: role === 'hook' ? 5000 : null }])),
    overlayText: '', bindings: {}, settings: { width: 720, height: 1280, fps: 30, transitionMs: 300,
      timing: 'flexible', musicGain: 0.12, sfxGain: 0.35, captionSize: 36 } };
}

function validateDraft(input) {
  if (!input || input.schemaVersion !== 1) fail('Cần bản Creative Assistant schemaVersion 1.');
  const d = structuredClone(input);
  text(d.name, 120, 'Tên'); text(d.idea, 12000, 'Ý tưởng', true); text(d.overlayText, 120, 'Text overlay', true);
  if (!['vi', 'en'].includes(d.language)) fail('Bản đầu hỗ trợ lựa chọn tiếng Việt hoặc tiếng Anh.');
  const s = d.settings;
  if (!s || ![24, 25, 30, 50, 60].includes(s.fps) || !['flexible', 'fixed-hook'].includes(s.timing)) fail('FPS hoặc chính sách thời lượng không hợp lệ.');
  for (const k of ['width', 'height']) if (!Number.isSafeInteger(s[k]) || s[k] < 240 || s[k] > 1920 || s[k] % 2) fail('Canvas cần số chẵn từ 240–1920px.');
  for (const [k, min, max] of [['transitionMs', 1, 499], ['musicGain', 0, 1], ['sfxGain', 0, 1], ['captionSize', 12, 120]]) {
    if (!Number.isFinite(s[k]) || s[k] < min || s[k] > max) fail(`Thiết lập ${k} ngoài giới hạn.`);
  }
  for (const role of ROLES) {
    const scene = d.script?.[role];
    if (!scene || !Array.isArray(scene.lines) || scene.lines.length > 20) fail(`Kịch bản ${role} không hợp lệ.`);
    scene.lines.forEach(line => text(line, 500, `Lời ${role}`));
    if (scene.targetDurationMs != null && (!Number.isFinite(scene.targetDurationMs) || scene.targetDurationMs < 100 || scene.targetDurationMs > 120000)) fail('Thời lượng dự kiến ngoài giới hạn.');
  }
  if (!d.bindings || typeof d.bindings !== 'object' || Array.isArray(d.bindings)) fail('Thiếu bảng tài nguyên.');
  for (const [role, b] of Object.entries(d.bindings)) {
    if (!BINDINGS.includes(role) || !b || typeof b !== 'object') fail('Vai trò tài nguyên không hợp lệ.');
    text(b.assetId, 100, 'Asset ID'); text(b.contentHash, 100, 'Hash nguồn');
    if (b.speech && b.speech.sourceHash !== b.contentHash) fail(`Transcript ${role} không khớp hash nguồn.`);
  }
  return d;
}

// Match actual word sequences, not guessed timecodes. An exact phrase repeated
// in the source remains ambiguous until the transcript is reviewed by the user.
function matchLines(lines, cues) {
  const tokens = cues.flatMap(cue => (cue.words?.length ? cue.words : [])
    .flatMap(w => wordsOf(w.word).map(token => ({ ...w, token }))));
  const matches = [], issues = [];
  let cursor = 0;
  for (const [index, line] of lines.entries()) {
    const wanted = wordsOf(line), candidates = [];
    if (!wanted.length) { issues.push(`Câu ${index + 1} không có nội dung lời.`); continue; }
    for (let i = cursor; i <= tokens.length - wanted.length; i++) {
      if (wanted.every((token, k) => token === tokens[i + k].token)) candidates.push(i);
    }
    if (candidates.length !== 1) {
      issues.push(candidates.length ? `Câu ${index + 1} xuất hiện ${candidates.length} lần: cần chọn take rõ ràng.` : `Không tìm thấy đủ lời câu ${index + 1}: ${line}`);
      continue;
    }
    const first = candidates[0], last = first + wanted.length - 1;
    const kept = tokens.slice(first, last + 1);
    matches.push({ line, lineIndex: index, startMs: kept[0].startMs, endMs: kept.at(-1).endMs,
      previousEndMs: tokens[first - 1]?.endMs ?? 0, nextStartMs: tokens[last + 1]?.startMs ?? Infinity,
      words: kept.filter((w, i) => !i || w.startMs !== kept[i - 1].startMs || w.endMs !== kept[i - 1].endMs) });
    cursor = last + 1;
  }
  return { matches, issues };
}

function planCreative(input, assets) {
  const draft = validateDraft(input), { settings: s } = draft;
  const frame = 1000 / s.fps, floor = n => Math.floor((n + 1e-6) / frame) * frame;
  const ceil = n => Math.ceil((n - 1e-6) / frame) * frame;
  const issues = [], notices = [], mappings = [], selected = {};
  for (const role of BINDINGS) {
    const b = draft.bindings[role], a = b && assets[b.assetId];
    const kind = ROLES.includes(role) ? 'video' : role === 'logo' ? 'image' : 'audio';
    if (!a || a.kind !== kind || a.status !== 'ok' || a.content_hash !== b.contentHash) {
      issues.push(`${role}: chọn ${kind} sẵn sàng, đúng hash.`); continue;
    }
    if (kind !== 'image' && (!Number.isFinite(a.duration_ms) || a.duration_ms < frame || a.duration_ms > 3600000)) issues.push(`${role}: thời lượng nguồn không hợp lệ.`);
    selected[role] = a;
  }
  const speeches = {};
  for (const role of ROLES) {
    if (!draft.script[role].lines.length) issues.push(`${role}: nhập lời trong kịch bản chuẩn.`);
    const b = draft.bindings[role];
    if (!selected[role] || !b?.speech) { issues.push(`${role}: cần transcript có timestamp cấp từ.`); continue; }
    try {
      speeches[role] = validateSpeech({ cues: b.speech.cues, style: { preset: 'outline', fontSize: s.captionSize } }, selected[role].duration_ms);
      if (!speeches[role].cues.length || speeches[role].cues.some(c => !c.words.length)) fail('Thiếu timestamp cấp từ; đọc lời bằng AI hoặc nhập bản đã rà.');
      for (const [index, cue] of speeches[role].cues.entries()) {
        if (cue.words.length !== b.speech.cues[index].words.length || wordsOf(cue.content).join(' ') !== wordsOf(cue.words.map(w => w.word).join(' ')).join(' ')
          || cue.words.some((w, i) => i && w.startMs < cue.words[i - 1].endMs)) fail('Timestamp cấp từ phải đầy đủ, đúng thứ tự và khớp nội dung câu.');
      }
      const match = matchLines(draft.script[role].lines, speeches[role].cues);
      issues.push(...match.issues.map(e => `${role}: ${e}`));
      speeches[role].matches = match.matches;
    } catch (e) { issues.push(`${role}: ${e.message}`); }
  }
  if (issues.length) return { canCreate: false, issues, notices, mappings };
  let cursor = 0;
  for (const role of ROLES) {
    const asset = selected[role], speech = speeches[role];
    let windows;
    if (role === 'hook') {
      windows = speech.matches.map(m => {
        const inMs = Math.max(0, ceil(m.previousEndMs), floor(m.startMs - 80));
        const outMs = Math.min(floor(asset.duration_ms), floor(m.nextStartMs), ceil(m.endMs + 100));
        if (inMs > m.startMs + 1 || outMs < m.endMs - 1) issues.push('Hook: biên frame quá sát lời khác; cần rà điểm cắt.');
        return { sourceInMs: inMs, sourceOutMs: outMs };
      });
      const merged = [];
      for (const window of windows) {
        if (merged.length && window.sourceInMs <= merged.at(-1).sourceOutMs + 1e-6) merged.at(-1).sourceOutMs = Math.max(merged.at(-1).sourceOutMs, window.sourceOutMs);
        else merged.push(window);
      }
      windows = merged;
    } else windows = [{ sourceInMs: 0, sourceOutMs: floor(asset.duration_ms) }];
    for (const [i, w] of windows.entries()) {
      const duration = w.sourceOutMs - w.sourceInMs;
      if (duration < frame - 1e-6) { issues.push(`${role}: đoạn quá ngắn.`); continue; }
      mappings.push({ role, clipId: `${role}-${i + 1}`, assetId: asset.id, ...w, timelineInMs: cursor, timelineOutMs: cursor + duration });
      cursor += duration;
    }
  }
  const hookEnd = mappings.filter(m => m.role === 'hook').at(-1)?.timelineOutMs || 0;
  const target = draft.script.hook.targetDurationMs;
  if (s.timing === 'fixed-hook' && (!target || Math.abs(hookEnd - target) > frame / 2)) issues.push('Hook chưa đạt thời lượng cố định. Đổi take hoặc sửa lời; không tự tăng tốc tiếng.');
  if (target && Math.abs(hookEnd - target) > frame) notices.push(`Hook dự kiến ${target / 1000}s → thực dùng ${(hookEnd / 1000).toFixed(2)}s. Body/outro dịch theo.`);
  notices.push('So khớp từ theo thứ tự; chưa có suy luận ngữ nghĩa hoặc model được huấn luyện riêng.');
  if (issues.length) return { canCreate: false, issues, notices, mappings };
  const document = { schemaVersion: 1, resolution: { width: s.width, height: s.height }, fps: s.fps, colorSpace: 'sRGB', audioRate: 48000,
    sequence: { markers: [], transitionTiming: 'centered-v1' }, tracks: [], transitions: [] };
  const base = (id, start, end) => ({ id, sourceInMs: 0, sourceOutMs: end - start, timelineInMs: start, timelineOutMs: end,
    speed: 1, effects: [], keyframes: [], transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const track = (id, name, type, clips) => { if (clips.length) document.tracks.push({ id, name, type, clips, order: 0, locked: false, muted: false, visible: true }); };
  const logo = { ...base('brand-logo', 0, cursor), assetId: selected.logo.id, volume: 0 };
  logo.transform = { ...logo.transform, scaleX: 0.2, scaleY: 0.2, x: -s.width * 0.32, y: -s.height * 0.4 };
  track('logo', 'Logo', 'video', [logo]);
  if (draft.overlayText.trim()) track('overlay', 'Text hook', 'text', [{ ...base('hook-overlay', 0, hookEnd),
    text: { ...TEXT_DEFAULTS, content: wrapCaption(draft.overlayText, s.width * 0.82, Math.round(s.width * 0.055), 4), width: s.width * 0.82, height: s.height * 0.15,
      fontSize: Math.round(s.width * 0.055), bold: true, backgroundEnabled: true, backgroundColor: '#182820', backgroundOpacity: 0.85 },
    transform: { x: 0, y: -s.height * 0.25, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }]);
  const captions = [];
  for (const m of mappings) {
    const offset = m.timelineInMs - m.sourceInMs;
    const keptWords = speeches[m.role].cues.flatMap(c => c.words).filter(w => w.startMs >= m.sourceInMs - 1 && w.endMs <= m.sourceOutMs + 1);
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const cue = { id: `${m.clipId}-cue-${captions.length}`, content: group.map(w => w.word.trim()).join(' '),
        startMs: group[0].startMs + offset, endMs: group.at(-1).endMs + offset,
        words: group.map(w => ({ ...w, startMs: w.startMs + offset, endMs: w.endMs + offset })) };
      if (cue.endMs - cue.startMs >= frame) for (const part of splitCaptionCues([cue], { ...document.resolution, fps: s.fps }, { fontSize: s.captionSize, safeMarginPct: 10 })) {
        captions.push({ ...base(part.id, part.startMs, part.endMs), text: { content: part.content, words: part.words,
          preset: 'outline', fontFamily: 'Arial', fontSize: s.captionSize, position: 'bottom-center', safeMarginPct: 10 } });
      }
      group = [];
    };
    for (const w of keptWords) { if (group.length && (w.startMs - group.at(-1).endMs > 400 || group.length >= 7)) flush(); group.push(w); if (/[.!?]$/.test(w.word.trim())) flush(); }
    flush();
  }
  track('captions', 'Subtitle', 'caption', captions);
  track('main', 'Hook · Body · Outro', 'video', mappings.map(m => ({ ...base(m.clipId, m.timelineInMs, m.timelineOutMs),
    assetId: m.assetId, sourceInMs: m.sourceInMs, sourceOutMs: m.sourceOutMs, volume: 1, audioFadeInMs: 8, audioFadeOutMs: 8 })));
  for (let i = 0; i < mappings.length - 1; i++) {
    const a = mappings[i], b = mappings[i + 1];
    const duration = floor(Math.min(s.transitionMs, a.timelineOutMs - a.timelineInMs, b.timelineOutMs - b.timelineInMs));
    if (duration < frame) { issues.push('Transition không đủ một frame.'); continue; }
    document.transitions.push({ id: `cut-${i}`, fromClipId: a.clipId, toClipId: b.clipId, type: 'crossfade', durationMs: duration, timingMode: 'centered-v1' });
  }
  const sfxAt = floor(Math.max(0, speeches.hook.matches[0].startMs - mappings[0].sourceInMs));
  const sfxEnd = Math.min(cursor, sfxAt + floor(Math.min(selected.sfx.duration_ms, 800)));
  track('sfx', 'SFX · điểm nhấn hook', 'audio', [{ ...base('hook-sfx', sfxAt, sfxEnd), assetId: selected.sfx.id, volume: s.sfxGain, audioFadeInMs: Math.min(20, (sfxEnd - sfxAt) / 2), audioFadeOutMs: Math.min(100, (sfxEnd - sfxAt) / 2) }]);
  const music = []; let at = 0;
  const available = floor(selected.music.duration_ms);
  while (at < cursor - 1e-6) {
    if (music.length >= 100) fail('Nhạc quá ngắn, cần hơn 100 vòng lặp.');
    const end = Math.min(cursor, at + available), fade = Math.min(400, (end - at) / 2);
    music.push({ ...base(`music-${music.length}`, at, end), assetId: selected.music.id, volume: s.musicGain, audioFadeInMs: fade, audioFadeOutMs: fade }); at = end;
  }
  track('music', 'Music · xuyên suốt', 'audio', music);
  document.tracks.forEach((t, i) => { t.order = document.tracks.length - i; });
  assertAllInvariants(document);
  return { canCreate: !issues.length, issues, notices, mappings, document, durationMs: cursor, hookDurationMs: hookEnd,
    removedHookMs: selected.hook.duration_ms - hookEnd, speechEvidence: Object.fromEntries(ROLES.map(role => [role, draft.bindings[role].speech.origin || 'user-reviewed'])) };
}
module.exports = { ROLES, BINDINGS, createDraft, validateDraft, matchLines, planCreative };
