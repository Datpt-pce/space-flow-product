const { getCredential, applyAuth } = require('../../backend/utils/credentials');
const { toItems } = require('../../backend/utils/items');
const { toTextArray } = require('../../backend/utils/promptInputs');

// Prompting strategy per specs/english-teaching-video-pipeline.md §4.1.
const SYSTEM_PROMPT = `Parse kịch bản dạy tiếng Anh (raw text) thành JSON với:
- Character IDs (teacher, student_1, student_2, v.v.)
- Timing tự nhiên cho từng dòng thoại (3-4 từ/giây)
- Emotional tone (friendly, serious, questioning, excited, ...)
- Gesture description ngắn để hỗ trợ animation

Output ĐÚNG shape sau, KHÔNG thêm preamble, KHÔNG bọc trong markdown code fence:
{
  "lesson_title": "string",
  "scenes": [
    {
      "id": 1,
      "speaker": "teacher",
      "dialogue": "câu thoại",
      "duration_seconds": 5,
      "emotional_tone": "friendly_instructional",
      "gestures": "welcoming_wave"
    }
  ]
}`;

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

module.exports = async function execute(inputs, config, context) {
  const script = inputs?.user_prompt;
  if (!script) throw new Error('Missing input: user_prompt (nối từ node Text/Chat chứa kịch bản)');

  const userMessage = config.lessonTitle
    ? `Lesson title: ${config.lessonTitle}\n\n${script}`
    : script;

  // system_prompt/reference (optional) có thể là 1 string hoặc mảng string (nhiều node
  // Text cùng nối vào chung 1 dot) — mở rộng SYSTEM_PROMPT nền, không thay thế.
  const systemDocs = toTextArray(inputs?.system_prompt);
  const referenceDocs = toTextArray(inputs?.reference);
  let systemPrompt = [SYSTEM_PROMPT, ...systemDocs].filter(Boolean).join('\n\n---\n\n');
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
        { role: 'user', content: userMessage },
      ],
      temperature: config.temperature ?? 0.3,
      max_tokens: config.maxTokens || 4000,
    }),
  });

  const rawText = await res.text();
  let apiJson;
  try {
    apiJson = JSON.parse(rawText);
  } catch {
    apiJson = null;
  }

  if (!res.ok) {
    throw new Error(`DeepSeek API lỗi ${res.status}: ${apiJson?.error?.message || rawText}`);
  }

  const content = apiJson?.choices?.[0]?.message?.content || '';
  const cleaned = stripCodeFence(content);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`script-parse-llm: LLM không trả JSON hợp lệ (${e.message}). Raw: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.scenes)) {
    throw new Error('script-parse-llm: JSON trả về thiếu mảng "scenes"');
  }

  return {
    scenes: toItems(parsed.scenes),
    json: cleaned,
  };
};
