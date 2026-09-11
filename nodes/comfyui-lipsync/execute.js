const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { itemToPath, pathToItem } = require('../../backend/utils/items');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');
const { getLocalServiceUrl } = require('../../backend/utils/localServices');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function probeDurationSec(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ], { windowsHide: true });
  const sec = parseFloat(stdout.trim());
  if (!Number.isFinite(sec)) throw new Error(`comfyui-lipsync: ffprobe không đọc được duration của ${filePath}`);
  return sec;
}

// ComfyUI's /upload/image endpoint just writes whatever bytes are posted into its
// input/ folder under the given filename — works for audio/video too, not just images
// (verified against server.py's image_upload(), no MIME/extension check).
async function uploadFile(comfyUrl, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([buffer]), fileName);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`comfyui-lipsync: upload "${fileName}" lỗi HTTP ${res.status}`);
  const json = await res.json();
  return json.name;
}

async function waitForOutputs(comfyUrl, promptId, pollIntervalMs, pollTimeoutMs) {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${comfyUrl}/history/${promptId}`);
    if (res.ok) {
      const history = await res.json();
      const entry = history[promptId];
      if (entry && entry.outputs) return entry.outputs;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`comfyui-lipsync: timeout chờ prompt ${promptId} sau ${pollTimeoutMs}ms`);
}

function resolveImagePath(item, config) {
  return itemToPath(item, 'image') || item?.json?.imagePath || config.referenceImagePath || null;
}

module.exports = async function execute(inputs, config, context) {
  const scenes = inputs.items || [];
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const comfyUrl = (config.comfyUrl || getLocalServiceUrl('comfyui') || 'http://127.0.0.1:8188').replace(/\/$/, '');

  let workflowTemplate;
  try {
    workflowTemplate = JSON.parse(config.workflowJson || '{}');
  } catch (e) {
    throw new Error(`comfyui-lipsync: workflowJson không phải JSON hợp lệ (${e.message})`);
  }

  const imageLoadNodeId = config.imageLoadNodeId || 'load_image';
  const audioLoadNodeId = config.audioLoadNodeId || 'load_audio';
  const repeatImageNodeId = config.repeatImageNodeId || 'repeat_image';
  const videoOutputNodeId = config.videoOutputNodeId || 'combine';
  const frameRate = config.frameRate || 24;

  for (const id of [imageLoadNodeId, audioLoadNodeId, videoOutputNodeId]) {
    if (!workflowTemplate[id]) throw new Error(`comfyui-lipsync: node "${id}" không tồn tại trong workflowJson`);
  }

  const pollIntervalMs = config.pollIntervalMs || 3000;
  const pollTimeoutMs = config.pollTimeoutMs || 300000;

  const outDir = path.join(context.uploadsDir, 'comfyui-lipsync', context.nodeId);
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

  for (let i = startAt; i < total; i++) {
    const item = scenes[i];
    const imagePath = resolveImagePath(item, config);
    const audioPath = itemToPath(item, 'audio');
    if (!imagePath) throw new Error(`comfyui-lipsync: scene ${i} thiếu ảnh tham chiếu (binary.image/json.imagePath hoặc config.referenceImagePath)`);
    if (!audioPath) throw new Error(`comfyui-lipsync: scene ${i} thiếu audio (binary.audio)`);

    const durationSec = await probeDurationSec(audioPath);
    const amount = Math.max(1, Math.ceil(durationSec * frameRate));

    const uploadedImageName = await uploadFile(comfyUrl, imagePath, `lipsync_img_${context.nodeId}_${i}${path.extname(imagePath) || '.png'}`);
    const uploadedAudioName = await uploadFile(comfyUrl, audioPath, `lipsync_audio_${context.nodeId}_${i}${path.extname(audioPath) || '.wav'}`);

    const promptGraph = JSON.parse(JSON.stringify(workflowTemplate));
    promptGraph[imageLoadNodeId].inputs.image = uploadedImageName;
    promptGraph[audioLoadNodeId].inputs.audio = uploadedAudioName;
    if (promptGraph[repeatImageNodeId]) promptGraph[repeatImageNodeId].inputs.amount = amount;
    promptGraph[videoOutputNodeId].inputs.frame_rate = frameRate;

    const submitRes = await fetch(`${comfyUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptGraph }),
    });
    if (!submitRes.ok) {
      throw new Error(`comfyui-lipsync: submit scene ${i} lỗi HTTP ${submitRes.status}: ${await submitRes.text()}`);
    }
    const submitJson = await submitRes.json();
    const promptId = submitJson.prompt_id;
    if (!promptId) throw new Error(`comfyui-lipsync: response /prompt không có prompt_id (scene ${i})`);

    const outputs = await waitForOutputs(comfyUrl, promptId, pollIntervalMs, pollTimeoutMs);
    const nodeOutput = outputs[videoOutputNodeId];
    const videoMeta = nodeOutput?.gifs?.[0];
    if (!videoMeta?.filename) throw new Error(`comfyui-lipsync: không tìm thấy output video ở node "${videoOutputNodeId}" (scene ${i})`);

    const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(videoMeta.filename)}&subfolder=${encodeURIComponent(videoMeta.subfolder || '')}&type=${encodeURIComponent(videoMeta.type || 'output')}`;
    const fileRes = await fetch(viewUrl);
    if (!fileRes.ok) throw new Error(`comfyui-lipsync: tải file video scene ${i} lỗi HTTP ${fileRes.status}`);
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
