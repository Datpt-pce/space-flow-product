// Ordered visual composition with one replaceable pending draw request.
// Persistent decoder iterators predecode sequential playback; random scrubs
// seek once, coalescing superseded requests. Inputs are released when inactive.
import { Input, ALL_FORMATS, UrlSource, VideoSampleSink } from 'mediabunny';
import { computeCanvasPlacement, normalizedCropFor, isIdentityCrop } from '@shared/video-transform';
import { evaluateClipTransform } from '@shared/video-keyframes';
import { blendModeFor, previewFilterFor } from './timelineUtils.js';
import { processMediaPixels, prepareMediaMask } from './mediaPixels.js';
import { blendTransition } from './transitionPreview.js';

export function isCanvasEngineSupported() {
  return typeof window !== 'undefined' && typeof window.HTMLCanvasElement === 'function';
}

// Phase 8 (Core Parity, §0): speed can be negative (reverse) or 0 (freeze-frame), not just
// positive. `?? 1`, not `|| 1` — 0 is a real, meaningful speed value here, not "unset".
// - speed > 0: source advances FORWARD from sourceInMs, `elapsed*speed` faster/slower than 1x.
// - speed < 0: source advances BACKWARD from sourceOutMs (the origin flips) — `elapsed*speed` is
//   negative for elapsed>=0, so sourceOutMs+elapsed*speed correctly decreases toward sourceInMs.
// - speed === 0: constant at sourceInMs regardless of elapsed — a single frozen frame.
// Clamped into [sourceInMs, sourceOutMs] to absorb float noise right at a clip's own boundary.
export function clipToSourceSeconds(clip, playheadMs) {
  const speed = clip.speed ?? 1;
  if (speed === 0) return clip.sourceInMs / 1000;
  const elapsedMs = (playheadMs - clip.timelineInMs) * speed;
  const originMs = speed > 0 ? clip.sourceInMs : clip.sourceOutMs;
  const sourceMs = originMs + elapsedMs;
  return Math.min(clip.sourceOutMs, Math.max(clip.sourceInMs, sourceMs)) / 1000;
}

// findActiveVideoClips -> every visible video track's clip active at playheadMs, sorted by
// track.order ascending (drawn bottom-to-top).
export function findActiveVideoClips(projectState, playheadMs) {
  if (!projectState) return [];
  const tracks = projectState.tracks
    .filter((t) => ['video', 'image', 'sticker', 'text', 'shape'].includes(t.type) && t.visible)
    .sort((a, b) => a.order - b.order);
  const result = [];
  for (const track of tracks) {
    const clip = track.clips.find((c) => playheadMs >= c.timelineInMs && playheadMs < c.timelineOutMs);
    if (clip) result.push(clip);
  }
  return result;
}

// findActiveStickerClips -> every visible 'sticker' track's clip active at playheadMs, sorted by
// track.order ascending (Phase 14, §0). NOT drawn by CanvasEngine (no video decode involved — a
// sticker's asset is a still image, not a video stream mediabunny's VideoSampleSink can seek into)
// — Player.jsx's StickerOverlay renders these as a DOM `<img>` overlay instead, the same "DOM
// overlay approximation" precedent Phase 13's CaptionOverlay already established for text.
export function findActiveStickerClips(projectState, playheadMs) {
  if (!projectState) return [];
  const tracks = projectState.tracks
    .filter((t) => t.type === 'sticker' && t.visible)
    .sort((a, b) => a.order - b.order);
  const result = [];
  for (const track of tracks) {
    const clip = track.clips.find((c) => playheadMs >= c.timelineInMs && playheadMs < c.timelineOutMs);
    if (clip) result.push(clip);
  }
  return result;
}

