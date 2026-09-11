const assert=require('node:assert/strict');
const { runCommand,invertCommand }=require('./index');
const clip={ id:'cue',sourceInMs:0,sourceOutMs:2000,timelineInMs:0,timelineOutMs:2000,speed:1,text:{ content:'First second',fontSize:32 } };
const state={ schemaVersion:1,resolution:{ width:1080,height:1920 },fps:30,audioRate:48000,tracks:[{ id:'captions',type:'caption',order:0,visible:true,locked:false,clips:[clip] }],transitions:[] };
const args=JSON.parse(JSON.stringify({ changes:[{ trackId:'captions',from:[clip],to:[
  { ...clip,sourceOutMs:1000,timelineOutMs:1000,text:{ ...clip.text,content:'First',fontFamily:'Arial' } },
  { ...clip,id:'second',sourceOutMs:1000,timelineInMs:1000,text:{ ...clip.text,content:'second',fontFamily:'Arial' } },
] }] }));
const after=runCommand(state,'ReplaceCaptionClips',args);
assert.equal(after.tracks[0].clips.length,2);
assert.deepEqual(invertCommand(after,'ReplaceCaptionClips',JSON.parse(JSON.stringify(args))),state);
assert.throws(()=>runCommand(after,'ReplaceCaptionClips',args),/changed/);
assert.throws(()=>runCommand({ ...state,tracks:[{ ...state.tracks[0],locked:true }] },'ReplaceCaptionClips',args),/changed/);
assert.throws(()=>runCommand(state,'ReplaceCaptionClips',{ changes:[...args.changes,...args.changes] }),/changed/);
console.log('PASS caption replacement survives JSON transport, undoes exactly and rejects stale/locked/duplicate tracks');
