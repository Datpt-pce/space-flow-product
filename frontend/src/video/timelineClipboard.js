import { orderForNewTrack, getTimelineRows } from './timelineUtils.js';

export function captureClips(state, ids) {
  const selected = new Set(ids);
  const tracks = getTimelineRows(state).filter(r => r.kind === 'track').map(r => r.track).filter(t => t.clips.some(c => selected.has(c.id)))
    .map(t => ({ ...structuredClone(t), clips: structuredClone(t.clips.filter(c => selected.has(c.id))) }));
  return { tracks, transitions: structuredClone((state.transitions || []).filter(t => selected.has(t.fromClipId) && selected.has(t.toClipId))) };
}

export function buildPaste(state, clipboard, atMs, aboveTrackId) {
  if (!clipboard?.tracks.length) return null;
  const start = Math.min(...clipboard.tracks.flatMap(t => t.clips.map(c => c.timelineInMs)));
  const ids = new Map(), groups = new Map();
  const newTracks = [], insertions = [];
  const audioTracks = clipboard.tracks.filter(t => t.type === 'audio');
  const audioBaseOrder = orderForNewTrack(state.tracks, 'audio');
  let targetId = aboveTrackId;
  for (const source of [...clipboard.tracks].reverse()) {
    const track = { ...structuredClone(source), id: crypto.randomUUID(), locked: false, clips: [],
      order: source.type === 'audio' ? audioBaseOrder - audioTracks.indexOf(source) : orderForNewTrack([...state.tracks, ...newTracks], source.type, targetId) };
    newTracks.push(track); if (source.type !== 'audio') targetId = track.id;
    for (const original of source.clips) {
      const clip = structuredClone(original);
      clip.id = crypto.randomUUID(); ids.set(original.id, clip.id);
      if (clip.groupId) { if (!groups.has(clip.groupId)) groups.set(clip.groupId, crypto.randomUUID()); clip.groupId = groups.get(clip.groupId); }
      clip.timelineInMs += atMs - start; clip.timelineOutMs += atMs - start;
      insertions.push({ trackId: track.id, clip });
    }
  }
  const transitions = clipboard.transitions.map(t => ({ ...t, id: crypto.randomUUID(), fromClipId: ids.get(t.fromClipId), toClipId: ids.get(t.toClipId) }));
  return { newTracks, insertions, transitions };
}
