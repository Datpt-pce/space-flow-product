const path = require('path');
const fs = require('fs');
const { itemToPath, pathToItem } = require('../../backend/utils/items');
const { getCredential, applyAuth } = require('../../backend/utils/credentials');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function guessMime(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveImageInput(item, config) {
  const localPath = itemToPath(item, 'image') || config.referenceImagePath || null;
  if (localPath) {
    const base64 = fs.readFileSync(localPath).toString('base64');
    return { type: 'base64', media_type: guessMime(localPath), data: base64 };
  }
  if (item?.json?.imageUrl) return { type: 'url', url: item.json.imageUrl };
  return null;
}

async function uploadAsset(filePath, apiKeyHeaders) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: guessMime(filePath) }), path.basename(filePath));
  const res = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: apiKeyHeaders,
    body: form,
  });
  if (!res.ok) throw new Error(`HeyGen Lip-Sync: upload asset lỗi HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const assetId = json?.data?.asset_id;
  if (!assetId) throw new Error('HeyGen Lip-Sync: upload asset không trả về asset_id');
  return assetId;
}

async function resolveAudioInput(item, apiKeyHeaders) {
  const localPath = itemToPath(item, 'audio');
  if (localPath) {
    const assetId = await uploadAsset(localPath, apiKeyHeaders);
    return { audio_asset_id: assetId };
  }
  if (item?.json?.audioUrl) return { audio_url: item.json.audioUrl };
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollVideo(videoId, apiKeyHeaders, pollIntervalMs, pollTimeoutMs) {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.heygen.com/v3/videos/${videoId}`, { headers: apiKeyHeaders });
    if (!res.ok) throw new Error(`HeyGen Lip-Sync: poll lỗi HTTP ${res.status}`);
    const { data } = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed') {
      throw new Error(`HeyGen Lip-Sync: video failed (${data.failure_code || 'unknown'}): ${data.failure_message || 'không rõ lý do'}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`HeyGen Lip-Sync: timeout chờ video sau ${pollTimeoutMs}ms`);
}

module.exports = async function execute(inputs, config, context) {
  const scenes = inputs.items || [];
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const outDir = path.join(context.uploadsDir, 'heygen-lipsync', context.nodeId);
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
  const apiKeyHeaders = {};
  applyAuth(credential, { headers: apiKeyHeaders, qs: {} });

  for (let i = startAt; i < total; i++) {
    const item = scenes[i];
    const image = resolveImageInput(item, config);
    if (!image) throw new Error(`HeyGen Lip-Sync: scene ${i} thiếu ảnh tham chiếu (binary.image/json.imageUrl hoặc config.referenceImagePath)`);
    const audio = await resolveAudioInput(item, apiKeyHeaders);
    if (!audio) throw new Error(`HeyGen Lip-Sync: scene ${i} thiếu audio (binary.audio hoặc json.audioUrl)`);

    const submitRes = await fetch('https://api.heygen.com/v3/videos', {
      method: 'POST',
      headers: { ...apiKeyHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image',
        image,
        ...audio,
        resolution: config.resolution || '1080p',
        aspect_ratio: config.aspectRatio || 'auto',
      }),
    });
    if (!submitRes.ok) {
      throw new Error(`HeyGen Lip-Sync: submit scene ${i} lỗi HTTP ${submitRes.status}: ${await submitRes.text()}`);
    }
    const submitJson = await submitRes.json();
    const videoId = submitJson?.data?.video_id || submitJson?.data?.id;
    if (!videoId) throw new Error(`HeyGen Lip-Sync: response /v3/videos không có video_id (scene ${i})`);

    const videoData = await pollVideo(videoId, apiKeyHeaders, config.pollIntervalMs || 3000, config.pollTimeoutMs || 300000);
    if (!videoData.video_url) throw new Error(`HeyGen Lip-Sync: video completed nhưng không có video_url (scene ${i})`);

    const fileRes = await fetch(videoData.video_url);
    if (!fileRes.ok) throw new Error(`HeyGen Lip-Sync: tải video scene ${i} lỗi HTTP ${fileRes.status}`);
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
