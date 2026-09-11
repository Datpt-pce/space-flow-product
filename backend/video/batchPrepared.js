const { planCompoundUnpack } = require('../../shared/video-compound');
const { renderCapabilityIssues } = require('./renderQc');

function preparedIssues(document) {
  const reasons = [];
  if (document.transitions?.length) reasons.push('Prepared có transition nội bộ.');
  if (document.tracks.some(t => t.clips.some(c => c.compoundRef))) reasons.push('Prepared lồng quá một cấp; cần proxy để giữ công thức lồng.');
  if (document.tracks.some(t => t.clips.some(c => c.maskAssetId))) reasons.push('Prepared có mask media ngoài; cần proxy.');
  if (document.tracks.some(t => !['video', 'audio', 'image', 'sticker'].includes(t.type))) reasons.push('Prepared chứa track ngoài subset bung lossless.');
  return reasons;
}

function expandPrepared(parent, trackId, clipId, prepared, slot, frameMs) {
  const reasons = preparedIssues(prepared);
  if (reasons.length) throw new Error(`Cần render trung gian: ${reasons.join(' ')}`);
  if (parent.fps !== prepared.fps) throw new Error('Prepared khác FPS; cần proxy theo canvas/FPS đích.');
  const duration = Math.max(0, ...prepared.tracks.flatMap(t => t.clips.map(c => c.timelineOutMs)));
  const placeholder = parent.tracks.find(t => t.id === trackId).clips.find(c => c.id === clipId);
  if (placeholder.sourceOutMs > duration + .01) throw new Error('Prepared quá ngắn cho block.');
  let next = 0;
  let result;
  try { result = planCompoundUnpack(parent, trackId, clipId, prepared, () => `${clipId}-prepared-${next++}`); }
  catch(e) { throw new Error(`Cần render trung gian: ${e.message}`); }
  for (const t of result.newTracks) for (const clip of t.clips) {
    if (slot.muteSourceAudio) clip.volume = 0;
    else if (slot.volume !== undefined) clip.volume = (clip.volume ?? 1) * slot.volume;
    const frames = Math.floor((clip.timelineOutMs - clip.timelineInMs + .001) / frameMs);
    const defaultFade = Math.min(Math.round(500 / frameMs), Math.floor(frames / 2));
    const fadeIn = slot.fadeInFrames ?? (clip.audioFadeInMs !== undefined ? clip.audioFadeInMs / frameMs : defaultFade);
    const fadeOut = slot.fadeOutFrames ?? (clip.audioFadeOutMs !== undefined ? clip.audioFadeOutMs / frameMs : defaultFade);
    if (fadeIn + fadeOut > frames + .001) throw new Error('Fade của prepared vượt độ dài clip sau khi bung.');
    clip.audioFadeInMs = fadeIn * frameMs; clip.audioFadeOutMs = fadeOut * frameMs;
  }
  const issues = renderCapabilityIssues({ tracks: result.newTracks });
  if (issues.length) throw new Error(issues.map(i => i.message).join(' '));
  return result;
}
module.exports = { preparedIssues, expandPrepared };