// findAudioSourceClip -> the clip whose audio should drive playback: an active (unmuted) audio-
// track clip if one exists, else the first active video-track clip's own muxed audio — mirrors
// backend/video/renderPlanner.js's own fallback decision, for the same reason: Timeline.jsx only
// lets a user drop an asset onto a track matching its kind, so there's no way to route a video
// clip's audio onto the audio track by hand.
//
// Phase 8: a video clip with speed===0 (freeze-frame) is EXCLUDED from that fallback — its own
// audio is a single held instant, not something a native <audio> element can meaningfully play as
// a real-time clock (and export mutes freeze-frame clips' audio entirely for the same reason, see
// backend/video/renderPlanner.js). If every visible video clip at this playhead is frozen and no
// dedicated audio-track clip exists, there is no clock source at this instant — Play has no effect
// there (still fully scrubbable/frame-steppable, see Player.jsx), a documented limitation rather
// than a silent bug, same class of tradeoff Phase 5 already accepted for the playback loop itself.
export function findAudioSourceClip(projectState, playheadMs) {
  if (!projectState) return null;
  const audioTracks = projectState.tracks
    .filter((t) => t.type === 'audio' && !t.muted)
    .sort((a, b) => a.order - b.order);
  for (const track of audioTracks) {
    const clip = track.clips.find((c) => playheadMs >= c.timelineInMs && playheadMs < c.timelineOutMs);
    if (clip) return clip;
  }
  const activeVideoClips = findActiveVideoClips(projectState, playheadMs);
  return activeVideoClips.find((c) => (c.speed ?? 1) !== 0) || null;
}

