const { toItems } = require('../../backend/utils/items');
const { getLocalServiceUrl } = require('../../backend/utils/localServices');
const { toTextArray } = require('../../backend/utils/promptInputs');

// Same prompting strategy as nodes/script-parse-llm/ (specs/english-teaching-video-pipeline.md
// §4.1) — kept identical so the two nodes are drop-in swappable on canvas.
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

module.exports = async function execute(inputs, config) {
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

  const ollamaUrl = (config.ollamaUrl || getLocalServiceUrl('ollama') || 'http://localhost:11434').replace(/\/$/, '');

  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'qwen2.5:7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      options: { temperature: config.temperature ?? 0.3 },
    }),
  });

  if (!res.ok) {
    throw new Error(`script-parse-ollama: Ollama API lỗi ${res.status}: ${await res.text()} (kiểm tra Ollama đã chạy + model "${config.model || 'qwen2.5:7b'}" đã pull chưa)`);
  }

  const apiJson = await res.json();
  const content = apiJson?.message?.content || '';
  const cleaned = stripCodeFence(content);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`script-parse-ollama: LLM không trả JSON hợp lệ (${e.message}). Raw: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.scenes)) {
    throw new Error('script-parse-ollama: JSON trả về thiếu mảng "scenes"');
  }

  return {
    scenes: toItems(parsed.scenes),
    json: cleaned,
  };
};
