const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES ('owner'),('other')");require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
const projects=require('../routes/video-projects'),batch=require('../routes/video-batch').service,versions=require('../routes/video-versions').service;
const save=p=>batch.save('owner',p.id,{expectedRevision:p.revision,name:p.name,draft:p.draft});
async function main(){try{
  for(const [id,kind] of [['one','video'],['two','video'],['image','image']])db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES (?,'owner',?,?,4000,?,'ok')").run(id,`${id}.mp4`,id,kind);
  let p=batch.create('owner',{id:'template-lab',name:'Template'});
  p.draft.lists=[{id:'list',name:'List',minRating:0,items:['one','two','image'].map((id,i)=>({id,rating:i,sourceRef:{kind:'media',assetId:id,contentHash:id}}))}];p=save(p);
  const prepared=batch.prepare('owner',p.id,{expectedRevision:p.revision,listId:'list',itemId:'two'});p=prepared.project;
  const timeline=prepared.timelineId,state=projects.recoverProjectState(timeline),clip=state.tracks[0].clips[0];
  projects.applyCommand(timeline,{type:'SetProperty',args:{path:['tracks',0,'clips',0,'transform','opacity'],from:1,to:.6}});
  const pin=versions.create('owner',timeline,{baseRevision:1,name:'Template fixed second'});
  p=batch.create('owner',{id:'template-consumer',name:'Template consumer'});
  p.draft.lists=[{id:'list',name:'List',minRating:0,items:['one','two','image'].map((id,i)=>({id,rating:i,sourceRef:{kind:'media',assetId:id,contentHash:id}}))}];p=save(p);
  p=batch.pinTemplate('owner',p.id,{expectedRevision:p.revision,projectId:timeline,versionId:pin.id});
  assert.equal(p.draft.tracks[0].slots[0].fixedItemId,'two');
  const sample=batch.sample('owner',p.id,{expectedRevision:p.revision});assert.equal(sample.document.tracks[0].clips[0].assetId,'two');assert.equal(sample.document.tracks[0].clips[0].transform.opacity,.6);
  const binding=structuredClone(p.draft.template);p=save(p);assert.deepEqual(batch.get('owner',p.id).draft.template,binding);
  projects.applyCommand(timeline,{type:'SetProperty',args:{path:['tracks',0,'clips',0,'transform','opacity'],from:.6,to:.9}});
  assert.equal(batch.sample('owner',p.id,{expectedRevision:p.revision}).document.tracks[0].clips[0].transform.opacity,.6);
  const fixed=p.draft.tracks[0].slots[0];p.draft.tracks[0].slots.push({...fixed,id:'same-list-independent',fixedItemId:'image',durationFrames:300});p=save(p);
  const imageSample=batch.sample('owner',p.id,{expectedRevision:p.revision});assert.equal(imageSample.document.tracks[0].clips.at(-1).timelineOutMs,14000,'still image holds long slot');
  assert.notEqual(p.draft.tracks[0].slots[0].id,p.draft.tracks[0].slots[1].id);
  p.draft.tracks[0].slots.reverse();p=save(p);assert.equal(batch.sample('owner',p.id,{expectedRevision:p.revision}).document.tracks[0].clips[1].transform.opacity,.6,'stable slot binding survives reorder');
  await assert.rejects(batch.verifySources('owner',batch.preflight('owner',p.id,{expectedRevision:p.revision}).snapshot,async()=> 'modified-on-disk'),/đã đổi trên đĩa/);
  assert.throws(()=>batch.pinTemplate('other',p.id,{expectedRevision:p.revision,projectId:timeline,versionId:pin.id}),e=>e.status===404);
  // One hundred native rows are paged, retained, and a fresh intent makes a new run.
  p.draft.tracks=[{id:'one-track',name:'Hình',type:'video',slots:[{id:'hundred',listId:'list',vary:true,durationFrames:30}]}];
  p.draft.lists[0].items=Array.from({length:100},(_,i)=>({id:`item-${i}`,sourceRef:{kind:'media',assetId:'one',contentHash:'one'},rating:0,manualOrder:i}));p=save(p);
  const start=performance.now(),pre=batch.preflight('owner',p.id,{expectedRevision:p.revision});assert.equal(pre.totalCount,100);assert.equal(pre.rows.length,20);
  const request={expectedRevision:p.revision,inputHash:pre.inputHash,idempotencyKey:'hundred-one'},run=batch.createRun('owner',p.id,request);
  assert.equal(run.count,100);assert.equal(run.items.length,20);assert.equal(batch.getRun('owner',p.id,run.id,{offset:80,limit:20}).items.at(-1).rowIndex,99);
  const second=batch.createRun('owner',p.id,{...request,idempotencyKey:'hundred-two'});assert.notEqual(second.id,run.id);assert.notEqual(second.items[0].timelineId,run.items[0].timelineId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_render_jobs').get().n,0);
  console.log(`PASS template: exact fixed source, immutable pin/transforms, independent repeated lists/reorder, long still, physical hash check, 100-row paging and new-run intent (${Math.round(performance.now()-start)}ms)`);
}finally{db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
