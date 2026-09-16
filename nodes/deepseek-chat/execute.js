var h=Object.defineProperty;var p=(o,e)=>h(o,"name",{value:e,configurable:!0});const{getCredential,applyAuth}=require("../../backend/utils/credentials"),{toItems}=require("../../backend/utils/items"),{toTextArray}=require("../../backend/utils/promptInputs");module.exports=p(async function(e,t,u){const a=e?.user_prompt;if(!a)throw new Error("Missing input: user_prompt (n\u1ED1i t\u1EEB node Chat)");const d=toTextArray(e?.system_prompt),c=toTextArray(e?.reference);let n=[t.systemPreamble,...d].filter(Boolean).join(`

---

`);if(!n)throw new Error("Missing system prompt (\u0111i\u1EC1n System Preamble ho\u1EB7c n\u1ED1i node Text ch\u1EE9a skill)");c.length&&(n+=`

=== REFERENCE ===

`+c.filter(Boolean).join(`

---

`));const i={"Content-Type":"application/json"};applyAuth(getCredential(t.credentialName,u?.userId),{headers:i,qs:{}});const r=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:i,body:JSON.stringify({model:t.model||"deepseek-chat",messages:[{role:"system",content:n},{role:"user",content:a}],temperature:t.temperature??.7,max_tokens:t.maxTokens||8e3})}),m=await r.text();let s;try{s=JSON.parse(m)}catch{s=null}if(!r.ok)throw new Error(`DeepSeek API l\u1ED7i ${r.status}: ${s?.error?.message||m}`);const l=s?.choices?.[0]?.message?.content||"";return{text:l,items:toItems([{text:l}])}},"execute");
