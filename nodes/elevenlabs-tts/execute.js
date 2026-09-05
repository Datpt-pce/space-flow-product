const path = require('path');
const fs = require('fs');
const { fromItems, pathToItem } = require('../../backend/utils/items');
const { getCredential, applyAuth } = require('../../backend/utils/credentials');
const { readCheckpoint, writeCheckpoint, clearCheckpoint } = require('../../backend/utils/batchCheckpoint');

module.exports = async function execute(inputs, config, context) {
  const scenes = fromItems(inputs.items);
  if (!scenes.length) throw new Error('Missing input: items (danh sách scene rỗng)');

  const voiceId = config.voiceId || '21m00Tcm4TlvDq8ikWAM';
  const outDir = path.join(context.uploadsDir, 'elevenlabs-tts', context.nodeId);
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
    const fileName = `scene_${i}.mp3`;
    const filePath = path.join(outDir, fileName);
    if (fs.existsSync(filePath)) {
      resultItems.push({
        ...pathToItem(filePath, { mimeType: 'audio/mpeg', fileName, field: 'audio' }),
        json: { ...scenes[i], index: i },
      });
    }
  }

  const credential = getCredential(config.credentialName, context.userId);

  for (let i = startAt; i < total; i++) {
    const text = scenes[i]?.text || scenes[i]?.dialogue;
    if (!text) throw new Error(`ElevenLabs TTS: scene ${i} thiếu field "text"/"dialogue"`);

    const headers = { 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
    applyAuth(credential, { headers, qs: {} });

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text,
        model_id: config.modelId || 'eleven_multilingual_v2',
        voice_settings: {
          stability: config.stability ?? 0.5,
          similarity_boost: config.similarityBoost ?? 0.75,
        },
      }),
    });

    if (!res.ok) {
      let detail = await res.text();
      try {
        detail = JSON.parse(detail)?.detail?.message || detail;
      } catch {
        // keep raw text
      }
      throw new Error(`ElevenLabs TTS: scene ${i} lỗi HTTP ${res.status}: ${detail}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const fileName = `scene_${i}.mp3`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Only mark index i complete AFTER the file is on disk — a throw above this line
    // leaves the checkpoint at i, so a subsequent Continue correctly restarts at scene i.
    resultItems.push({
      ...pathToItem(filePath, { mimeType: 'audio/mpeg', fileName, field: 'audio' }),
      json: { ...scenes[i], index: i },
    });
    writeCheckpoint(context.uploadsDir, context.nodeId, i + 1);
    context.progress(Math.round(((i + 1) / total) * 100), `${i + 1}/${total}`);
  }

  clearCheckpoint(context.uploadsDir, context.nodeId);
  return { items: resultItems };
};
