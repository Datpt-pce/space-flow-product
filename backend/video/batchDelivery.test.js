const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const testRoot=path.resolve(process.env.SF_DELIVERY_TEST_ROOT || 'logs');fs.mkdirSync(testRoot,{recursive:true});
const root=fs.mkdtempSync(path.join(testRoot,'batch-delivery-'));
process.env.SF_DATA_DIR=path.join(root,'state');fs.mkdirSync(path.join(process.env.SF_DATA_DIR,'uploads'),{recursive:true});
const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES ('owner'),('other')");require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
const batch=require('../routes/video-batch').service,versions=require('../routes/video-versions').service;
const {runDelivery,machineId}=require('../agent/mediaDelivery');
const {hashFile}=require('./assetService');
async function main(){try{
  const folder=path.join(root,'Nguồn tiếng Việt');fs.mkdirSync(folder);
  const source=path.join(folder,'Cảnh gốc.mp4'),output=path.join(root,'output.mp4');
  for(const [file,color] of [[source,'red'],[output,'blue']]) execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=${color}:s=160x160:r=30:d=1`,'-c:v','libx264','-pix_fmt','yuv420p','-y',file],{windowsHide:true});
  const originalHash=await hashFile(source),outputHash=await hashFile(output),device=machineId();
  db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,source_machine_id,duration_ms,kind,status) VALUES ('source','owner',?,?,?,1000,'video','ok')").run(source,originalHash,device);
  const aliases=[['relative-source',path.relative(process.cwd(),source)],...(process.platform==='win32'?[['case-source',source.toUpperCase()]]:[])];
  for(const [id,file] of aliases)db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,source_machine_id,kind,status) VALUES (?,'owner',?,?,?,'video','ok')").run(id,file,originalHash,device);
  let p=batch.create('owner',{id:'delivery-lab',name:'Delivery'});p.draft.settings={width:160,height:160,fps:30};
  p.draft.lists=[{id:'list',name:'List',minRating:0,items:[{id:'item',sourceRef:{kind:'media',assetId:'source',contentHash:originalHash}}]}];
  p.draft.tracks=[{id:'video',name:'Hình',type:'video',slots:[{id:'slot',listId:'list',durationFrames:30,vary:false}]}];
  p=batch.save('owner',p.id,{expectedRevision:p.revision,name:p.name,draft:p.draft});
  const pre=batch.preflight('owner',p.id,{expectedRevision:p.revision});const run=batch.createRun('owner',p.id,{expectedRevision:p.revision,inputHash:pre.inputHash,idempotencyKey:'run'}),item=run.items[0];
  const render={outputHash,assetIds:['source'],assetHashes:{source:originalHash}};
  db.prepare("INSERT INTO video_render_jobs(id,project_id,owner_id,status,output_path,manifest_json) VALUES ('render',?,'owner','done',?,?)").run(item.timelineId,output,JSON.stringify(render));
  db.prepare('UPDATE video_batch_run_items SET render_jobs_json=?').run(JSON.stringify([{jobId:'render',seq:0}]));
  let failCommit=false,failIndex=false;
  const deps={remote:false,runner:()=>async(kind,payload)=>{if(kind==='delivery-commit' && failCommit){failCommit=false;throw new Error('Injected restart before rename');}return runDelivery(kind,payload);},transfer:async file=>file,
    importAsset:async(owner,file)=>{if(failIndex){failIndex=false;throw new Error('Injected restart before reindex');}const hash=await hashFile(file);let asset=db.prepare("SELECT * FROM video_assets WHERE owner_id=? AND source_path=? AND content_hash=? AND status='ok'").get(owner,file,hash);if(!asset){const id=crypto.randomUUID();db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,source_machine_id,kind,status,duration_ms) VALUES (?,?,?,?,?,'video','ok',1000)").run(id,owner,file,hash,device);asset=db.prepare('SELECT * FROM video_assets WHERE id=?').get(id);}return asset;}};
  const relay=process.env.SF_TEST_DELIVERY_RELAY==='1',relaySteps=[];
  if(relay) {
    const receive=require('./sourceTransfer').createSourceReceiver(path.join(root,'agent-cache'));
    const agent=require('../ws/agentServer');
    agent.sendJob=async(owner,job,emit)=>{assert.equal(owner,'owner');assert.equal(job.type,'video-job');relaySteps.push(job.kind);
      if(job.kind==='delivery-commit' && failCommit){failCommit=false;throw new Error('Injected restart before rename');}
      if(job.kind==='delivery-prepare')assert.ok(job.payload.outputPath.startsWith(path.join(root,'agent-cache')),'server render transferred to agent cache first');
      const result=job.kind.startsWith('source-')?await receive(job.kind,job.payload):await runDelivery(job.kind,job.payload);emit('done',{result});};
    deps.remote=true;deps.runner=owner=>require('../routes/video-assets').makeRunJob(owner,true);deps.transfer=(file,runner)=>require('./sourceTransfer').transferSource(file,runner);
  }
  const service=require('./batchDelivery').createBatchDelivery(db,batch,deps);
  const plan=(request)=>service.plan('owner',p.id,run.id,0,{jobId:'render',mode:'variant',anchorId:'source',requestKey:crypto.randomUUID(),...request});
  const execute=(intent,request)=>service.execute('owner',p.id,run.id,0,intent.id,request);
  const one=await plan({}),two=await plan({});const variants=await Promise.all([execute(one),execute(two)]);
  assert.notEqual(variants[0].receipt.target,variants[1].receipt.target);assert.ok(variants.every(v=>path.basename(v.receipt.target).startsWith(run.items[0].name)));
  assert.equal(await hashFile(source),originalHash);for(const v of variants)assert.equal(await hashFile(v.receipt.target),outputHash);
  assert.equal((await execute(one)).assetId,variants[0].assetId,'retry does not duplicate variant or asset');
  await assert.rejects(service.plan('other',p.id,run.id,0,{jobId:'render'}),e=>e.status===404);
  const wrong=await plan({requestKey:'stable-key'});assert.equal((await plan({requestKey:'stable-key'})).id,wrong.id);
  await assert.rejects(plan({requestKey:'stable-key',folder:'different'}),/đích khác/);
  const offline=await plan({anchorId:null,folder});const connectedRunner=deps.runner;
  deps.runner=()=>async()=>{throw new Error('Agent offline');};
  try{await assert.rejects(execute(offline),/Agent offline/);assert.equal(service.options('owner',p.id,run.id,0,'render').deliveries.find(d=>d.id===offline.id).state,'confirmed');}finally{deps.runner=connectedRunner;}
  assert.equal((await execute(offline)).state,'done','explicit folder intent resumes on reconnect');
  db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,source_machine_id,kind,status) VALUES ('shared','other',?,?,?,'video','ok')").run(source,originalHash,device);
  await assert.rejects(plan({mode:'replace'}),/tài khoản khác/);db.prepare("DELETE FROM video_assets WHERE id='shared'").run();
  const replace=await plan({mode:'replace'});
  await assert.rejects(execute(replace),/xác nhận đúng file/);assert.equal(await hashFile(source),originalHash);
  failCommit=true;await assert.rejects(execute(replace,{confirmPath:source}),/Injected restart/);
  const protectedSource=db.prepare("SELECT * FROM video_assets WHERE id='source'").get();
  assert.notEqual(protectedSource.source_path,source);assert.equal(await hashFile(protectedSource.source_path),originalHash);assert.equal(await hashFile(source),originalHash);
  for(const [id] of aliases)assert.equal(db.prepare('SELECT source_path FROM video_assets WHERE id=?').get(id).source_path,protectedSource.source_path,'case/relative alias follows the same protected original bytes');
  failIndex=true;await assert.rejects(execute(replace),/Injected restart before reindex/);assert.equal(await hashFile(source),outputHash);
  const recovered=await execute(replace);assert.equal(recovered.state,'done');assert.notEqual(recovered.assetId,'source');
  const deliveredList=batch.get('owner',p.id).draft.lists.find(l=>l.name==='Kết quả đã xuất');assert.equal(deliveredList.items.length,4);assert.ok(deliveredList.items.every(i=>i.rating===0));
  const pin=versions.get('owner',item.timelineId,item.versionId),oldId=pin.document.tracks[0].clips[0].assetId;
  assert.equal(await hashFile(db.prepare('SELECT source_path FROM video_assets WHERE id=?').get(oldId).source_path),originalHash,'old named pin reads original bytes');
  assert.equal(batch.manifest('owner',p.id,run.id,0).deliveries.find(d=>d.id===replace.id).state,'done');
  // Direct adapter failure windows: external source edits, locks, staging disk errors,
  // crash immediately after rename, and a receipt arriving at the wrong machine.
  async function prepared(name) {const anchor=path.join(folder,`${name}.mp4`);fs.copyFileSync(protectedSource.source_path,anchor);const payload={id:crypto.randomUUID(),intentHash:name,machineId:device,mode:'replace',anchorPath:anchor,expectedHash:originalHash,outputHash,outputPath:output};return {payload,receipt:await runDelivery('delivery-prepare',payload)};}
  const changed=await prepared('changed');fs.copyFileSync(output,changed.payload.anchorPath);await assert.rejects(runDelivery('delivery-commit',changed.payload),/Nguồn đã đổi/);assert.equal(await hashFile(changed.receipt.backup),originalHash);
  const locked=await prepared('locked');fs.writeFileSync(`${locked.receipt.target}.spaceflow-replace-lock`,'another-delivery');await assert.rejects(runDelivery('delivery-commit',locked.payload),/delivery khác/);assert.equal(await hashFile(locked.receipt.target),originalHash);
  if(process.platform==='win32') {
    const native=await prepared('native-lock'),ready=path.join(root,'lock-ready');
    const quote=s=>`'${s.replace(/'/g,"''")}'`;
    const code=`$handle=[System.IO.File]::Open(${quote(native.receipt.target)},[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None);[System.IO.File]::WriteAllText(${quote(ready)},'ready');Start-Sleep -Seconds 20;$handle.Dispose()`;
    const proc=require('node:child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,stdio:'ignore'});
    try {for(let i=0;i<100 && !fs.existsSync(ready);i++)await new Promise(r=>setTimeout(r,50));assert.ok(fs.existsSync(ready),'native exclusive lock acquired');await assert.rejects(runDelivery('delivery-commit',native.payload));}
    finally{proc.kill();await new Promise(r=>proc.once('exit',r));}
    assert.equal(await hashFile(native.receipt.target),originalHash);assert.equal((await runDelivery('delivery-commit',native.payload)).state,'done');
  }
  const crash=await prepared('crash');fs.renameSync(crash.receipt.stage,crash.receipt.target);assert.equal((await runDelivery('delivery-commit',crash.payload)).state,'done');
  await assert.rejects(runDelivery('delivery-prepare',{...crash.payload,machineId:'another-machine'}),/Máy đích đã đổi/);
  const copy=fs.copyFileSync;let injected=false;
  fs.copyFileSync=(...args)=>{if(!injected && args[1].endsWith('.stage.mp4')){injected=true;throw Object.assign(new Error('ENOSPC injected'),{code:'ENOSPC'});}return copy(...args);};
  let diskPayload;try{const anchor=path.join(folder,'disk.mp4');copy(protectedSource.source_path,anchor);diskPayload={id:crypto.randomUUID(),intentHash:'disk',machineId:device,mode:'replace',anchorPath:anchor,expectedHash:originalHash,outputHash,outputPath:output};await assert.rejects(runDelivery('delivery-prepare',diskPayload),/ENOSPC/);assert.equal(await hashFile(anchor),originalHash);}finally{fs.copyFileSync=copy;}
  assert.equal((await runDelivery('delivery-prepare',diskPayload)).state,'prepared','restart resumes staging');
  const readonly=await prepared('permission');const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===readonly.receipt.target)throw Object.assign(new Error('EACCES injected'),{code:'EACCES'});return rename(from,to);};
  try{await assert.rejects(runDelivery('delivery-commit',readonly.payload),/EACCES/);assert.equal(await hashFile(readonly.receipt.target),originalHash);}finally{fs.renameSync=rename;}
  assert.equal((await runDelivery('delivery-commit',readonly.payload)).state,'done');
  if(process.platform==='linux' && process.getuid()!==0) {
    const denied=await prepared('native-permission');fs.chmodSync(folder,0o500);
    try{await assert.rejects(runDelivery('delivery-commit',denied.payload));assert.equal(await hashFile(denied.receipt.target),originalHash);}finally{fs.chmodSync(folder,0o700);}
    assert.equal((await runDelivery('delivery-commit',denied.payload)).state,'done');
  }
  if(relay) {assert.ok(relaySteps.indexOf('source-finish')<relaySteps.indexOf('delivery-prepare'));assert.ok(relaySteps.includes('delivery-commit'));}
  fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify({platform:process.platform,variants:variants.map(v=>v.receipt.target),replace:recovered.receipt,oldPinHash:originalHash},null,2));
  console.log(`PASS delivery ${process.platform}${relay?' owner-agent relay':''}: concurrent Unicode variants, owner/machine identity, expected hash, backup/pin replay, crash/staging/reindex recovery, injected disk/permission failures. Proof: ${root}`);
}finally{db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
