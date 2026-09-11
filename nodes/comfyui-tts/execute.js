const path = require('path');
const fs = require('fs');
const { fromItems, pathToItem } = require('../../backend/utils/items');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');
const { getLocalServiceUrl } = require('../../backend/utils/localServices');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  throw new Error(`ComfyUI TTS: timeout chờ prompt ${promptId} sau ${pollTimeoutMs}ms`);
}

module.exports = async function execute(inputs, config, context) {
  const scenes = fromItems(inputs.items);
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const comfyUrl = (config.comfyUrl || getLocalServiceUrl('comfyui') || 'http://127.0.0.1:8188').replace(/\/$/, '');

  let workflowTemplate;
  try {
    workflowTemplate = JSON.parse(config.workflowJson || '{}');
  } catch (e) {
    throw new Error(`ComfyUI TTS: workflowJson không phải JSON hợp lệ (${e.message})`);
  }

  const textNodeId = config.textNodeId;
  const textInputKey = config.textInputKey || 'text';
  const audioOutputNodeId = config.audioOutputNodeId;
  if (!textNodeId || !workflowTemplate[textNodeId]) {
    throw new Error(`ComfyUI TTS: textNodeId "${textNodeId}" không tồn tại trong workflowJson`);
  }
  if (!audioOutputNodeId) {
    throw new Error('ComfyUI TTS: thiếu config audioOutputNodeId');
  }

  const pollIntervalMs = config.pollIntervalMs || 2000;
  const pollTimeoutMs = config.pollTimeoutMs || 120000;

  const outDir = path.join(context.uploadsDir, 'comfyui-tts', context.nodeId);
  fs.mkdirSync(outDir, { recursive: true });

  if (!context.resume) {
    clearCheckpoint(context.uploadsDir, context.nodeId);
  }
  const { completed } = readCheckpoint(context.uploadsDir, context.nodeId);
  const startAt = context.resume ? completed : 0;

  const total = scenes.length;
  const resultItems = [];

  // Resume path: scenes [0, startAt) already have files on disk from a prior run —
  // re-wrap them so downstream nodes still see the whole batch, not just the new tail.
  for (let i = 0; i < startAt; i++) {
    const fileName = `scene_${i}.wav`;
    const filePath = path.join(outDir, fileName);
    if (fs.existsSync(filePath)) {
      resultItems.push({
        ...pathToItem(filePath, { mimeType: 'audio/wav', fileName, field: 'audio' }),
        json: { ...scenes[i], index: i },
      });
    }
  }

  for (let i = startAt; i < total; i++) {
    const text = scenes[i]?.text || scenes[i]?.dialogue;
    if (!text) throw new Error(`ComfyUI TTS: scene ${i} thiếu field "text"/"dialogue"`);

    const promptGraph = JSON.parse(JSON.stringify(workflowTemplate));
    promptGraph[textNodeId].inputs = promptGraph[textNodeId].inputs || {};
    promptGraph[textNodeId].inputs[textInputKey] = text;

    const submitRes = await fetch(`${comfyUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptGraph }),
    });
    if (!submitRes.ok) {
      throw new Error(`ComfyUI TTS: submit scene ${i} lỗi HTTP ${submitRes.status}`);
    }
    const submitJson = await submitRes.json();
    const promptId = submitJson.prompt_id;
    if (!promptId) throw new Error(`ComfyUI TTS: response /prompt không có prompt_id (scene ${i})`);

    const outputs = await waitForOutputs(comfyUrl, promptId, pollIntervalMs, pollTimeoutMs);
    const nodeOutput = outputs[audioOutputNodeId];
    const audioMeta = nodeOutput?.audio?.[0] || nodeOutput?.files?.[0];
    if (!audioMeta?.filename) {
      throw new Error(`ComfyUI TTS: không tìm thấy output audio ở node "${audioOutputNodeId}" (scene ${i})`);
    }

    const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(audioMeta.filename)}&subfolder=${encodeURIComponent(audioMeta.subfolder || '')}&type=${encodeURIComponent(audioMeta.type || 'output')}`;
    const fileRes = await fetch(viewUrl);
    if (!fileRes.ok) throw new Error(`ComfyUI TTS: tải file audio scene ${i} lỗi HTTP ${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const fileName = `scene_${i}.wav`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Only mark index i complete AFTER the file is on disk — a throw above this line
    // leaves the checkpoint at i, so a subsequent Continue correctly restarts at scene i.
    resultItems.push({
      ...pathToItem(filePath, { mimeType: 'audio/wav', fileName, field: 'audio' }),
      json: { ...scenes[i], index: i },
    });
    writeCheckpoint(context.uploadsDir, context.nodeId, i + 1);
    context.progress(Math.round(((i + 1) / total) * 100), `${i + 1}/${total}`);
  }

  clearCheckpoint(context.uploadsDir, context.nodeId);
  return { items: resultItems };
};
