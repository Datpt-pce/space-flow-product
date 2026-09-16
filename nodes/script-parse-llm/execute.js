var k=Object.defineProperty;var a=(n,t)=>k(n,"name",{value:t,configurable:!0});const{getCredential,applyAuth}=require("../../backend/utils/credentials"),{toItems}=require("../../backend/utils/items"),{toTextArray}=require("../../backend/utils/promptInputs"),SYSTEM_PROMPT=`Parse k\u1ECBch b\u1EA3n d\u1EA1y ti\u1EBFng Anh (raw text) th\xE0nh JSON v\u1EDBi:
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
}`;function stripCodeFence(n){const t=n.trim(),e=t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);return e?e[1]:t}a(stripCodeFence,"stripCodeFence"),module.exports=a(async function(t,e,u){const r=t?.user_prompt;if(!r)throw new Error("Missing input: user_prompt (n\u1ED1i t\u1EEB node Text/Chat ch\u1EE9a k\u1ECBch b\u1EA3n)");const d=e.lessonTitle?`Lesson title: ${e.lessonTitle}

${r}`:r,g=toTextArray(t?.system_prompt),l=toTextArray(t?.reference);let m=[SYSTEM_PROMPT,...g].filter(Boolean).join(`

---

`);l.length&&(m+=`

=== REFERENCE ===

`+l.filter(Boolean).join(`

---

`));const p={"Content-Type":"application/json"};applyAuth(getCredential(e.credentialName,u?.userId),{headers:p,qs:{}});const o=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:p,body:JSON.stringify({model:e.model||"deepseek-chat",messages:[{role:"system",content:m},{role:"user",content:d}],temperature:e.temperature??.3,max_tokens:e.maxTokens||4e3})}),h=await o.text();let s;try{s=JSON.parse(h)}catch{s=null}if(!o.ok)throw new Error(`DeepSeek API l\u1ED7i ${o.status}: ${s?.error?.message||h}`);const y=s?.choices?.[0]?.message?.content||"",c=stripCodeFence(y);let i;try{i=JSON.parse(c)}catch(w){throw new Error(`script-parse-llm: LLM kh\xF4ng tr\u1EA3 JSON h\u1EE3p l\u1EC7 (${w.message}). Raw: ${c.slice(0,200)}`)}if(!Array.isArray(i.scenes))throw new Error('script-parse-llm: JSON tr\u1EA3 v\u1EC1 thi\u1EBFu m\u1EA3ng "scenes"');return{scenes:toItems(i.scenes),json:c}},"execute");
