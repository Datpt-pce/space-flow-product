const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
let temporary;
if(!process.env.SF_DATA_DIR){fs.mkdirSync(path.resolve('logs'),{recursive:true});temporary=fs.mkdtempSync(path.resolve('logs/analytics-resource-test-'));process.env.SF_DATA_DIR=temporary;}
process.env.SF_IMPORT_LEGACY='0';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('hex');
const db=require('../db');
const {createSampler}=require('./resources');
const runtime=require('./runtime');
const {queryAnalytics}=require('./query');
const {attachAgentServer}=require('../ws/agentServer');
const WebSocket=require('ws');
async function main(){
  const events=[];
  const output=await require('../engine/executor').run({nodes:[{id:'observed',type:'text',config:{content:'fixture'}}],edges:[]},process.env.SF_DATA_DIR,(event,data)=>{
    if(event==='analyticsAttempt')throw new Error('simulated telemetry write failure');
    events.push({event,data});
  });
  assert.equal(output.observed.text,'fixture');
  assert.equal(events.filter(e=>e.event==='nodeStart').length,1,'telemetry failure does not retry execution');
  assert.equal(events.filter(e=>e.event==='nodeComplete').length,1);
  const sample=createSampler();await sample();await new Promise(r=>setTimeout(r,100));const s=await sample();
  assert(s.elapsedMs>0&&s.cpuSeconds>=0&&s.rssBytes>0&&s.cores>0);
  assert.equal(s.treeSupported,true,`${process.platform} process-tree sampler must work on this platform`);
  assert.equal(runtime.saveResource('server',null,s),true);
  assert.equal(runtime.saveResource('server',null,s),false);
  assert.equal(queryAnalytics(db).resources.latest.length,1);
  assert.equal(db.prepare('SELECT samples FROM analytics_resource_daily').get().samples,1);
  const user=crypto.randomUUID(),agent=crypto.randomUUID(),token=crypto.randomUUID();
  db.prepare('INSERT INTO users(id,google_sub,email,role) VALUES(?,?,?,?)').run(user,user,`${user}@example.invalid`,'member');
  db.prepare('INSERT INTO agents(id,user_id,secret_hash) VALUES(?,?,?)').run(agent,user,crypto.createHash('sha256').update(token).digest('hex'));
  const server=require('http').createServer(),wss=attachAgentServer(server);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/agent-ws`);
  await new Promise(r=>ws.once('open',r));
  ws.send(JSON.stringify({type:'resource-sample',sample:{...s,id:crypto.randomUUID()}}));
  await new Promise(r=>setTimeout(r,50));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM analytics_resources WHERE scope='agent'").get().n,0,'unregistered agent cannot inject resources');
  const registered=new Promise(r=>ws.once('message',r));ws.send(JSON.stringify({type:'register',agentToken:token}));await registered;
  ws.send(JSON.stringify({type:'resource-sample',ownerId:'forged',sample:{...s,id:crypto.randomUUID()}}));
  await new Promise(r=>setTimeout(r,100));
  assert.equal(db.prepare("SELECT owner_id FROM analytics_resources WHERE scope='agent'").get().owner_id,user);
  const closed=new Promise(r=>ws.once('close',r));ws.close();await closed;await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));
  const old=Date.now()-40*86400000;
  db.prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?,?,?,?,?)').run(user,crypto.randomUUID(),old,old,'canvas','undo','old',null,'{}');
  runtime.maintenance();assert.equal(db.prepare('SELECT COUNT(*) n FROM analytics_events WHERE at=?').get(old).n,0);
  console.log(JSON.stringify({status:'pass',platform:process.platform,cpuSeconds:s.cpuSeconds,rssBytes:s.rssBytes,treeSupported:s.treeSupported,samplerMs:s.samplerMs,
    verified:['real process sampling','idempotent resource totals','authenticated relay owner','retention']}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  runtime.stop();db.close();
  if(temporary&&path.dirname(temporary)===path.resolve('logs')&&path.basename(temporary).startsWith('analytics-resource-test-'))fs.rmSync(temporary,{recursive:true,force:true});
});
