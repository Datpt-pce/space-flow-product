const path = require('path');
const fs = require('fs');
const { itemToPath, pathToItem } = require('../../backend/utils/items');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');
const { getLocalServiceUrl } = require('../../backend/utils/localServices');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Same trick as comfyui-lipsync: ComfyUI's /upload/image just writes whatever bytes
// are posted into its input/ folder under the given filename — works for audio too.
async function uploadFile(comfyUrl, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([buffer]), fileName);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`seed-vc: upload "${fileName}" lỗi HTTP ${res.status}`);
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
  throw new Error(`seed-vc: timeout chờ prompt ${promptId} sau ${pollTimeoutMs}ms`);
}

module.exports = async function execute(inputs, config, context) {
  const scenes = inputs.items || [];
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const comfyUrl = (config.comfyUrl || getLocalServiceUrl('comfyui') || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const referenceAudioPath = config.referenceAudioPath;
  if (!referenceAudioPath) throw new Error('seed-vc: thiếu config referenceAudioPath (audio giọng tham chiếu 1-30s)');

  let workflowTemplate;
  try {
    workflowTemplate = JSON.parse(config.workflowJson || '{}');
  } catch (e) {
    throw new Error(`seed-vc: workflowJson không phải JSON hợp lệ (${e.message})`);
  }

  const sourceAudioLoadNodeId = config.sourceAudioLoadNodeId || 'load_source';
  const targetAudioLoadNodeId = config.targetAudioLoadNodeId || 'load_target';
  const audioOutputNodeId = config.audioOutputNodeId || 'save';

  for (const id of [sourceAudioLoadNodeId, targetAudioLoadNodeId, audioOutputNodeId]) {
    if (!workflowTemplate[id]) throw new Error(`seed-vc: node "${id}" không tồn tại trong workflowJson`);
  }

  const pollIntervalMs = config.pollIntervalMs || 3000;
  const pollTimeoutMs = config.pollTimeoutMs || 300000;

  const outDir = path.join(context.uploadsDir, 'seed-vc', context.nodeId);
  fs.mkdirSync(outDir, { recursive: true });

  if (!context.resume) {
    clearCheckpoint(context.uploadsDir, context.nodeId);
  }
  const { completed } = readCheckpoint(context.uploadsDir, context.nodeId);
  const startAt = context.resume ? completed : 0;

  const total = scenes.length;
  const resultItems = [];

  for (let i = 0; i < startAt; i++) {
    const fileName = `scene_${i}.flac`;
    const filePath = path.join(outDir, fileName);
    if (fs.existsSync(filePath)) {
      resultItems.push({
        ...pathToItem(filePath, { mimeType: 'audio/flac', fileName, field: 'audio' }),
        json: { ...scenes[i]?.json, index: i },
      });
    }
  }

  // Reference voice is the same file for every scene — upload it once, lazily
  // (skip the call entirely if resume already covers the whole batch).
  let uploadedTargetName = null;

  for (let i = startAt; i < total; i++) {
    const item = scenes[i];
    const sourceAudioPath = itemToPath(item, 'audio');
    if (!sourceAudioPath) throw new Error(`seed-vc: scene ${i} thiếu audio nguồn (binary.audio)`);

    if (!uploadedTargetName) {
      uploadedTargetName = await uploadFile(comfyUrl, referenceAudioPath, `seedvc_target_${context.nodeId}${path.extname(referenceAudioPath) || '.wav'}`);
    }
    const uploadedSourceName = await uploadFile(comfyUrl, sourceAudioPath, `seedvc_source_${context.nodeId}_${i}${path.extname(sourceAudioPath) || '.wav'}`);

    const promptGraph = JSON.parse(JSON.stringify(workflowTemplate));
    promptGraph[sourceAudioLoadNodeId].inputs.audio = uploadedSourceName;
    promptGraph[targetAudioLoadNodeId].inputs.audio = uploadedTargetName;

    const submitRes = await fetch(`${comfyUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptGraph }),
    });
    if (!submitRes.ok) {
      throw new Error(`seed-vc: submit scene ${i} lỗi HTTP ${submitRes.status}: ${await submitRes.text()}`);
    }
    const submitJson = await submitRes.json();
    const promptId = submitJson.prompt_id;
    if (!promptId) throw new Error(`seed-vc: response /prompt không có prompt_id (scene ${i})`);

    const outputs = await waitForOutputs(comfyUrl, promptId, pollIntervalMs, pollTimeoutMs);
    const nodeOutput = outputs[audioOutputNodeId];
    const audioMeta = nodeOutput?.audio?.[0];
    if (!audioMeta?.filename) throw new Error(`seed-vc: không tìm thấy output audio ở node "${audioOutputNodeId}" (scene ${i})`);

    const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(audioMeta.filename)}&subfolder=${encodeURIComponent(audioMeta.subfolder || '')}&type=${encodeURIComponent(audioMeta.type || 'output')}`;
    const fileRes = await fetch(viewUrl);
    if (!fileRes.ok) throw new Error(`seed-vc: tải file audio scene ${i} lỗi HTTP ${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const fileName = `scene_${i}.flac`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, buffer);

    resultItems.push({
      ...pathToItem(filePath, { mimeType: 'audio/flac', fileName, field: 'audio' }),
      json: { ...item?.json, index: i },
    });
    writeCheckpoint(context.uploadsDir, context.nodeId, i + 1);
    context.progress(Math.round(((i + 1) / total) * 100), `${i + 1}/${total}`);
  }

  clearCheckpoint(context.uploadsDir, context.nodeId);
  return { items: resultItems };
};
