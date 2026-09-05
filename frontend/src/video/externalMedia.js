import { uploadVideoMedia } from '../lib/api.js';
import { useVideoStore } from './store.js';
import { orderForNewTrack } from './timelineUtils.js';

// A browser can attach a thumbnail File to an internal image drag. The editor
// identity wins; only file-only drops belong to the external upload path.
export function isInternalMediaDrag(transfer) {
  return ['application/x-video-asset', 'application/x-video-clip', 'application/x-video-timeline']
    .some(type => Array.from(transfer.types).includes(type));
}

export async function importExternalFiles(files, timeline = null) {
  const imported = [];
  const origin = useVideoStore.getState().project?.id;
  try {
    for (const file of files) {
      useVideoStore.setState({ importingPath: file.name, error: null });
      const asset = await uploadVideoMedia(file);
      if (asset.status !== 'ok') throw new Error(`${file.name}: ${asset.errorMessage || 'Không đọc được media.'}`);
      useVideoStore.setState(s => ({ assets: [asset, ...s.assets.filter(a => a.id !== asset.id)], assetsVersion: s.assetsVersion + 1 }));
      imported.push(asset);
    }
    if (timeline && imported.length) {
      const s = useVideoStore.getState();
      if (s.project?.id !== origin) throw new Error('Đã import media; timeline đang mở đã đổi nên chưa chèn clip.');
      const newTracks = [], insertions = [];
      for (const asset of imported) {
        const track = { id: crypto.randomUUID(), type: asset.kind, clips: [], locked: false, muted: false, visible: true,
          order: orderForNewTrack([...s.projectState.tracks, ...newTracks], asset.kind, timeline.aboveTrackId) };
        const duration = asset.durationMs || 3000;
        newTracks.push(track);
        insertions.push({ trackId: track.id, clip: { id: crypto.randomUUID(), assetId: asset.id,
          sourceInMs: 0, sourceOutMs: duration, timelineInMs: timeline.atMs, timelineOutMs: timeline.atMs + duration,
          speed: 1, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, effects: [], keyframes: [] } });
      }
      s.execute('BulkInsertClips', { newTracks, insertions });
      s.setSelection(insertions.map(i => i.clip.id));
    }
  } catch (error) { useVideoStore.setState({ error: error.message }); }
  finally { useVideoStore.setState({ importingPath: null }); }
  return imported;
}