async function drawSample(sample, ctx, transform, resolution, compositeOperation, colorGradeFilter, crop, sourceSize, clip, scratch) {
  const placement = computeCanvasPlacement(transform, resolution, sourceSize || { width: sample.displayWidth, height: sample.displayHeight }, crop);
  const { destX, destY, destWidth, destHeight, opacity, rotationDeg } = placement;
  if (clip.background?.mode === 'color') {
    ctx.fillStyle = clip.background.color || '#000000'; ctx.fillRect(0, 0, resolution.width, resolution.height);
  } else if (clip.background?.mode === 'blur') {
    const cover = Math.max(resolution.width / sample.displayWidth, resolution.height / sample.displayHeight) * 1.08;
    const w = sample.displayWidth * cover, h = sample.displayHeight * cover;
    ctx.save(); ctx.filter = 'blur(20px)';
    sample.draw(ctx, (resolution.width - w) / 2, (resolution.height - h) / 2, w, h); ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = compositeOperation;
  ctx.filter = colorGradeFilter || 'none'; // Phase 11 — see colorGradeFilterFor()'s own comment for what's approximated vs. skipped
  if (rotationDeg) {
    // 08-G G3 rotation pivot (ADR 0035): pivotX/pivotY (0-1 fraction of the box, default 0.5/0.5 =
    // center — read straight off `transform`, not `placement`, since computeCanvasPlacement()
    // deliberately never touches pivot at all, see that file's own header comment) replace the
    // hardcoded `/2` — Canvas2D can rotate around ANY point by construction, so this is the ENTIRE
    // preview-side change; no new technique needed (unlike the export side's pad/crop workaround).
    const pivotX = transform.pivotX ?? 0.5;
    const pivotY = transform.pivotY ?? 0.5;
    const cx = destX + destWidth * pivotX;
    const cy = destY + destHeight * pivotY;
    ctx.translate(cx, cy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  // 08-G G3 crop/mask (2026-09-04): crop is a SOURCE-space sub-rect (normalized 0-1 fractions of
  // the decoded sample's own displayWidth/displayHeight — see shared/video-transform.js's
  // normalizedCropFor()) — VideoSample.draw()'s 8-arg overload (source rect + dest rect) does the
  // crop-then-contain in one native call, same op backend/video/renderPlanner.js's `crop=`
  // then `scale=` filter pair performs at export. Skipped for identity crop (common case) to keep
  // the exact same 4-arg call every pre-crop clip already used.
  if ((clip.mask && clip.mask.enabled !== false) || (clip.effects || []).some(effect => effect.type === 'chromaKey' && effect.enabled)) {
    const factor = Math.min(1, 1280 / Math.max(destWidth, destHeight));
    scratch.width = Math.max(2, Math.round(destWidth * factor)); scratch.height = Math.max(2, Math.round(destHeight * factor));
    sample.draw(scratch.getContext('2d', { willReadFrequently: true }), crop.x * sample.displayWidth, crop.y * sample.displayHeight,
      crop.width * sample.displayWidth, crop.height * sample.displayHeight, 0, 0, scratch.width, scratch.height);
    processMediaPixels(scratch, clip, await prepareMediaMask(clip, scratch.width, scratch.height));
    ctx.drawImage(scratch, destX, destY, destWidth, destHeight);
  } else if (crop && !isIdentityCrop(crop)) {
    const sx = crop.x * sample.displayWidth;
    const sy = crop.y * sample.displayHeight;
    const sWidth = crop.width * sample.displayWidth;
    const sHeight = crop.height * sample.displayHeight;
    sample.draw(ctx, sx, sy, sWidth, sHeight, destX, destY, destWidth, destHeight);
  } else {
    sample.draw(ctx, destX, destY, destWidth, destHeight);
  }
  ctx.restore();
}

// CanvasEngine caches one decoder/sink PER PROXY URL (opening an Input/track is real I/O, not
// free) and reuses it across every seek/redraw for that asset. One instance per Player mount,
// disposed on unmount.
export class CanvasEngine {
  constructor() {
    this.tracks = new Map(); // proxyUrl -> { input, videoTrack, sink, lastSample }
    // Invalidate decoded/painted work when the engine is disposed.
    this.renderToken = 0;
    this.pendingTracks = new Map();
    this.images = new Map();
    this.disposed = false;
    this.pendingDraw = null;
    this.drawing = null;
    this.stats = { requested: 0, painted: 0, coalesced: 0, decodeMs: [], paintMs: [] };
    this.scratch = document.createElement('canvas');
    this.transitionBuffers = null;
  }

  async getTrack(url, key = url) {
    let entry = this.tracks.get(key);
    if (entry) return entry;
    if (this.pendingTracks.has(key)) return this.pendingTracks.get(key);
    const pending = (async () => {
      if (typeof window.VideoDecoder !== 'function') {
        const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { video.onloadedmetadata = video.onerror = null; reject(new Error('Không tải được video preview')); }, 15000);
            video.onloadedmetadata = () => { clearTimeout(timeout); video.onloadedmetadata = video.onerror = null; resolve(); };
            video.onerror = () => { clearTimeout(timeout); video.onloadedmetadata = video.onerror = null; reject(new Error('Không đọc được video preview')); };
            video.src = url;
          });
          entry = { video, input: { dispose() { video.pause(); video.removeAttribute('src'); video.load(); } } };
          if (this.disposed) { entry.input.dispose(); return null; }
          this.tracks.set(key, entry); return entry;
        } finally { this.pendingTracks.delete(key); }
      }
      const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      try {
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack || this.disposed) { input.dispose(); return null; }
        entry = { input, videoTrack, sink: new VideoSampleSink(videoTrack), lastSample: null };
        this.tracks.set(key, entry);
        return entry;
      } catch (error) { input.dispose(); throw error; }
      finally { this.pendingTracks.delete(key); }
    })();
    this.pendingTracks.set(key, pending);
    return pending;
  }

  // drawActiveClips(ctx, entries, playheadMs, resolution) -> entries is [{ clip, proxyUrl }],
  // already resolved by the caller (clip.assetId -> asset.proxyUrl) and filtered to what's active.
  drawActiveClips(ctx, entries, playheadMs, resolution) {
    if (this.disposed) return Promise.resolve();
    this.stats.requested++;
    if (this.pendingDraw) this.stats.coalesced++;
    this.pendingDraw = { ctx, entries, playheadMs, resolution };
    if (!this.drawing) this.drawing = this.drainDraws().finally(() => { this.drawing = null; });
    return this.drawing;
  }

  async sampleAt(entry, seconds) {
    if (entry.video) {
      const video = entry.video, target = Math.max(0, Math.min(seconds, video.duration - .001));
      if (video.readyState < 2 || Math.abs(video.currentTime - target) > .001) await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('loadeddata', done); video.removeEventListener('error', fail); };
        const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('Không seek được video preview')); };
        const timeout = setTimeout(fail, 10000);
        video.addEventListener('seeked', done, { once: true }); video.addEventListener('loadeddata', done, { once: true }); video.addEventListener('error', fail, { once: true });
        video.currentTime = target;
      });
      const frame = document.createElement('canvas'); frame.width = video.videoWidth; frame.height = video.videoHeight;
      frame.getContext('2d').drawImage(video, 0, 0);
      return { displayWidth: frame.width, displayHeight: frame.height, draw: (ctx, ...args) => ctx.drawImage(frame, ...args), close() { frame.width = frame.height = 0; } };
    }
    const current = entry.decodedSample;
    if (current && seconds >= current.timestamp && seconds < current.timestamp + current.duration) return current.clone();
    const sequential = current && seconds >= current.timestamp && seconds - (entry.lastSeconds ?? seconds) < 0.25;
    entry.lastSeconds = seconds;
    if (!sequential) {
      await entry.iterator?.return(); entry.iterator = null;
      entry.nextSample?.close(); entry.nextSample = null;
      entry.decodedSample?.close(); entry.decodedSample = await entry.sink.getSample(seconds);
      return entry.decodedSample?.clone() || null;
    }
    // A persistent iterator decodes ahead once per packet, instead of seeking
    // back to the nearest keyframe for every display refresh.
    entry.iterator ||= entry.sink.samples(current.timestamp + current.duration);
    while (!this.disposed) {
      const next = entry.nextSample || (await entry.iterator.next()).value;
      entry.nextSample = null;
      if (!next) break;
      if (next.timestamp > seconds) { entry.nextSample = next; break; }
      entry.decodedSample?.close(); entry.decodedSample = next;
      if (seconds < next.timestamp + next.duration) break;
    }
    return entry.decodedSample?.clone() || null;
  }

  releaseTrack(entry) {
    entry.lastSample?.close(); entry.decodedSample?.close(); entry.nextSample?.close();
    entry.iterator?.return().catch(() => {});
    entry.input.dispose();
  }

  async drainDraws() {
    while (this.pendingDraw && !this.disposed) {
      const request = this.pendingDraw;
      this.pendingDraw = null;
      await this.drawFrame(request.ctx, request.entries, request.playheadMs, request.resolution);
    }
  }

  async drawFrame(ctx, entries, playheadMs, resolution) {
    const token = ++this.renderToken;
    if (ctx.canvas.width !== resolution.width) ctx.canvas.width = resolution.width;
    if (ctx.canvas.height !== resolution.height) ctx.canvas.height = resolution.height;

    const draws = [];
    const started = performance.now();
    for (const { clip, proxyUrl, kind, transition, sampleTimeMs = playheadMs } of entries) {
      if (!proxyUrl) continue;
      let trackEntry = null;
      let sample;
      if (kind === 'image') {
        if (!this.images.has(proxyUrl)) this.images.set(proxyUrl, (async () => {
          const image = new Image(); image.src = proxyUrl; await image.decode(); return image;
        })());
        const image = await this.images.get(proxyUrl);
        sample = { displayWidth: image.naturalWidth, displayHeight: image.naturalHeight,
          draw: (context, ...args) => context.drawImage(image, ...args), close() {} };
      } else {
        // Adjacent clips may reuse the same asset at different source times.
        // Separate cursors avoid seeking one decoder back and forth each frame.
        trackEntry = await this.getTrack(proxyUrl, clip.id ? `${clip.id}:${proxyUrl}` : proxyUrl);
        if (!trackEntry) continue;
        const sourceSeconds = Math.max(0, clipToSourceSeconds(clip, sampleTimeMs));
        sample = await this.sampleAt(trackEntry, sourceSeconds);
      }
      if (this.disposed || token !== this.renderToken) { sample?.close(); continue; }
      if (!sample) continue;
      // Phase 7: effective transform at THIS playhead position, not the clip's static base —
      // evaluateClipTransform() is a no-op passthrough of clip.transform for a clip with no
      // keyframes, so this is safe for every pre-Phase-7 clip too.
      const transform = evaluateClipTransform(clip, sampleTimeMs - clip.timelineInMs);
      draws.push({ sample, transform, trackEntry, clip, transition, sampleTimeMs });
    }
    this.stats.decodeMs.push(performance.now() - started);
    if (this.stats.decodeMs.length > 300) this.stats.decodeMs.shift();
    if (this.disposed || token !== this.renderToken || (this.pendingDraw && Math.abs(this.pendingDraw.playheadMs - playheadMs) > 100)) {
      for (const d of draws) d.sample.close();
      return;
    }

    const paintStart = performance.now();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, resolution.width, resolution.height);
    const paint = (draw, target, blend = blendModeFor(draw.clip)) => drawSample(draw.sample, target, draw.transform, resolution, blend,
      previewFilterFor(draw.clip, draw.sampleTimeMs), normalizedCropFor(draw.clip), draw.clip.sourceSize, draw.clip, this.scratch);
    for (let i = 0; i < draws.length; i++) {
      const draw = draws[i], next = draws[i + 1];
      if (draw.transition?.side === 0 && next?.transition?.id === draw.transition.id) {
        this.transitionBuffers ||= Array.from({ length: 3 }, () => document.createElement('canvas'));
        const [from, to, mixed] = this.transitionBuffers;
        for (const buffer of this.transitionBuffers) {
          if (buffer.width !== resolution.width) buffer.width = resolution.width;
          if (buffer.height !== resolution.height) buffer.height = resolution.height;
          buffer.getContext('2d').clearRect(0, 0, buffer.width, buffer.height);
        }
        await paint(draw, from.getContext('2d'), 'source-over');
        await paint(next, to.getContext('2d'), 'source-over');
        blendTransition(mixed.getContext('2d'), from, to, draw.transition);
        ctx.save(); ctx.globalCompositeOperation = blendModeFor(draw.clip); ctx.drawImage(mixed, 0, 0); ctx.restore();
        i++;
      } else await paint(draw, ctx);
    }
    // Samples are owned by this frame; decoder caches hold their own clones.
    for (const draw of draws) draw.sample.close();
    this.stats.painted++;
    this.stats.paintMs.push(performance.now() - paintStart);
    if (this.stats.paintMs.length > 300) this.stats.paintMs.shift();
    // Keep only active decoder inputs; a long timeline must not retain every
    // previously visited video and its network buffers indefinitely.
    const activeUrls = new Set(entries.map(entry => entry.proxyUrl));
    for (const url of this.images.keys()) if (!activeUrls.has(url)) this.images.delete(url);
    const activeTracks = new Set(entries.map(({ clip, proxyUrl }) => clip.id ? `${clip.id}:${proxyUrl}` : proxyUrl));
    for (const [key, entry] of this.tracks) {
      if (!activeTracks.has(key)) { this.releaseTrack(entry); this.tracks.delete(key); }
    }
  }

  dispose() {
    this.disposed = true;
    this.renderToken++;
    this.pendingDraw = null;
    for (const entry of this.tracks.values()) this.releaseTrack(entry);
    this.tracks.clear();
    this.images.clear();
    if (this.transitionBuffers) for (const buffer of this.transitionBuffers) buffer.width = buffer.height = 0;
    this.transitionBuffers = null;
  }
}
