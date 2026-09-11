// A transition occupies the bar centered on the edit; it never ripples other
// clips. Media outside its authored range holds the nearest boundary frame.
import transitionCatalog from '../../../shared/video-transition-catalog.json';
import { transitionWindow } from '@shared/video-transition-timing';
export function previewVisualEntries(project, timeMs) {
  if (!project) return [];
  const byFrom = new Map((project.transitions || []).map(t => [t.fromClipId, t]));
  return project.tracks.filter(t => t.visible !== false && ['video', 'image', 'sticker', 'text', 'shape'].includes(t.type))
    .sort((a, b) => a.order - b.order).flatMap(track => {
      for (const from of track.clips) {
        const transition = byFrom.get(from.id);
        if (!transition || !transitionCatalog.some(t => t.type === (transition.type || 'crossfade')) || !(transition.durationMs > 0)) continue;
        const to = track.clips.find(c => c.id === transition.toClipId);
        if (!to || Math.abs(from.timelineOutMs - to.timelineInMs) > .01) continue;
        const window = transitionWindow(transition, to.timelineInMs, project.fps || 30);
        const start = window.startMs;
        if (timeMs < start || timeMs >= start + window.durationMs) continue;
        const progress = (timeMs - start) / window.durationMs;
        return [from, to].map((clip, side) => ({ clip, transition: { id: transition.id, type: transition.type || 'crossfade', progress, side },
          sampleTimeMs: Math.max(clip.timelineInMs, Math.min(clip.timelineOutMs - 1000 / (project.fps || 30), timeMs)) }));
      }
      const clip = track.clips.find(c => timeMs >= c.timelineInMs && timeMs < c.timelineOutMs);
      return clip ? [{ clip }] : [];
    });
}

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

// Draw two fully composed clip layers into a transparent intermediate first.
// Weighted 'lighter' blends premultiplied RGBA without fading an unrelated
// lower track twice (source-over on each weighted clip would darken overlaps).
export function blendTransition(ctx, from, to, transition) {
  const { width: w, height: h } = ctx.canvas;
  const p = Math.max(0, Math.min(1, transition.progress));
  if (['left', 'right', 'up', 'down', 'clock-wipe'].includes(transition.type)) {
    ctx.save(); ctx.clearRect(0, 0, w, h);
    if (transition.type === 'clock-wipe') {
      ctx.drawImage(from, 0, 0, w, h);
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, Math.hypot(w, h), -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p);
      ctx.closePath(); ctx.clip(); ctx.drawImage(to, 0, 0, w, h);
    } else {
      const dx = transition.type === 'left' ? -1 : transition.type === 'right' ? 1 : 0;
      const dy = transition.type === 'up' ? -1 : transition.type === 'down' ? 1 : 0;
      ctx.drawImage(from, dx * p * w, dy * p * h, w, h);
      ctx.drawImage(to, -dx * (1 - p) * w, -dy * (1 - p) * h, w, h);
    }
    ctx.restore(); return;
  }
  let fromWeight = 1 - p, fromCrop = 1, toCrop = 1;
  if (transition.type === 'pull-in') {
    // FFmpeg zoomin: outgoing center zoom followed by a smooth dissolve.
    fromCrop = Math.max(1 / Math.max(w, h), smooth((1 - p - .5) * 2));
    fromWeight = smooth((1 - p) * 2);
  } else if (transition.type === 'pull-out') toCrop = 1 / (2 - p);
  ctx.save(); ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
  for (const [image, weight, crop] of [[from, fromWeight, fromCrop], [to, 1 - fromWeight, toCrop]]) {
    ctx.globalAlpha = weight;
    ctx.drawImage(image, w * (1 - crop) / 2, h * (1 - crop) / 2, w * crop, h * crop, 0, 0, w, h);
  }
  ctx.restore();
}
