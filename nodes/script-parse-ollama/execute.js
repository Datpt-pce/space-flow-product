var w=Object.defineProperty;var i=(n,t)=>w(n,"name",{value:t,configurable:!0});const{toItems}=require("../../backend/utils/items"),{getLocalServiceUrl}=require("../../backend/utils/localServices"),{toTextArray}=require("../../backend/utils/promptInputs"),SYSTEM_PROMPT=`Parse k\u1ECBch b\u1EA3n d\u1EA1y ti\u1EBFng Anh (raw text) th\xE0nh JSON v\u1EDBi:
- Character IDs (teacher, student_1, student_2, v.v.)
- Timing t\u1EF1 nhi\xEAn cho t\u1EEBng d\xF2ng tho\u1EA1i (3-4 t\u1EEB/gi\xE2y)
- Emotional tone (friendly, serious, questioning, excited, ...)
- Gesture description ng\u1EAFn \u0111\u1EC3 h\u1ED7 tr\u1EE3 animation

Output \u0110\xDANG shape sau, KH\xD4NG th\xEAm preamble, KH\xD4NG b\u1ECDc trong markdown code fence:
{
  "lesson_title": "string",
  "scenes": [
    {
      "id": 1,
      "speaker": "teacher",
      "dialogue": "c\xE2u tho\u1EA1i",
      "duration_seconds": 5,
      "emotional_tone": "friendly_instructional",
      "gestures": "welcoming_wave"
    }
  ]
}`;function stripCodeFence(n){const t=n.trim(),e=t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);return e?e[1]:t}i(stripCodeFence,"stripCodeFence"),module.exports=i(async function(t,e){const r=t?.user_prompt;if(!r)throw new Error("Missing input: user_prompt (n\u1ED1i t\u1EEB node Text/Chat ch\u1EE9a k\u1ECBch b\u1EA3n)");const m=e.lessonTitle?`Lesson title: ${e.lessonTitle}

${r}`:r,p=toTextArray(t?.system_prompt),c=toTextArray(t?.reference);let l=[SYSTEM_PROMPT,...p].filter(Boolean).join(`

---

`);c.length&&(l+=`

=== REFERENCE ===

`+c.filter(Boolean).join(`

---

`));const h=(e.ollamaUrl||getLocalServiceUrl("ollama")||"http://localhost:11434").replace(/\/$/,""),s=await fetch(`${h}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:e.model||"qwen2.5:7b",messages:[{role:"system",content:l},{role:"user",content:m}],stream:!1,options:{temperature:e.temperature??.3}})});if(!s.ok)throw new Error(`script-parse-ollama: Ollama API l\u1ED7i ${s.status}: ${await s.text()} (ki\u1EC3m tra Ollama \u0111\xE3 ch\u1EA1y + model "${e.model||"qwen2.5:7b"}" \u0111\xE3 pull ch\u01B0a)`);const u=(await s.json())?.message?.content||"",o=stripCodeFence(u);let a;try{a=JSON.parse(o)}catch(d){throw new Error(`script-parse-ollama: LLM kh\xF4ng tr\u1EA3 JSON h\u1EE3p l\u1EC7 (${d.message}). Raw: ${o.slice(0,200)}`)}if(!Array.isArray(a.scenes))throw new Error('script-parse-ollama: JSON tr\u1EA3 v\u1EC1 thi\u1EBFu m\u1EA3ng "scenes"');return{scenes:toItems(a.scenes),json:o}},"execute");
