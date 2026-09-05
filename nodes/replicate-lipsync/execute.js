const path = require('path');
const fs = require('fs');
const { itemToPath, pathToItem } = require('../../backend/utils/items');
const { getCredential, applyAuth } = require('../../backend/utils/credentials');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function guessMime(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fileToDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:${guessMime(filePath)};base64,${buf.toString('base64')}`;
}

// Local file (base64 data-URI) wins over a plain URL already in json — matches
// "cloud calls out to whatever's on-canvas" pattern used by the rest of this pipeline.
function resolveVisualInput(item) {
  const localPath = itemToPath(item, 'image') || itemToPath(item, 'video');
  if (localPath) return fileToDataUri(localPath);
  return item?.json?.imageUrl || item?.json?.videoUrl || null;
}

function resolveAudioInput(item) {
  const localPath = itemToPath(item, 'audio');
  if (localPath) return fileToDataUri(localPath);
  return item?.json?.audioUrl || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollPrediction(getUrl, headers, pollIntervalMs, pollTimeoutMs) {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(getUrl, { headers });
    if (!res.ok) throw new Error(`Replicate Lip-Sync: poll lỗi HTTP ${res.status}`);
    const prediction = await res.json();
    if (prediction.status === 'succeeded') return prediction;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate Lip-Sync: prediction ${prediction.status}: ${prediction.error || 'không rõ lý do'}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Replicate Lip-Sync: timeout chờ prediction sau ${pollTimeoutMs}ms`);
}

module.exports = async function execute(inputs, config, context) {
  const scenes = inputs.items || [];
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');
  if (!config.modelVersion) throw new Error('Replicate Lip-Sync: thiếu config modelVersion (chọn model trên replicate.com trước)');

  const visualKey = config.inputVisualKey || 'face';
  const audioKey = config.inputAudioKey || 'audio';
  const extraInput = config.extraInputJson && typeof config.extraInputJson === 'object' ? config.extraInputJson : {};

  const outDir = path.join(context.uploadsDir, 'replicate-lipsync', context.nodeId);
  fs.mkdirSync(outDir, { recursive: true });

  if (!context.resume) {
    clearCheckpoint(context.uploadsDir, context.nodeId);
  }
  const { completed } = readCheckpoint(context.uploadsDir, context.nodeId);
  const startAt = context.resume ? completed : 0;

  const total = scenes.length;
  const resultItems = [];

  for (let i = 0; i < startAt; i++) {
    const fileName = `scene_${i}.mp4`;
    const filePath = path.join(outDir, fileName);
    if (fs.existsSync(filePath)) {
      resultItems.push({
        ...pathToItem(filePath, { mimeType: 'video/mp4', fileName, field: 'video' }),
        json: { ...scenes[i]?.json, index: i },
      });
    }
  }

  const credential = getCredential(config.credentialName, context.userId);
  const authHeaders = { 'Content-Type': 'application/json' };
  applyAuth(credential, { headers: authHeaders, qs: {} });

  for (let i = startAt; i < total; i++) {
    const item = scenes[i];
    const visual = resolveVisualInput(item);
    const audio = resolveAudioInput(item);
    if (!visual) throw new Error(`Replicate Lip-Sync: scene ${i} thiếu ảnh/video tham chiếu (binary.image/video hoặc json.imageUrl/videoUrl)`);
    if (!audio) throw new Error(`Replicate Lip-Sync: scene ${i} thiếu audio (binary.audio hoặc json.audioUrl)`);

    const submitRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        version: config.modelVersion,
        input: { [visualKey]: visual, [audioKey]: audio, ...extraInput },
      }),
    });
    if (!submitRes.ok) {
      throw new Error(`Replicate Lip-Sync: submit scene ${i} lỗi HTTP ${submitRes.status}: ${await submitRes.text()}`);
    }
    const submitJson = await submitRes.json();
    const getUrl = submitJson?.urls?.get || `https://api.replicate.com/v1/predictions/${submitJson.id}`;
    if (!submitJson.id) throw new Error(`Replicate Lip-Sync: response /predictions không có id (scene ${i})`);

    const prediction = await pollPrediction(getUrl, authHeaders, config.pollIntervalMs || 3000, config.pollTimeoutMs || 300000);
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) throw new Error(`Replicate Lip-Sync: prediction thành công nhưng không có output (scene ${i})`);

    const fileRes = await fetch(outputUrl);
    if (!fileRes.ok) throw new Error(`Replicate Lip-Sync: tải output scene ${i} lỗi HTTP ${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const fileName = `scene_${i}.mp4`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, buffer);

    resultItems.push({
      ...pathToItem(filePath, { mimeType: 'video/mp4', fileName, field: 'video' }),
      json: { ...item?.json, index: i },
    });
    writeCheckpoint(context.uploadsDir, context.nodeId, i + 1);
    context.progress(Math.round(((i + 1) / total) * 100), `${i + 1}/${total}`);
  }

  clearCheckpoint(context.uploadsDir, context.nodeId);
  return { items: resultItems };
};
