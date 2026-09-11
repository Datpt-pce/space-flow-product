// 08-UI §6.4 Priority 0 bước 2: waveform thật cho audio clip trên Timeline — không có sẵn ở backend
// (chỉ video mới được ffmpeg-thumbnail lúc import, xem backend/routes/video-assets.js), nên decode
// client-side qua Web Audio API. Cache theo assetId, module-level, ephemeral (mất khi reload — coi
// như UI-state, giống lý do useResizablePanel.js chỉ lưu size chứ không lưu gì nặng hơn).
import { previewUrl, fetchVideoWaveform } from '../lib/api.js';

const PEAK_BUCKETS = 4096;
const cache = new Map(); // assetId -> Float32Array(PEAK_BUCKETS) [-1..1] biên độ tuyệt đối, hoặc 'error'
const inflight = new Map(); // assetId -> Promise

function computePeaks(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const bucketSize = Math.max(1, Math.floor(length / PEAK_BUCKETS));
  const peaks = new Float32Array(PEAK_BUCKETS);
  const channelData = [];
  for (let c = 0; c < channelCount; c++) channelData.push(audioBuffer.getChannelData(c));
  for (let bucket = 0; bucket < PEAK_BUCKETS; bucket++) {
    const start = bucket * bucketSize;
    const end = Math.min(length, start + bucketSize);
    let max = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = channelData[c];
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]);
        if (abs > max) max = abs;
      }
    }
    peaks[bucket] = max;
  }
  return peaks;
}

// getPeaks(assetId, sourcePath) -> Float32Array | null (null = đang decode hoặc lỗi, gọi lại sau/
// component tự re-render khi promise resolve qua state riêng của caller — hàm này KHÔNG tự trigger
// re-render, caller (Timeline.jsx) chịu trách nhiệm gọi trong useEffect + setState khi resolve).
export function getPeaks(assetId, sourcePath) {
  const cached = cache.get(assetId);
  if (cached) return cached === 'error' ? null : cached;
  if (!inflight.has(assetId)) {
    const promise = fetch(previewUrl(sourcePath))
      .then((res) => res.arrayBuffer())
      .then((buf) => {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        return ctx.decodeAudioData(buf).finally(() => ctx.close());
      })
      .then((audioBuffer) => {
        const peaks = computePeaks(audioBuffer);
        cache.set(assetId, peaks);
        return peaks;
      })
      .catch(async () => {
        const result = await fetchVideoWaveform(assetId);
        const peaks = Float32Array.from(result.peaks);
        cache.set(assetId, peaks);
        return peaks;
      })
      .catch(() => {
        cache.set(assetId, 'error');
        return null;
      })
      .finally(() => inflight.delete(assetId));
    inflight.set(assetId, promise);
  }
  return null;
}

// subscribePeaks(assetId, sourcePath, onReady) -> void — thin wrapper cho component: gọi onReady
// đúng 1 lần khi peaks sẵn sàng (kể cả khi lấy từ cache đồng bộ, qua Promise.resolve để giữ hành vi
// async nhất quán, tránh setState ngay trong render).
export function subscribePeaks(assetId, sourcePath, onReady) {
  const cached = cache.get(assetId);
  if (cached) { Promise.resolve().then(() => onReady(cached === 'error' ? null : cached)); return; }
  getPeaks(assetId, sourcePath);
  const promise = inflight.get(assetId);
  if (promise) promise.then(onReady);
}
