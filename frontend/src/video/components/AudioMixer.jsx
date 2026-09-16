import { useEffect, useRef, useState } from 'react';
import { previewUrl } from '../../lib/api.js';
import { clipToSourceSeconds } from '../canvasEngine.js';

function AudioClip({ clip, asset, timeMs, playing, context, monitorVolume }) {
  const ref = useRef(null);
  const gainRef = useRef(null);
  const sourceRef = useRef(null);
  const latest = useRef({ clip, timeMs }); latest.current = { clip, timeMs };
  useEffect(() => {
    if (!context || !ref.current) return undefined;
    const source = sourceRef.current || (sourceRef.current = context.createMediaElementSource(ref.current));
    const gain = context.createGain();
    const channel = clip.audioChannel || 'none';
    let splitter, merger;
    if (channel === 'left' || channel === 'right') {
      splitter = context.createChannelSplitter(2); merger = context.createChannelMerger(2);
      source.connect(splitter); const selected = channel === 'left' ? 0 : 1;
      splitter.connect(merger, selected, 0); splitter.connect(merger, selected, 1); merger.connect(gain);
    } else if (channel === 'mono') {
      gain.channelCount = 1; gain.channelCountMode = 'explicit'; source.connect(gain);
    } else source.connect(gain);
    gain.connect(context.destination); gainRef.current = gain;
    return () => { source.disconnect(); splitter?.disconnect(); merger?.disconnect(); gain.disconnect(); gainRef.current = null; };
  }, [context, clip.audioChannel]);
  const localMs = timeMs - clip.timelineInMs;
  const remainingMs = clip.timelineOutMs - timeMs;
  const fadeIn = clip.audioFadeInMs > 0 ? Math.min(1, localMs / clip.audioFadeInMs) : 1;
  const fadeOut = clip.audioFadeOutMs > 0 ? Math.min(1, remainingMs / clip.audioFadeOutMs) : 1;
  const volume = Math.max(0, Math.min(10, clip.volume ?? 1)) * fadeIn * fadeOut * monitorVolume;
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
    else if (ref.current) ref.current.volume = Math.min(1, volume);
  }, [volume, context, clip.audioChannel]);
  useEffect(() => {
    const audio = ref.current;
    const target = Math.max(0, clipToSourceSeconds(clip, timeMs));
    if (audio && (!playing || Math.abs(audio.currentTime - target) > .15)) audio.currentTime = target;
  }, [timeMs, clip, playing]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return undefined;
    audio.playbackRate = Math.min(16, Math.max(.0625, clip.speed || 1));
    audio.preservesPitch = clip.preservePitch !== false;
    if (playing) {
      context?.resume().catch(() => {});
      audio.play().catch(() => {});
    } else audio.pause();
    return () => audio.pause();
  }, [playing, clip.speed, clip.preservePitch, context]);
  return <audio ref={ref} src={asset.proxyUrl || previewUrl(asset.sourcePath)} preload="auto" data-preview-clip={clip.id} data-preview-gain={volume} onLoadedMetadata={() => { const current = latest.current; ref.current.currentTime = Math.max(0, clipToSourceSeconds(current.clip, current.timeMs)); }} />;
}
export default function AudioMixer({ projectState, assets, playheadMs, isPlaying, previewVolume }) {
  const [context, setContext] = useState(null);
  useEffect(() => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return undefined;
    const audioContext = new Context(); audioContext.previewId = crypto.randomUUID(); setContext(audioContext);
    return () => { audioContext.close().catch(() => {}); };
  }, []);
  const clips = (projectState?.tracks || []).filter(t => !t.muted && (t.type === 'audio' || t.type === 'video')).flatMap(t => t.clips)
    .filter(c => (c.speed ?? 1) > 0 && c.timelineInMs <= playheadMs && c.timelineOutMs > playheadMs);
  return <div hidden>{clips.map(clip => {
    const asset = assets.find(a => a.id === clip.assetId);
    if (!asset || asset.status !== 'ok' || (asset.kind !== 'audio' && !asset.codecAudio)) return null;
    return <AudioClip key={`${clip.id}:${context?.previewId || 'initial'}`} clip={clip} asset={asset} timeMs={playheadMs} playing={isPlaying} context={context} monitorVolume={previewVolume} />;
  })}</div>;
}
