const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
const projects = require('../routes/video-projects');
const service = require('../routes/video-batch').service;
const versions = require('../routes/video-versions').service;
const { planBatch } = require('../../shared/video-batch-planner');
const { digest } = require('./versionService');
const save = p => service.save('owner', p.id, { expectedRevision: p.revision, name: p.name, draft: p.draft });
try {
  let p = service.create('owner', { id: 'generation', name: 'Generation' });
  for (const [group, count] of [['A',3],['B',1],['C',5]]) {
    const items = [];
    for (let n = 1; n <= count; n++) {
      const id = `${group}${n}`;
      db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES (?,'owner',?,?,2000,'video','ok')").run(id,`${id}.mp4`,id);
      items.push({ id, rating:0, manualOrder:n, sourceRef:{kind:'media',assetId:id,contentHash:id} });
    }
    p.draft.lists.push({id:group,name:group,minRating:0,items});
  }
  p.draft.tracks = [{id:'visual',name:'Hình 1',type:'video',slots:['A','B','C'].map(listId=>({id:`slot-${listId}`,listId,vary:listId!=='B',durationMode:'fixed',durationFrames:30}))}];
  p=save(p);
  const pre = service.preflight('owner',p.id,{expectedRevision:p.revision});
  assert.equal(pre.totalCount,15); assert.deepEqual(pre.issues,[]);
  assert.equal(pre.inputHash,digest(pre.snapshot));
  assert.deepEqual(planBatch(pre.snapshot).rows,pre.rows.map(({rowIndex,assignments})=>({rowIndex,assignments})));
  const request={expectedRevision:p.revision,inputHash:pre.inputHash,idempotencyKey:'generate-1'};
  db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON video_batch_run_items WHEN NEW.row_index=1 BEGIN SELECT RAISE(ABORT,'injected disk failure'); END");
  assert.throws(()=>service.createRun('owner',p.id,request),/injected disk failure/);
  for(const table of ['video_batch_runs','video_batch_run_items','video_projects','video_compilations','video_named_versions','video_automation_inputs']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`${table} rolls back`);
  db.exec('DROP TRIGGER fail_second');
  const result=service.createRun('owner',p.id,request);
  assert.equal(result.count,15); assert.equal(result.items.length,15);
  for(const item of result.items) {
    const pin=versions.get('owner',item.timelineId,item.versionId);
    assert.equal(pin.documentHash,pre.rows[item.rowIndex].documentHash);
    assert.equal(db.prepare('SELECT collection_id FROM video_projects WHERE id=?').get(item.timelineId).collection_id,p.collectionId);
    assert.equal(pin.document.tracks[0].clips.at(-1).timelineOutMs,3000);
  }
  assert.equal(service.createRun('owner',p.id,request).id,result.id);
  assert.throws(()=>service.createRun('owner',p.id,{...request,inputHash:'different'}),e=>e.status===409);
  assert.throws(()=>service.getRun('other',p.id,result.id),e=>e.status===404);
  assert.equal(service.getRun('owner',p.id,result.id,{offset:10,limit:5}).items.length,5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_projects').get().n,15);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_render_jobs').get().n,0);
  const target=result.items[0];
  projects.applyCommand(target.timelineId,{type:'SetProperty',args:{path:['tracks',0,'clips',0,'transform','opacity'],from:1,to:.5}});
  assert.equal(service.getRun('owner',p.id,result.id).items[0].currentSeq,1);
  assert.equal(versions.get('owner',target.timelineId,target.versionId).document.tracks[0].clips[0].transform.opacity,1);
  const renderCalls = [];
  const fakeRender = (ownerId, projectId, options) => {
    const jobId = `job-${renderCalls.length}`; renderCalls.push({ projectId, options });
    db.prepare("INSERT INTO video_render_jobs(id,project_id,owner_id,pinned_seq,preset_id,idempotency_key,status) VALUES (?,?,?,?,?,?,'queued')")
      .run(jobId,projectId,ownerId,options.baseRevision,options.presetId,options.idempotencyKey); return { jobId };
  };
  const selection = { rowIndexes:[0,1], selectionKey:'two-only', mode:'current', expectedSeqs:{0:1,1:0} };
  const rendered=service.renderSelected('owner',p.id,result.id,selection,fakeRender);
  assert.equal(rendered.results.filter(r=>r.jobId).length,2); assert.equal(renderCalls.length,2);
  assert.equal(renderCalls[0].options.baseRevision,1);
  service.renderSelected('owner',p.id,result.id,selection,fakeRender); assert.equal(renderCalls.length,2);
  assert.throws(()=>service.renderSelected('owner',p.id,result.id,{...selection,rowIndexes:[2]},fakeRender),e=>e.status===409);
  db.prepare("UPDATE video_render_jobs SET status='error' WHERE id='job-0'").run();
  db.prepare("UPDATE video_render_jobs SET status='done' WHERE id='job-1'").run();
  projects.applyCommand(target.timelineId,{type:'SetProperty',args:{path:['tracks',0,'clips',0,'transform','opacity'],from:.5,to:.7}});
  const retried=service.renderSelected('owner',p.id,result.id,{rowIndexes:[0,1],selectionKey:'retry-old',mode:'retry'},fakeRender);
  assert.equal(renderCalls.length,3,'successful item is not resubmitted');
  assert.equal(renderCalls[2].options.versionId,renderCalls[0].options.versionId,'retry pins original selection');
  assert.equal(renderCalls[2].options.baseRevision,1,'retry never takes new head 2');
  assert.equal(retried.results[1].jobId,'job-1');
  assert.throws(()=>service.renderSelected('other',p.id,result.id,selection,fakeRender),e=>e.status===404);
  assert.throws(()=>service.renderSelected('owner',p.id,result.id,{...selection,rowIndexes:[99]},fakeRender),e=>e.status===404);
  const staleRender=service.renderSelected('owner',p.id,result.id,{...selection,rowIndexes:[0],selectionKey:'stale-render'},fakeRender);
  assert.match(staleRender.results[0].error,/Timeline đã đổi/);
  const manifest=service.manifest('owner',p.id,result.id,0);
  assert.equal(manifest.batchRunId,result.id); assert.equal(manifest.jobs.length,2);
  p.draft.lists[0].items[0].rating=5;p=save(p);
  assert.throws(()=>service.createRun('owner',p.id,{...request,idempotencyKey:'changed'}),e=>e.status===409);
  assert.equal(service.createRun('owner',p.id,request).id,result.id,'network retry still resolves old run after draft edits');
  const next=service.preflight('owner',p.id,{expectedRevision:p.revision});
  assert.notEqual(next.inputHash,pre.inputHash);
  db.prepare("UPDATE video_assets SET content_hash='changed' WHERE id='A1'").run();
  assert.throws(()=>service.createRun('owner',p.id,{expectedRevision:p.revision,inputHash:next.inputHash,idempotencyKey:'stale-source'}),e=>e.status===409);
  db.prepare("UPDATE video_assets SET content_hash='A1' WHERE id='A1'").run();
  // An old draft's inferred duration is not an explicit trim. Every Cartesian
  // row must use its own source length, including media longer than 3 seconds.
  p.draft.tracks[0].slots.forEach(slot => { delete slot.durationMode; }); p=save(p);
  db.prepare("UPDATE video_assets SET duration_ms=7250 WHERE id='A1'").run();
  db.prepare("UPDATE video_assets SET duration_ms=4100 WHERE id='A2'").run();
  const full=service.preflight('owner',p.id,{expectedRevision:p.revision});
  assert.deepEqual(full.issues,[]);
  const fullRun=service.createRun('owner',p.id,{expectedRevision:p.revision,inputHash:full.inputHash,idempotencyKey:'full-sources'});
  assert.equal(fullRun.items[0].name,'A1_B1_C1');
  assert.equal(fullRun.items[5].name,'A2_B1_C1');
  for (const item of fullRun.items) {
    const doc=versions.get('owner',item.timelineId,item.versionId).document;
    let end=0;
    for (const clip of doc.tracks[0].clips) {
      const duration=db.prepare('SELECT duration_ms FROM video_assets WHERE id=?').get(clip.assetId).duration_ms;
      assert.ok(duration-clip.sourceOutMs>=-.001 && duration-clip.sourceOutMs<1000/30);
      assert.equal(clip.timelineInMs,end); end=clip.timelineOutMs;
    }
    assert.equal(doc.tracks[0].clips.at(-1).timelineOutMs,full.rows[item.rowIndex].durationFrames*1000/30);
  }
  assert.equal(versions.get('owner',target.timelineId,target.versionId).document.tracks[0].clips.at(-1).timelineOutMs,3000,'old pins are unchanged');
  p.draft.tracks[0].slots.forEach(slot => { slot.durationMode='fixed'; }); p=save(p);
  db.prepare("UPDATE video_assets SET duration_ms=200 WHERE id='C5'").run();
  const short=service.preflight('owner',p.id,{expectedRevision:p.revision});
  assert.equal(short.issues.length,3);assert.match(short.issues[0].message,/quá ngắn/);
  assert.throws(()=>service.createRun('owner',p.id,{expectedRevision:p.revision,inputHash:short.inputHash,idempotencyKey:'short-source'}),/quá ngắn/);
  assert.equal(service.runs('owner',p.id).length,2);
  let audioProject = service.create('owner', { id: 'audio-source-duration', name: 'Audio source duration' });
  const audioItems = [1200, 2600].map((duration, index) => {
    const id = `audio-${index}`;
    db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status) VALUES (?,'owner',?,?,?,'audio','ok')").run(id, `${id}.wav`, id, duration);
    return { id, rating:0, manualOrder:index, sourceRef:{kind:'media',assetId:id,contentHash:id} };
  });
  audioProject.draft.lists = [p.draft.lists[0], {id:'sound',name:'Sound',minRating:0,items:audioItems}];
  audioProject.draft.tracks = [
    {id:'picture',name:'Picture',type:'video',slots:[{id:'picture-slot',listId:'A',fixedItemId:'A1',vary:false,durationFrames:150}]},
    {id:'sound-track',name:'Sound',type:'audio',slots:[{id:'sound-slot',listId:'sound',vary:true,durationMode:'source',durationFrames:30}]},
  ];
  audioProject = save(audioProject);
  const audioPre = service.preflight('owner',audioProject.id,{expectedRevision:audioProject.revision});
  assert.deepEqual(audioPre.issues,[]);
  const audioRun = service.createRun('owner',audioProject.id,{expectedRevision:audioProject.revision,inputHash:audioPre.inputHash,idempotencyKey:'audio-full'});
  assert.deepEqual(audioRun.items.map(item => versions.get('owner',item.timelineId,item.versionId).document.tracks[1].clips[0].sourceOutMs),[1200,2600]);
  // Legacy audio blocks keep their authored frame duration until source mode is chosen.
  delete audioProject.draft.tracks[1].slots[0].durationMode;
  audioProject = save(audioProject);
  const legacyAudio = service.sample('owner',audioProject.id,{expectedRevision:audioProject.revision,rowIndex:0});
  assert.equal(legacyAudio.document.tracks[1].clips[0].sourceOutMs,1000);
  console.log('PASS BCL generation: 15 native pins, shared hash/rows, rollback, ownership, retry, stale inputs, short sources, selected render and exact retry pin');
} finally { db.close(); }
