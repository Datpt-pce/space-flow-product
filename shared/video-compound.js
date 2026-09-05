// Pure temporal projection of a pinned nested timeline. Unsupported parent
// compositing is rejected before mutation; the original compound stays intact.
const { keyframesForProperty } = require('./video-keyframes');

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function splitCurve(p, t) {
  const a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t);
  const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  return [[p[0], a, d, f], [f, e, c, p[3]]];
}
function parameterAt(p, x) {
  if (x <= p[0][0]) return 0;
  if (x >= p[3][0]) return 1;
  let lo = 0, hi = 1;
  for (let n = 0; n < 45; n++) {
    const mid = (lo + hi) / 2;
    if (splitCurve(p, mid)[0][3][0] < x) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function cropCurve(p, start, end) {
  const to = parameterAt(p, end);
  const from = parameterAt(p, start);
  const left = splitCurve(p, to)[0];
  return from ? splitCurve(left, from / to)[1] : left;
}
function segmentCurves(a, b) {
  const x = a.timeMs, span = b.timeMs - x, y = a.value, delta = b.value - y;
  const curve = (x1, y1, x2, y2) => [[x, y], [x + span * x1, y + delta * y1], [x + span * x2, y + delta * y2], [b.timeMs, b.value]];
  if (a.easing === 'ease-in-out') {
    const mid = { timeMs: x + span / 2, value: y + delta / 2, easing: 'ease-out' };
    return [...segmentCurves({ ...a, easing: 'ease-in' }, mid), ...segmentCurves(mid, b)];
  }
  let p;
  if (a.easing === 'ease-in') p = curve(1 / 3, 0, 2 / 3, 1 / 3);
  else if (a.easing === 'ease-out') p = curve(1 / 3, 2 / 3, 2 / 3, 1);
  else if (a.easing === 'custom') p = curve(a.easingX1, a.easingY1, a.easingX2, a.easingY2);
  else p = curve(1 / 3, 1 / 3, 2 / 3, 2 / 3);
  // Split overshooting curves at value extrema: each resulting segment has a
  // representable nonzero value range even when a trim's two endpoints coincide.
  const [v0, v1, v2, v3] = p.map(point => point[1]);
  const aa = -v0 + 3 * v1 - 3 * v2 + v3, bb = 2 * (v0 - 2 * v1 + v2), cc = v1 - v0;
  const roots = [];
  if (Math.abs(aa) < 1e-10) { if (Math.abs(bb) > 1e-10) roots.push(-cc / bb); }
  else if (bb * bb - 4 * aa * cc > 0) {
    const d = Math.sqrt(bb * bb - 4 * aa * cc);
    roots.push((-bb - d) / (2 * aa), (-bb + d) / (2 * aa));
  }
  const cuts = [0, ...roots.filter(t => t > 1e-9 && t < 1 - 1e-9).sort((c, d) => c - d), 1];
  return cuts.slice(1).map((end, i) => {
    const left = splitCurve(p, end)[0];
    return cuts[i] ? splitCurve(left, cuts[i] / end)[1] : left;
  });
}

function remapKeyframes(clip, start, end, speed, uuid) {
  const result = [];
  for (const propertyPath of new Set((clip.keyframes || []).map(k => k.propertyPath))) {
    const keys = keyframesForProperty(clip, propertyPath);
    const duration = clip.timelineOutMs - clip.timelineInMs;
    if (keys[0].timeMs > 0) keys.unshift({ ...keys[0], timeMs: 0, easing: 'linear' });
    if (keys.at(-1).timeMs < duration) keys.push({ ...keys.at(-1), timeMs: duration });
    if (keys.length === 1) { result.push({ ...keys[0], id: uuid(), timeMs: 0 }); continue; }
    const pieces = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (a.timeMs >= end || b.timeMs <= start) continue;
      if (a.easing === 'hold') {
        if (speed < 0 && a.value !== b.value) throw new Error('Bung clip đảo chiều có keyframe Hold chưa được hỗ trợ; giữ nguyên clip lồng.');
        const lo = Math.max(start, a.timeMs), hi = Math.min(end, b.timeMs);
        pieces.push({ p: [[lo, a.value], [lo, a.value], [hi, a.value], [hi, hi === b.timeMs ? b.value : a.value]], hold: true });
      } else for (const p of segmentCurves(a, b)) {
        const lo = Math.max(start, p[0][0]), hi = Math.min(end, p[3][0]);
        if (hi > lo) pieces.push({ p: cropCurve(p, lo, hi) });
      }
    }
    if (speed < 0) pieces.reverse();
    for (const piece of pieces) {
      const p = piece.p.map(([x, y]) => [(speed > 0 ? x - start : end - x) / Math.abs(speed), y]);
      if (speed < 0) p.reverse();
      const dx = p[3][0] - p[0][0], dy = p[3][1] - p[0][1];
      const k = { id: uuid(), propertyPath, timeMs: Math.max(0, Math.min((end - start) / Math.abs(speed), p[0][0])), value: p[0][1], easing: piece.hold ? 'hold' : 'linear' };
      if (!piece.hold && Math.abs(dy) > 1e-10) Object.assign(k, {
        easing: 'custom', easingX1: Math.max(0, Math.min(1, (p[1][0] - p[0][0]) / dx)), easingX2: Math.max(0, Math.min(1, (p[2][0] - p[0][0]) / dx)),
        easingY1: (p[1][1] - p[0][1]) / dy, easingY2: (p[2][1] - p[0][1]) / dy,
      });
      result.push(k);
    }
    if (pieces.length) {
      const last = speed > 0 ? pieces.at(-1).p[3] : pieces.at(-1).p[0];
      result.push({ id: uuid(), propertyPath, timeMs: (end - start) / Math.abs(speed), value: last[1], easing: 'linear' });
    }
  }
  return result;
}

function planCompoundUnpack(parent, trackId, clipId, nested, uuid) {
  const track = parent.tracks.find(t => t.id === trackId);
  const index = track?.clips.findIndex(c => c.id === clipId) ?? -1;
  const clip = track?.clips[index];
  if (!clip?.compoundRef || track.locked) throw new Error('Chọn clip lồng trên track đã mở khoá.');
  const speed = clip.speed ?? 1;
  if (!Number.isFinite(speed) || speed === 0) throw new Error('Không thể bung clip đang giữ một khung hình.');
  const defaults = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, pivotX: 0.5, pivotY: 0.5 };
  if (clip.audioFadeInMs || clip.audioFadeOutMs) throw new Error('Bỏ fade âm thanh trên clip lồng trước khi bung.');
  if ((clip.effects || []).some(e => e.enabled !== false) || (clip.keyframes || []).length || (clip.volume ?? 1) !== 1 || clip.fadeInMs || clip.fadeOutMs || clip.videoFadeInMs || clip.videoFadeOutMs || (clip.crop && (clip.crop.x || clip.crop.y || clip.crop.width !== 1 || clip.crop.height !== 1)) || Object.entries(clip.transform || {}).some(([k, v]) => defaults[k] !== undefined && defaults[k] !== v)) {
    throw new Error('Bỏ hiệu ứng, fade và biến đổi trên clip lồng trước khi bung để giữ nguyên kết quả dựng.');
  }
  if (parent.resolution.width !== nested.resolution.width || parent.resolution.height !== nested.resolution.height) throw new Error('Hai timeline cần cùng kích thước khung hình trước khi bung.');
  if ((nested.transitions || []).length) throw new Error('Timeline lồng có chuyển cảnh làm thay đổi thời gian bản render. Giữ clip lồng hoặc bỏ chuyển cảnh và nhúng lại trước khi bung.');
  if (parent.tracks.some(t => t.id !== track.id && t.type === 'video' && t.visible !== false && t.order < track.order && t.clips.some(c => c.timelineInMs < clip.timelineOutMs && c.timelineOutMs > clip.timelineInMs))) {
    throw new Error('Clip lồng đang che một lớp video bên dưới. Giữ clip lồng để không làm mất nền của bản render.');
  }
  const begin = clip.sourceInMs, end = clip.sourceOutMs, scale = Math.abs(speed);
  const newTracks = [], idMap = new Map(), groupMap = new Map();
  const nextOrder = Math.min(...parent.tracks.filter(t => t.order > track.order).map(t => t.order), track.order + 1);
  const orderStep = (nextOrder - track.order) / (nested.tracks.length + 1);
  let order = track.order;
  for (const nestedTrack of [...nested.tracks].sort((a, b) => a.order - b.order)) {
    const clips = [];
    for (const source of nestedTrack.clips) {
      const lo = Math.max(begin, source.timelineInMs), hi = Math.min(end, source.timelineOutMs);
      if (hi <= lo) continue;
      const copy = JSON.parse(JSON.stringify(source));
      const sourceSpeed = source.speed ?? 1;
      const a = lo - source.timelineInMs, b = hi - source.timelineInMs;
      const sourceTime = t => sourceSpeed < 0 ? source.sourceOutMs + t * sourceSpeed : source.sourceInMs + t * sourceSpeed;
      const from = sourceTime(a), to = sourceTime(b);
      Object.assign(copy, { id: uuid(), sourceInMs: sourceSpeed === 0 ? source.sourceInMs : Math.min(from, to), sourceOutMs: sourceSpeed === 0 ? source.sourceOutMs : Math.max(from, to), speed: sourceSpeed * speed,
        timelineInMs: clip.timelineInMs + (speed > 0 ? lo - begin : end - hi) / scale,
        timelineOutMs: clip.timelineInMs + (speed > 0 ? hi - begin : end - lo) / scale,
        keyframes: remapKeyframes(source, a, b, speed, uuid) });
      // Curve subdivision and absolute timeline addition can differ by ~1e-11 ms.
      // Clamp to the actual destination duration before the strict command guard.
      copy.keyframes = copy.keyframes.map(k => ({ ...k, timeMs: Math.max(0, Math.min(copy.timelineOutMs - copy.timelineInMs, k.timeMs)) }));
      if (!Number.isFinite(source.sourceInMs) || !Number.isFinite(source.sourceOutMs)) {
        delete copy.sourceInMs; delete copy.sourceOutMs;
        if (source.speed === undefined) delete copy.speed;
      }
      const duration = source.timelineOutMs - source.timelineInMs;
      if ((a > 0 && a < (source.fadeInMs || 0)) || (b < duration && b > duration - (source.fadeOutMs || 0))) throw new Error('Điểm cắt nằm trong fade; điều chỉnh fade trước khi bung clip lồng.');
      const fadeIn = a === 0 ? (source.fadeInMs || 0) / scale : 0;
      const fadeOut = b === duration ? (source.fadeOutMs || 0) / scale : 0;
      if (source.fadeInMs !== undefined || source.fadeOutMs !== undefined) Object.assign(copy, { fadeInMs: speed > 0 ? fadeIn : fadeOut, fadeOutMs: speed > 0 ? fadeOut : fadeIn });
      if ((a > 0 && a < (source.audioFadeInMs || 0)) || (b < duration && b > duration - (source.audioFadeOutMs || 0))) throw new Error('Điểm cắt nằm trong fade âm thanh; điều chỉnh fade trước khi bung clip lồng.');
      const audioIn = a === 0 ? (source.audioFadeInMs || 0) / scale : 0;
      const audioOut = b === duration ? (source.audioFadeOutMs || 0) / scale : 0;
      if (source.audioFadeInMs !== undefined || source.audioFadeOutMs !== undefined) Object.assign(copy, { audioFadeInMs: speed > 0 ? audioIn : audioOut, audioFadeOutMs: speed > 0 ? audioOut : audioIn });
      if ((a > 0 && a < (source.videoFadeInMs || 0)) || (b < duration && b > duration - (source.videoFadeOutMs || 0))) throw new Error('Điểm cắt nằm trong fade hình ảnh; điều chỉnh fade trước khi bung clip lồng.');
      const videoIn = a === 0 ? (source.videoFadeInMs || 0) / scale : 0;
      const videoOut = b === duration ? (source.videoFadeOutMs || 0) / scale : 0;
      if (source.videoFadeInMs !== undefined || source.videoFadeOutMs !== undefined) Object.assign(copy, { videoFadeInMs: speed > 0 ? videoIn : videoOut, videoFadeOutMs: speed > 0 ? videoOut : videoIn });
      if (source.groupId) { if (!groupMap.has(source.groupId)) groupMap.set(source.groupId, uuid()); copy.groupId = groupMap.get(source.groupId); }
      idMap.set(source.id, copy.id); clips.push(copy);
    }
    if (clips.length) newTracks.push({ ...nestedTrack, id: uuid(), order: order += orderStep, locked: false, muted: track.muted || nestedTrack.muted || false, visible: track.visible !== false && nestedTrack.visible !== false, clips: clips.sort((a, b) => a.timelineInMs - b.timelineInMs) });
  }
  const newTransitions = (nested.transitions || []).filter(t => idMap.has(t.fromClipId) && idMap.has(t.toClipId)).map(t => ({ ...t, id: uuid(), fromClipId: idMap.get(speed > 0 ? t.fromClipId : t.toClipId), toClipId: idMap.get(speed > 0 ? t.toClipId : t.fromClipId), durationMs: t.durationMs / scale }));
  return { trackId, index, clip, newTracks, newTransitions };
}
module.exports = { planCompoundUnpack, remapKeyframes };
