const { getCredential, applyAuth } = require('../../backend/utils/credentials');
const { toItems } = require('../../backend/utils/items');
const { toTextArray } = require('../../backend/utils/promptInputs');

module.exports = async function execute(inputs, config, context) {
  const userPrompt = inputs?.user_prompt;
  if (!userPrompt) throw new Error('Missing input: user_prompt (nối từ node Chat)');

  // system_prompt/reference có thể là 1 string (1 node nối vào) hoặc mảng string (nhiều
  // node cùng nối vào chung 1 dot — xem backend/engine/executor.js phần gộp input đa-edge).
  const systemDocs = toTextArray(inputs?.system_prompt);
  const referenceDocs = toTextArray(inputs?.reference);
  let systemPrompt = [config.systemPreamble, ...systemDocs]
    .filter(Boolean)
    .join('\n\n---\n\n');
  if (!systemPrompt) throw new Error('Missing system prompt (điền System Preamble hoặc nối node Text chứa skill)');
  if (referenceDocs.length) {
    systemPrompt += '\n\n=== REFERENCE ===\n\n' + referenceDocs.filter(Boolean).join('\n\n---\n\n');
  }

  const headers = { 'Content-Type': 'application/json' };
  applyAuth(getCredential(config.credentialName, context?.userId), { headers, qs: {} });

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 8000,
    }),
  });

  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`DeepSeek API lỗi ${res.status}: ${json?.error?.message || rawText}`);
  }

  const content = json?.choices?.[0]?.message?.content || '';

  return {
    text: content,
    items: toItems([{ text: content }]),
  };
};
