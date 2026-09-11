const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createBatchSpeech } = require('./batchSpeech');
const db = new DatabaseSync(':memory:');
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('other')");
require('./schema').ensureVideoSchema(db);
require.cache[require.resolve('../db')] = { id:require.resolve('../db'), filename:require.resolve('../db'), loaded:true, exports:db };
const batch = require('../routes/video-batch').service;
(async () => {
  try {
    const hash = 'a'.repeat(64), voiceHash = 'b'.repeat(64);
    for (const [id, owner, kind, content] of [['source','owner','video',hash],['reference','owner','audio',hash],['foreign','other','audio',hash],['voice','owner','audio',voiceHash]]) {
      db.prepare("INSERT INTO video_assets(id,owner_id,source_path,content_hash,duration_ms,kind,status,source_locality,width,height) VALUES (?,?,?,?,6000,?,'ok','server',160,160)").run(id,owner,`${id}.wav`,content,kind);
    }
    let project = batch.create('owner',{ id:'speech-lab',name:'Speech' });
    project.draft.lists = [{ id:'list',name:'List',items:[{ id:'item',sourceRef:{ kind:'media',assetId:'source',contentHash:hash } }] }];
    project.draft.tracks = [{ id:'video',type:'video',name:'Video',slots:['a','b'].map(id => ({ id,listId:'list',vary:false,durationMode:'fixed',durationFrames:90 })) }];
    project = batch.save('owner',project.id,{ expectedRevision:project.revision,name:project.name,draft:project.draft });
    const cues = [{ id:'one',startMs:0,endMs:800,content:'Hello',speaker:'speaker-1',action:'keep' },
      { id:'two',startMs:1100,endMs:2100,content:'Change this',speaker:'speaker-2',action:'convert' },
      { id:'three',startMs:3200,endMs:4400,content:'Keep this',speaker:'speaker-1',action:'keep' }];
    const speech = { cues,style:{ preset:'outline',fontSize:48 } };
    let device = 'machine', sent, outputHash = voiceHash;
    const runner = async (kind,payload) => {
      if (kind === 'delivery-info') return { machineId:device };
      if (payload.operation === 'start') { sent = payload; return { id:payload.id,status:'running' }; }
      return { id:payload.id,status:'completed',outputPath:'trusted/voice.wav',outputHash,sourceHash:hash };
    };
    const service = createBatchSpeech(db,batch,{ remote:true,runner:() => runner,transfer:async p => `agent/${p}`,
      importAsset:async (owner,file) => { assert.equal(file,'trusted/voice.wav'); return db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get('voice',owner); } });
    const request = { itemId:'item',expectedRevision:project.revision,task:'convert',language:'en',speech,referenceAssetId:'reference' };
    await assert.rejects(service.start('other',project.id,request), e => e.status === 404);
    await assert.rejects(service.start('owner',project.id,{ ...request,referenceAssetId:'foreign' }), /giọng mẫu/);
    await assert.rejects(service.start('owner',project.id,{ ...request,expectedRevision:-1 }), /thay đổi/);
    await assert.rejects(service.start('owner',project.id,{ ...request,speech:{ ...speech,cues:[cues[1],cues[0]] } }), /thời gian/);
    const job = await service.start('owner',project.id,request);
    assert.equal(sent.path,'agent/source.wav'); assert.equal(sent.referencePath,'agent/reference.wav');
    await assert.rejects(service.status('other',project.id,job.id), e => e.status === 404);
    device = 'wrong'; await assert.rejects(service.status('owner',project.id,job.id), /đúng agent/); device = 'machine';
    const apply = { itemId:'item',expectedRevision:project.revision,sourceHash:hash,speech,conversionJobId:job.id };
    await assert.rejects(service.apply('owner',project.id,{ ...apply,sourceHash:'stale' }), /Nguồn đã đổi/);
    await assert.rejects(service.apply('owner',project.id,{ ...apply,speech:{ ...speech,cues:cues.map(c => ({ ...c,action:'keep' })) } }), /Đoạn voice đã đổi/);
    const splitSpeech={ ...speech,style:{ ...speech.style,fontSize:80,fontFamily:'Courier New' },cues:[cues[0],{ ...cues[1],endMs:1500,content:'Change' },{ ...cues[1],id:'two-part',startMs:1500,content:'this' },cues[2]] };
    project=await service.apply('owner',project.id,{ ...apply,speech:splitSpeech });
    assert.equal(project.draft.lists[0].items[0].speech.audio.assetId,'voice');
    apply.expectedRevision=project.revision;
    await assert.rejects(service.apply('owner',project.id,{ ...apply,speech:{ ...splitSpeech,cues:splitSpeech.cues.map(c=>c.id === 'two-part' ? { ...c,startMs:1501 } : c) } }),/Đoạn voice đã đổi/);
    project = await service.apply('owner',project.id,apply);
    assert.equal(project.draft.lists[0].items[0].speech.audio.assetId,'voice');
    assert.ok(require('./batchReferences').assetReference(db,'owner','voice'));
    // Mimic a trusted editor trim, then prove repeated source coordinates are mapped once per occurrence.
    project.draft.lists[0].items[0].sourceRef.trim = { sourceInMs:500,sourceOutMs:3500 };
    db.prepare('UPDATE video_batch_projects SET draft_json=? WHERE id=?').run(JSON.stringify(project.draft),project.id);
    const pre = batch.preflight('owner',project.id,{ expectedRevision:project.revision });
    assert.deepEqual(pre.issues,[]);
    assert.equal(pre.snapshot.assets.voice.content_hash,voiceHash);
    const doc = batch.sample('owner',project.id,{ expectedRevision:project.revision }).document;
    const captions = doc.tracks.find(t => t.type === 'caption').clips;
    assert.deepEqual(captions.map(c => [c.timelineInMs,c.timelineOutMs]),[[0,300],[600,1600],[2700,3000],[3000,3300],[3600,4600],[5700,6000]]);
    assert.ok(captions.every(c => !c.assetId));
    assert.ok(doc.tracks.find(t => t.id === 'video').clips.every(c => c.volume === 0));
    assert.equal(doc.tracks.find(t => t.id === 'video-voice').clips[1].sourceInMs,500);
    const checked = [];
    await batch.verifySources('owner',pre.snapshot,async a => { checked.push(a.id);return a.content_hash; });
    assert.ok(checked.includes('voice'));
    project = batch.get('owner',project.id);
    project.draft.lists[0].items[0].speech.cues[0].content = 'forged';
    assert.throws(() => batch.save('owner',project.id,{ expectedRevision:project.revision,name:project.name,draft:project.draft }), /hộp thoại/);
    db.exec("UPDATE video_assets SET content_hash='changed' WHERE id='voice'");
    assert.throws(() => batch.preflight('owner',project.id,{ expectedRevision:project.revision }), /Audio đổi giọng/);
    console.log('PASS BCL speech: owner/machine/source binding, region staleness, separate captions, trims/repetition, source immutability and voice dependencies');
  } finally { db.close(); }
})().catch(e => { console.error(e);process.exitCode = 1; });
