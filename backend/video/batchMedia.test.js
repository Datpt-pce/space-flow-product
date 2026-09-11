const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runVideoJob } = require('../agent/videoJobs');
const { buildRenderPlan } = require('./renderPlanner');
const { compileBatchRow } = require('./batchCompiler');
const { transitionWindow } = require('../../shared/video-transition-timing');
const directory = path.resolve(__dirname,'../../logs/batch-media-proof');
fs.mkdirSync(directory,{recursive:true});
const command = (binary,args,options={}) => execFileSync(binary,args,{windowsHide:true,timeout:60000,...options});
const ffmpeg = args => command('ffmpeg',['-hide_banner','-loglevel','error','-y',...args]);
const probe = file => JSON.parse(command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
const pixel = (file,time) => [...command('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-vf','crop=4:4:10:10','-pix_fmt','rgb24','-f','rawvideo','-'])].slice(0,3);
const rms = (file,start,length) => {
  const bytes=command('ffmpeg',['-v','error','-ss',String(start),'-t',String(length),'-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','-']);
  let sum=0;for(let i=0;i+4<=bytes.length;i+=4)sum+=bytes.readFloatLE(i)**2;return Math.sqrt(sum/(bytes.length/4));
};
const toneLevel=(file,time,hz)=>{
  const bytes=command('ffmpeg',['-v','error','-ss',String(time),'-t','0.1','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','-']);
  let real=0,imag=0;for(let i=0;i<bytes.length/4;i++){const value=bytes.readFloatLE(i*4),phase=2*Math.PI*hz*i/48000;real+=value*Math.cos(phase);imag+=value*Math.sin(phase);}return Math.hypot(real,imag)/(bytes.length/4);
};
async function main() {
  const rawAssetPaths={}, assets={};
  for(const [id,color,frequency] of [['red','red',500],['blue','blue',900],['green','lime',1300]]) {
    const file=path.join(directory,`${id}.mp4`);ffmpeg(['-f','lavfi','-i',`color=c=${color}:s=160x160:r=30:d=2`,'-f','lavfi','-i',`sine=frequency=${frequency}:duration=2`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
    rawAssetPaths[id]=file;assets[id]={id,kind:'video',status:'ok',duration_ms:2000,content_hash:id};
  }
  const tone=path.join(directory,'music.wav');ffmpeg(['-f','lavfi','-i','sine=frequency=1600:duration=1',tone]);rawAssetPaths.music=tone;assets.music={id:'music',kind:'audio',status:'ok',duration_ms:1000,content_hash:'music'};
  const item=id=>({id,name:id,kind:assets[id].kind,status:'ok',sourceRef:{kind:'media',assetId:id,contentHash:id}});
  const snapshot={draft:{settings:{width:160,height:160,fps:30},tracks:[{id:'v',name:'Visual',type:'video',slots:['red','blue','green'].map((id,i)=>({id:`s-${id}`,listId:id,durationFrames:60,vary:false,...(i<2?{transition:{type:'crossfade',durationFrames:15}}:{})}))},
    {id:'bgm',name:'BGM',type:'bgm',policy:'loop',slots:[{id:'s-music',listId:'music',durationFrames:30,vary:false,fadeInFrames:0,fadeOutFrames:0}]}]},
    assets,lists:Object.keys(assets).map(id=>({id,items:[item(id)]})),prepared:{},vectors:{}};
  const row={rowIndex:0,assignments:Object.keys(assets).map(id=>({slotId:`s-${id}`,itemId:id}))};
  const compiled=compileBatchRow(snapshot,row), doc=compiled.document;
  assert.equal(compiled.durationFrames,180);
  assert.equal(doc.tracks.at(-1).clips.at(-1).timelineOutMs,6000);
  const window=transitionWindow(doc.transitions[0],2000,30);assert.equal(window.startMs,2000-7*1000/30);
  const output=path.join(directory,'centered.mp4');
  const result=await runVideoJob('render',{projectState:doc,rawAssetPaths,rawAssetKinds:Object.fromEntries(Object.values(assets).map(a=>[a.id,a.kind])),outputPath:output},()=>{});
  assert.equal(result.totalDurationMs,6000);
  const metadata=probe(output), video=metadata.streams.find(s=>s.codec_type==='video');
  assert.ok(Math.abs(Number(video.duration)-6)<=1/30,`duration ${video.duration}`);
  const before=pixel(output,1.7),during=pixel(output,2),after=pixel(output,2.3);
  assert.ok(before[0]>220&&before[2]<25,`red before transition ${before}`);
  assert.ok(during[0]>70&&during[2]>70,`mixed at cut ${during}`);
  assert.ok(after[2]>220&&after[0]<25,`blue after transition ${after}`);
  assert.ok(rms(output,5.8,.1)>.04,'BGM remains present at the final visual end');
  command('ffmpeg',['-v','error','-i',output,'-f','null','-']);
  // Legacy output keeps its historic overlap duration; no silent migration.
  const legacy=JSON.parse(JSON.stringify(doc));delete legacy.sequence.transitionTiming;legacy.tracks=legacy.tracks.filter(t=>t.id==='v');legacy.transitions.forEach(t=>delete t.timingMode);
  assert.equal(buildRenderPlan(legacy,{assetPaths:rawAssetPaths,outputPath:'unused.mp4'}).totalDurationMs,5000);
  // One short audio clip clamps each default fade to 0.1s; render and measure
  // the decoded envelope, accounting for AAC frame padding via interior windows.
  const short=JSON.parse(JSON.stringify(snapshot));short.draft.tracks=[{id:'v',name:'V',type:'video',slots:[{id:'s-red',listId:'red',durationMode:'fixed',durationFrames:6,vary:false,muteSourceAudio:true}]},
    {id:'a',name:'A',type:'audio',slots:[{id:'s-music',listId:'music',durationFrames:6,vary:false}]}];
  const shortDoc=compileBatchRow(short,row).document, fadeClip=shortDoc.tracks.find(t=>t.type==='audio').clips[0];assert.equal(fadeClip.audioFadeInMs,100);assert.equal(fadeClip.audioFadeOutMs,100);
  const fadeFile=path.join(directory,'short-fades.mp4');await runVideoJob('render',{projectState:shortDoc,rawAssetPaths,rawAssetKinds:{music:'audio'},outputPath:fadeFile},()=>{});
  const levels=[rms(fadeFile,.01,.025),rms(fadeFile,.087,.025),rms(fadeFile,.165,.025)];
  assert.ok(levels[1]>levels[0]*2&&levels[1]>levels[2]*2,`audible fade envelope ${levels}`);
  const music2=path.join(directory,'music-2.wav');ffmpeg(['-f','lavfi','-i','sine=frequency=2200:duration=1',music2]);
  const playlist=JSON.parse(JSON.stringify(snapshot));playlist.assets.music2={id:'music2',kind:'audio',status:'ok',duration_ms:1000,content_hash:'music2'};
  playlist.lists.find(l=>l.id==='music').items.push({id:'music2',name:'Second song',kind:'audio',status:'ok',sourceRef:{kind:'media',assetId:'music2',contentHash:'music2'}});
  playlist.draft.tracks[0].slots.forEach(s=>{s.muteSourceAudio=true;delete s.transition;});
  const playlistDoc=compileBatchRow(playlist,row).document;
  assert.deepEqual(playlistDoc.tracks.at(-1).clips.map(c=>c.assetId),['music','music2','music','music2','music','music2']);
  const playlistFile=path.join(directory,'playlist-muted-source.mp4');await runVideoJob('render',{projectState:playlistDoc,rawAssetPaths:{...rawAssetPaths,music2},rawAssetKinds:{music:'audio',music2:'audio'},outputPath:playlistFile},()=>{});
  assert.ok(toneLevel(playlistFile,.5,1600)>toneLevel(playlistFile,.5,500)*20,'muted embedded audio is absent');
  assert.ok(toneLevel(playlistFile,1.5,2200)>toneLevel(playlistFile,1.5,1600)*20,'second playlist song follows first');
  assert.ok(toneLevel(playlistFile,2.5,1600)>toneLevel(playlistFile,2.5,2200)*20,'playlist loops in authored order');
  for (const type of ['pull-in','pull-out']) {
    const variant=JSON.parse(JSON.stringify(snapshot));variant.draft.tracks[0].slots.filter(s=>s.transition).forEach(s=>s.transition.type=type);
    const file=path.join(directory,`${type}.mp4`);await runVideoJob('render',{projectState:compileBatchRow(variant,row).document,rawAssetPaths,rawAssetKinds:{music:'audio'},outputPath:file},()=>{});
    assert.ok(Math.abs(Number(probe(file).streams.find(s=>s.codec_type==='video').duration)-6)<=1/30);
    assert.ok(pixel(file,2.4)[2]>220,`${type} arrives at blue without shifting the next clip`);
  }
  const many=JSON.parse(JSON.stringify(snapshot));
  many.lists.push({id:'shape',items:[{id:'shape',kind:'image',status:'ok',sourceRef:{kind:'vector-component',componentVersionId:'shape-component',contentHash:'shape'}}]});
  many.vectors.shape={shape:{...require('../../shared/video-vector').SHAPE_DEFAULTS,type:'ellipse',width:40,height:40,fillColor:'#ffffff'}};
  many.draft.tracks=[...Array.from({length:10},(_,i)=>({id:`v${i}`,name:`Hình ${i}`,type:'video',slots:[{id:`vs${i}`,listId:i===0?'shape':'red',durationFrames:30,vary:false,muteSourceAudio:true}]})),
    ...Array.from({length:10},(_,i)=>({id:`a${i}`,name:`Audio ${i}`,type:'audio',slots:[{id:`as${i}`,listId:'music',durationFrames:30,vary:false,volume:.02}]})),
    {id:'bgm',name:'BGM',type:'bgm',policy:'loop',slots:[{id:'bs',listId:'music',durationFrames:30,vary:false,volume:.1}]}];
  const manyRow={rowIndex:0,assignments:many.draft.tracks.flatMap(t=>t.slots.map(s=>({slotId:s.id,itemId:s.listId})))};
  const manyDoc=compileBatchRow(many,manyRow).document;assert.equal(manyDoc.tracks.length,21);assert.equal(manyDoc.tracks.at(-1).id,'bgm');assert.equal(manyDoc.tracks[0].clips[0].shape.type,'ellipse');
  const multiFile=path.join(directory,'21-tracks-shape.mp4');
  const began=performance.now(), timeout=setTimeout(()=>require('../agent/videoJobs').cancelRenderJob('batch-many-proof'),30000);
  try { await runVideoJob('render',{projectState:manyDoc,rawAssetPaths,rawAssetKinds:{music:'audio'},outputPath:multiFile},()=>{},'batch-many-proof'); }
  finally { clearTimeout(timeout); }
  const multiRenderMs=performance.now()-began;
  assert.ok(Math.abs(Number(probe(multiFile).streams.find(s=>s.codec_type==='video').duration)-2)<=1/30);
  const center=[...command('ffmpeg',['-v','error','-ss','0.5','-i',multiFile,'-frames:v','1','-vf','crop=4:4:80:80','-pix_fmt','rgb24','-f','rawvideo','-'])].slice(0,3);
  assert.ok(center.every(v=>v>225),`foreground vector is above nine video tracks: ${center}`);
  assert.ok(pixel(multiFile,.5)[0]>220,'outside native vector retains lower red track');
  const tail=[...command('ffmpeg',['-v','error','-ss','1.5','-i',multiFile,'-frames:v','1','-vf','crop=4:4:80:80','-pix_fmt','rgb24','-f','rawvideo','-'])].slice(0,3);
  assert.ok(tail[0]>220 && tail[1]<25,'short vector ends while the full source video continues');
  assert.ok(Math.abs(Number(probe(multiFile).streams.find(s=>s.codec_type==='audio').duration)-2)<.05,'mixed audio ends with the longer video');
  assert.ok(rms(multiFile,.45,.05)>.015,'ten audio tracks plus BGM mix is audible');
  const tooMany=JSON.parse(JSON.stringify(many));tooMany.draft.tracks.splice(1,0,{id:'extra',name:'Extra',type:'video',slots:[{id:'extra-slot',listId:'red',durationFrames:30,vary:false}]});
  assert.throws(()=>compileBatchRow(tooMany,{...manyRow,assignments:[...manyRow.assignments,{slotId:'extra-slot',itemId:'red'}]}),/vượt số track hỗ trợ/);
  fs.writeFileSync(path.join(directory,'proof.json'),JSON.stringify({platform:process.platform,node:process.version,duration:video.duration,transitionPixels:{before,during,after},fadeRms:levels,multiRenderMs,trackCount:21,vectorPixel:center,output},null,2));
  console.log('PASS real batch media: all centered transition types, 180 frames, BGM end, fades, legacy duration, 21-track vector/audio render, cap and MP4 decode');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
